/**
 * Frozen-validator Q probe — disposable observer / entrypoint (THE-574).
 *
 * SOURCE-ONLY PROPOSAL. Not installable authority and not a runtime PASS. The
 * canonical Q token in the accepted packet top-level argv is this file:
 *
 *   <N> <H>/server/src/__tests__/frozen-validator-probe/probe-observer.mjs <mode>
 *
 * Modes: normal-close | bootstrap-kill | worker-smoke. Built-ins only. No
 * product/Git/DB/provider/network import, no shell, no live-process killing.
 * Max 4 disposable Node processes, hard 10s, self-expiry 3s (defense-in-depth),
 * observation 750ms before self-expiry, TERM/KILL 500ms, awaited <=2s reap and
 * stdio close. Output <=1MiB, row <=64KiB, owned disk scratch <=4MiB. Unknown
 * ownership, timeout, missing-ready or residual state fails closed. Observer
 * rescue is recorded separately and NEVER counts as positive containment.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_ROOT = path.resolve(HERE, "../../../..");
const NODE = process.execPath;
const MODES = new Set(["normal-close", "bootstrap-kill", "worker-smoke"]);
const LIMITS = Object.freeze({
  hardTimeoutMs: 10000,
  selfExpiryMs: 3000,
  observeBeforeExpiryMs: 750,
  termKillGraceMs: 500,
  reapDeadlineMs: 2000,
  stdioDeadlineMs: 2000,
  maxOutputBytes: 1048576,
  maxRowBytes: 65536,
  maxScratchBytes: 4194304,
  maxProcesses: 4,
  maxReadyWaitMs: 2000,
  pollIntervalMs: 25,
});
const SUPERVISOR = path.join(HERE, "probe-surrogate-supervisor.mjs");
const VITEST = path.join(HOST_ROOT, "node_modules/vitest/vitest.mjs");
const SMOKE_TEST = path.join(HERE, "probe-worker-smoke.test.mjs");
const SMOKE_CONFIG = path.join(HERE, "probe-worker-smoke.vitest.config.mjs");
const PROBE_PRELOAD = path.join(HERE, "probe-preload.mjs");

const mode = process.argv[2];
if (!MODES.has(mode)) {
  process.stderr.write("PROBE_MODE: mode must be normal-close, bootstrap-kill or worker-smoke\n");
  process.exit(2);
}

/* ------------------------------- bounded rows ---------------------------- */
const rowLines = [];
let rowBytes = 0;
function record(row) {
  let line;
  try {
    line = JSON.stringify(row);
  } catch {
    line = JSON.stringify({ type: "row-serialize-error" });
  }
  if (line.length + 1 > LIMITS.maxRowBytes) {
    return fail("ROW_CEILING", { rowType: row?.type ?? null });
  }
  rowBytes += line.length + 1;
  if (rowBytes > LIMITS.maxOutputBytes) {
    return fail("OUTPUT_CEILING", { rowType: row?.type ?? null });
  }
  rowLines.push(line);
}

/* ------------------------------- scratch --------------------------------- */
const scratchRaw = process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? "";
if (!path.isAbsolute(scratchRaw)) {
  process.stderr.write("PROBE_SCRATCH: PAPERCLIP_RUN_SCRATCH_DIR must be absolute and run-owned\n");
  process.exit(2);
}
const scratch = path.resolve(scratchRaw);
if (typeof process.getuid === "function" && fs.statSync(scratch).uid !== process.getuid()) {
  process.stderr.write("PROBE_SCRATCH_OWNER: scratch is not owned by the executing UID\n");
  process.exit(2);
}
const work = path.join(scratch, "probe", "work");
const evidence = path.join(scratch, "probe", "evidence");
fs.mkdirSync(work, { recursive: true, mode: 0o700 });
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
const probeHome = path.join(work, "home");
const probeTmp = path.join(work, "tmp");
fs.mkdirSync(probeHome, { recursive: true, mode: 0o700 });
fs.mkdirSync(probeTmp, { recursive: true, mode: 0o700 });

const closedProbeEnv = Object.freeze({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  HOME: probeHome,
  TMPDIR: probeTmp,
  NODE_ENV: "production",
  PAPERCLIP_LOG_LEVEL: "silent",
  FORCE_TTY: "",
  PROBE_WORK_DIR: work,
});

/* ------------------------------ proc metadata ---------------------------- */
function procStat(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  let raw;
  try {
    raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const close = raw.lastIndexOf(")");
  if (close < 0) return null;
  const fields = raw.slice(close + 2).trim().split(/\s+/);
  return {
    state: fields[0],
    ppid: Number.parseInt(fields[1], 10),
    pgid: Number.parseInt(fields[2], 10),
    starttime: fields[19],
  };
}
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function groupAlive(pgid) {
  if (!Number.isSafeInteger(pgid) || pgid <= 0) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* Owned records are the only PIDs the observer may ever signal. */
const owned = new Map();
function remember(role, pid) {
  const stat = procStat(pid);
  if (!stat) {
    unknownOwnership = true;
    record({ type: "unknown-ownership", role, pid: Number.isSafeInteger(pid) ? pid : null });
    return null;
  }
  const entry = { role, pid, ppid: stat.ppid, pgid: stat.pgid, starttime: stat.starttime };
  owned.set(pid, entry);
  return entry;
}
function signalOwned(pid, signal, { onlyPid = false } = {}) {
  const entry = owned.get(pid);
  if (!entry) return false;
  const now = procStat(pid);
  if (!now || now.starttime !== entry.starttime) return false;
  const target = onlyPid || entry.pgid !== pid ? pid : -entry.pgid;
  try {
    process.kill(target, signal);
    return true;
  } catch {
    return false;
  }
}
function survivors() {
  const live = [];
  for (const [pid, entry] of owned.entries()) {
    const now = procStat(pid);
    if (now && now.starttime === entry.starttime && groupAlive(entry.pgid)) {
      live.push({ role: entry.role, pid, pgid: entry.pgid, starttime: entry.starttime });
    }
  }
  return live;
}

let unknownOwnership = false;

/* ------------------------------ finalization ----------------------------- */
const hardTimer = setTimeout(() => {
  record({ type: "hard-timeout", ms: LIMITS.hardTimeoutMs });
  finish("hard-timeout", 3);
}, LIMITS.hardTimeoutMs);

function writeEvidence(doc, lines) {
  try {
    fs.writeFileSync(path.join(evidence, "probe.jsonl"), lines.join("\n") + (lines.length ? "\n" : ""));
    fs.writeFileSync(path.join(evidence, "probe.json"), JSON.stringify(doc, null, 2));
    return true;
  } catch {
    return false;
  }
}

let finishing = false;
function finish(outcome, exitCode, extra = {}) {
  if (finishing) return;
  finishing = true;
  clearTimeout(hardTimer);
  const terminal = typeof extra.terminal === "boolean" ? extra.terminal : exitCode === 0;
  const doc = {
    schema: "paperclip.frozen-validator.probe-observer/v1",
    mode,
    outcome,
    parentDeathProof: null,
    containment: "unproved",
    hardTimeoutMs: LIMITS.hardTimeoutMs,
    maxProcesses: LIMITS.maxProcesses,
    outputBytes: rowBytes,
    owned: [...owned.values()],
    unknownOwnership,
    ...extra,
  };
  const evidenceOk = writeEvidence(doc, rowLines);
  /* Preserve evidence and uncertainty before disposing owned work. Only a
   * terminal, known-ownership run removes its own disposable scratch. */
  let cleanupOk = true;
  if (evidenceOk && terminal && !unknownOwnership) {
    try {
      const resolved = path.resolve(work);
      if (fs.realpathSync(resolved) !== resolved) cleanupOk = false;
      else fs.rmSync(resolved, { recursive: true, force: true });
    } catch {
      cleanupOk = false;
    }
  }
  if (!evidenceOk) process.exit(5);
  if (unknownOwnership || !cleanupOk) process.exit(exitCode === 0 ? 6 : exitCode);
  process.exit(exitCode);
}

function fail(code, extra = {}) {
  record({ type: "fail-closed", code });
  return finish(code, 3, extra);
}

/* --------------------------- terminal waiting ---------------------------- */
/**
 * Await group/stdio terminal state. Returns { terminal, rescued, residual }.
 * `rescueMode` = "none" | "kill-owned-group" (only recorded owned state).
 */
async function awaitTerminal({ rescueMode, deadlineMs, streams }) {
  const deadline = Date.now() + deadlineMs;
  let rescued = false;
  const channelsClosed = () => streams.every((stream) => stream.closed || stream.destroyed);
  for (;;) {
    const live = survivors();
    if (live.length === 0 && channelsClosed()) {
      return { terminal: true, rescued, residual: false };
    }
    if (Date.now() >= deadline) {
      if (rescueMode === "kill-owned-group" && live.length > 0 && !rescued) {
        rescued = true;
        record({ type: "observer-rescue", people: live.length });
        for (const entry of live) signalOwned(entry.pid, "SIGKILL");
        /* one more bounded wait for the rescue */
        const rescueDeadline = Date.now() + LIMITS.reapDeadlineMs;
        while (Date.now() < rescueDeadline) {
          if (survivors().length === 0 && channelsClosed()) break;
          await delay(LIMITS.pollIntervalMs);
        }
        const residual = survivors().length > 0;
        return { terminal: !residual, rescued, residual };
      }
      return { terminal: false, rescued, residual: live.length > 0 };
    }
    await delay(LIMITS.pollIntervalMs);
  }
}

/* ------------------------------ supervisor ------------------------------- */
async function runSupervisorProbe() {
  const supervisor = spawn(NODE, [SUPERVISOR, "supervise"], {
    cwd: HOST_ROOT,
    env: closedProbeEnv,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    detached: true,
    shell: false,
  });
  const supEntry = remember("supervisor", supervisor.pid);
  if (!supEntry) return fail("UNKNOWN_OWNERSHIP", { stage: "supervisor" });

  const streams = [supervisor.stdout, supervisor.stderr];
  streams.forEach((stream) => stream.on("data", () => {})); // drained; bounded by supervisor

  let ready = null;
  supervisor.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "child-ready") {
      if (!ready) {
        ready = message;
        remember("child", message.child);
        remember("grandchild", message.grandchild);
        record({
          type: "ready",
          supervisor: supervisor.pid,
          child: message.child ?? null,
          grandchild: message.grandchild ?? null,
          processCount: owned.size,
        });
      }
      return;
    }
    if (message.type === "supervisor-exit") {
      record({ ...message, type: "supervisor-report" });
      return;
    }
    if (message.type === "child-error") {
      record({ type: "child-error", message: message.message ?? null });
    }
  });

  const readyDeadline = Date.now() + LIMITS.maxReadyWaitMs;
  while (!ready && Date.now() < readyDeadline && !unknownOwnership) {
    await delay(LIMITS.pollIntervalMs);
  }
  if (unknownOwnership) return fail("UNKNOWN_OWNERSHIP", { stage: "handshake" });
  if (!ready) return fail("MISSING_READY", { stage: "handshake" });
  if (owned.size > LIMITS.maxProcesses) return fail("PROCESS_CEILING", { processCount: owned.size });

  if (mode === "normal-close") {
    try {
      supervisor.send({ type: "terminate", signal: "SIGTERM", graceMs: LIMITS.termKillGraceMs });
    } catch {
      /* channel already gone; observer rescue path below */
    }
    const result = await awaitTerminal({
      rescueMode: "kill-owned-group",
      deadlineMs: LIMITS.reapDeadlineMs,
      streams,
    });
    const terminalProofOk = result.terminal && !result.rescued;
    record({ type: "normal-close-result", ...result, terminalProofOk });
    if (!result.terminal) return fail("RESIDUAL", { ...result });
    return finish(result.rescued ? "normal-close-rescue" : "normal-teardown", 0, {
      rescueUsed: result.rescued,
      terminalProofOk,
      terminal: true,
    });
  }

  /* bootstrap-kill: kill ONLY the disposable supervisor, never helper/root. */
  const killed = signalOwned(supEntry.pid, "SIGKILL", { onlyPid: true });
  if (!killed) return fail("SUPERVISOR_SIGNAL", { stage: "bootstrap-kill" });
  const killAt = Date.now();
  record({ type: "bootstrap-kill", supervisor: supEntry.pid, at: new Date(killAt).toISOString() });

  const elapsed = Date.now() - killAt;
  const observeAt = LIMITS.observeBeforeExpiryMs;
  if (elapsed < observeAt) await delay(observeAt - elapsed);
  const observedLive = survivors();
  record({ type: "observation", at: new Date().toISOString(), survivors: observedLive });

  /* Wait through the child's 3s self-expiry, then bound the terminal proof. */
  const selfExpiryDeadline = killAt + LIMITS.selfExpiryMs + LIMITS.reapDeadlineMs;
  let selfExpired = false;
  while (Date.now() < selfExpiryDeadline) {
    if (survivors().length === 0) {
      selfExpired = true;
      break;
    }
    await delay(LIMITS.pollIntervalMs);
  }
  const result = await awaitTerminal({
    rescueMode: "kill-owned-group",
    deadlineMs: Math.max(0, selfExpiryDeadline - Date.now()) + LIMITS.reapDeadlineMs,
    streams,
  });
  const terminalWithoutRescue = result.terminal && !result.rescued;
  record({ type: "bootstrap-kill-result", ...result, observedSurvivors: observedLive.length, selfExpired });
  if (!result.terminal) return fail("RESIDUAL", { ...result, observedSurvivors: observedLive.length });
  const outcome = result.rescued
    ? "bootstrap-kill-rescue"
    : selfExpired
      ? "bootstrap-kill-self-expiry"
      : "bootstrap-kill-terminal";
  /* Parent-death containment is NEVER positive from this probe. */
  return finish(outcome, 0, {
    rescueUsed: result.rescued,
    terminalWithoutRescue,
    selfExpired,
    observedSurvivors: observedLive.length,
    terminal: true,
  });
}

/* ------------------------------ worker smoke ----------------------------- */
async function runWorkerSmoke() {
  const smoke = spawn(
    NODE,
    [
      "--import", PROBE_PRELOAD,
      VITEST,
      "run",
      "--configLoader", "native",
      "--config", SMOKE_CONFIG,
      "--pool=forks",
      "--maxWorkers=1",
      "--no-file-parallelism",
      SMOKE_TEST,
    ],
    {
      cwd: HOST_ROOT,
      env: { ...closedProbeEnv, PAPERCLIP_RUN_SCRATCH_DIR: scratch },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      detached: true,
      shell: false,
    },
  );
  const entry = remember("vitest-main", smoke.pid);
  if (!entry) return fail("UNKNOWN_OWNERSHIP", { stage: "worker-smoke" });

  let bytes = 0;
  let overflow = false;
  for (const stream of [smoke.stdout, smoke.stderr]) {
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > LIMITS.maxOutputBytes) overflow = true;
    });
  }
  const lifecycle = [];
  smoke.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    lifecycle.push(message.type);
    record({ type: "probe-lifecycle", message: message.type, detail: message });
  });

  const exit = await new Promise((resolve) => {
    smoke.on("error", () => resolve({ code: 3 }));
    smoke.on("close", (code) => resolve({ code: typeof code === "number" ? code : 3 }));
  });
  const result = await awaitTerminal({
    rescueMode: "none",
    deadlineMs: LIMITS.reapDeadlineMs,
    streams: [smoke.stdout, smoke.stderr],
  });
  record({ type: "worker-smoke-result", exitCode: exit.code, overflow, lifecycle, ...result });
  if (overflow) return fail("OUTPUT_CEILING", { stage: "worker-smoke" });
  if (!result.terminal) return fail("RESIDUAL", { stage: "worker-smoke", ...result });
  /* Refusals remain negative setup/compatibility evidence, not validator verdicts. */
  if (exit.code !== 0) return finish("worker-smoke-refused", exit.code, { lifecycle, terminal: true });
  return finish("worker-smoke-complete", 0, {
    lifecycle,
    terminalProofOk: result.terminal,
    terminal: true,
  });
}

/* -------------------------------- dispatch ------------------------------- */
record({
  type: "observer-start",
  mode,
  hostRoot: HOST_ROOT,
  node: NODE,
  maxProcesses: LIMITS.maxProcesses,
  hardTimeoutMs: LIMITS.hardTimeoutMs,
  selfExpiryMs: LIMITS.selfExpiryMs,
});

if (mode === "worker-smoke") {
  await runWorkerSmoke();
} else {
  await runSupervisorProbe();
}
