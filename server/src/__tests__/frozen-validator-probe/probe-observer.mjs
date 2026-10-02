/**
 * Frozen-validator Q probe — disposable observer / entrypoint (THE-574, F‴ correction).
 *
 * SOURCE-ONLY PROPOSAL. Not installable authority and not a runtime PASS. The
 * canonical Q token in the accepted packet top-level argv is this file:
 *
 *   <N> <H>/server/src/__tests__/frozen-validator-probe/probe-observer.mjs <mode>
 *
 * Modes: normal-close | bootstrap-kill | worker-smoke. Built-ins only. No
 * product/Git/DB/provider/network import, no shell, no live-process killing.
 *
 * F‴ corrections (THE-575 d92e672a adverse rows): a ceiling failure never
 * poisons owned-process enumeration (mandatory bounded cleanup always runs);
 * the max4 bound counts the observer itself; group signals revalidate current
 * PID/starttime/PGID/scope immediately before killing; one shared absolute
 * terminal deadline with no extra 250ms/fresh windows; all owned writes are
 * budgeted before writing (never exceed 4MiB on success or failure paths); the
 * measured terminal/ownership outcome always wins over caller metadata.
 * Rescue is recorded separately and NEVER counts as positive containment.
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

/* Failure is recorded but NEVER gates ownership enumeration or cleanup. */
let failure = null;
function noteFailure(code, extra = {}) {
  if (!failure) failure = { code, extra };
}

/* ------------------------------- accounting ------------------------------ */
const rowLines = [];
let rowBytes = 0;
let channelBytes = 0;
const hardDeadlineAt = Date.now() + LIMITS.hardTimeoutMs;

function record(row) {
  let line;
  try {
    line = JSON.stringify(row);
  } catch {
    line = JSON.stringify({ type: "row-serialize-error" });
  }
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes > LIMITS.maxRowBytes) {
    noteFailure("ROW_CEILING", { rowType: row?.type ?? null });
    return;
  }
  if (rowBytes + channelBytes + bytes > LIMITS.maxOutputBytes) {
    noteFailure("OUTPUT_CEILING", { rowType: row?.type ?? null });
    return;
  }
  rowBytes += bytes;
  rowLines.push(line);
}
const safeRecord = record;
function accountChannel(chunk) {
  channelBytes += chunk.length;
  if (rowBytes + channelBytes > LIMITS.maxOutputBytes) {
    noteFailure("OUTPUT_CEILING", { source: "channel" });
  }
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
const probeDir = path.join(scratch, "probe");
const work = path.join(probeDir, "work");
const evidence = path.join(probeDir, "evidence");
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
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function procList() {
  let entries;
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return [];
  }
  return entries.filter((name) => /^[0-9]+$/.test(name)).map((name) => Number.parseInt(name, 10));
}

/* Explicit owned scope: recorded PID/starttime/PGID + /proc group discovery. */
const owned = new Map();
const ownedGroups = new Set();
let unknownOwnership = false;
let minOwnedStarttime = null;

function remember(role, pid, expectedParentPid = null) {
  const stat = procStat(pid);
  if (!stat) {
    unknownOwnership = true;
    safeRecord({ type: "unknown-ownership", role, pid: Number.isSafeInteger(pid) ? pid : null });
    return null;
  }
  if (expectedParentPid !== null && stat.ppid !== expectedParentPid) {
    unknownOwnership = true;
    safeRecord({ type: "ancestry-mismatch", role, pid, expectedParentPid, ppid: stat.ppid });
    return null;
  }
  const entry = { role, pid, ppid: stat.ppid, pgid: stat.pgid, starttime: stat.starttime };
  owned.set(pid, entry);
  ownedGroups.add(stat.pgid);
  minOwnedStarttime = minOwnedStarttime === null ? stat.starttime : String(Math.min(Number(minOwnedStarttime), Number(stat.starttime)));
  return entry;
}
function ancestryOwned(pid) {
  let current = pid;
  for (let depth = 0; depth < 12 && current > 1; depth += 1) {
    const stat = procStat(current);
    if (!stat) return false;
    if (owned.has(current)) return true;
    current = stat.ppid;
  }
  return false;
}
function memberInScope(stat) {
  return minOwnedStarttime === null || stat.starttime >= minOwnedStarttime;
}
/* Enumeration is never disabled by a ceiling failure and never throws. */
function liveOwned() {
  const live = [];
  for (const [pid, entry] of owned.entries()) {
    const now = procStat(pid);
    if (now && now.starttime === entry.starttime && now.pgid === entry.pgid) live.push(entry);
  }
  for (const pgid of ownedGroups) {
    for (const pid of procList()) {
      if (owned.has(pid)) continue;
      const stat = procStat(pid);
      if (!stat || stat.pgid !== pgid) continue;
      if (!memberInScope(stat)) {
        unknownOwnership = true;
        safeRecord({ type: "stale-group-member", pid, pgid, starttime: stat.starttime, minOwnedStarttime });
        continue;
      }
      if (ancestryOwned(pid) || stat.starttime >= (minOwnedStarttime ?? stat.starttime)) {
        const entry = { role: "owned-group-member", pid, ppid: stat.ppid, pgid: stat.pgid, starttime: stat.starttime };
        owned.set(pid, entry);
        live.push(entry);
      }
    }
  }
  if (owned.size + 1 > LIMITS.maxProcesses) {
    noteFailure("PROCESS_CEILING", { ownedProcesses: owned.size, totalProcesses: owned.size + 1 });
  }
  return live;
}
function totalProcessCount() {
  return owned.size + 1; /* +1 for this observer */
}
/* Renewed identity check immediately before any signal. */
function groupHasVerifiedMember(pgid) {
  for (const pid of procList()) {
    const stat = procStat(pid);
    if (!stat || stat.pgid !== pgid || !memberInScope(stat)) continue;
    const rec = owned.get(pid);
    if (rec && rec.starttime === stat.starttime && rec.pgid === stat.pgid) return true;
    if (ancestryOwned(pid)) return true;
  }
  return false;
}
function killOwnedGroups() {
  for (const pgid of ownedGroups) {
    if (!groupHasVerifiedMember(pgid)) {
      safeRecord({ type: "signal-refused", pgid, reason: "unverified-or-stale" });
      continue;
    }
    try {
      process.kill(-pgid, "SIGKILL");
      safeRecord({ type: "group-signalled", pgid });
    } catch {
      /* group already gone */
    }
  }
}
function signalPidOnly(pid, signal) {
  const entry = owned.get(pid);
  if (!entry) return false;
  const now = procStat(pid);
  if (!now || now.starttime !== entry.starttime || now.pgid !== entry.pgid) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

let activeStreams = [];
function streamsClosed(streams) {
  if (!Array.isArray(streams) || streams.length === 0) return true;
  return streams.every((stream) => stream.closed || stream.destroyed);
}

/* ------------------------------ evidence --------------------------------- */
function measureTreeBytes(root) {
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      let entries;
      try {
        entries = fs.readdirSync(current);
      } catch {
        continue;
      }
      for (const name of entries) stack.push(path.join(current, name));
    } else if (stat.isFile()) {
      total += stat.size;
      if (total > LIMITS.maxScratchBytes) return total;
    }
  }
  return total;
}
/* All owned writes are budgeted before writing; never exceed 4MiB. */
function writeEvidence(doc) {
  const jsonl = rowLines.join("\n") + (rowLines.length ? "\n" : "");
  const json = JSON.stringify(doc, null, 2);
  const current = measureTreeBytes(probeDir);
  const projected = current + Buffer.byteLength(jsonl, "utf8") + Buffer.byteLength(json, "utf8");
  if (projected > LIMITS.maxScratchBytes) {
    noteFailure("SCRATCH_CEILING", { current, projected });
    const marker = JSON.stringify({
      schema: "paperclip.frozen-validator.probe-observer/v1",
      mode,
      outcome: doc.outcome,
      truncated: true,
      reason: "scratch-ceiling",
      projected,
    });
    try {
      fs.writeFileSync(path.join(evidence, "probe.jsonl"), "");
      fs.writeFileSync(path.join(evidence, "probe.json"), marker);
      return false;
    } catch {
      return false;
    }
  }
  try {
    fs.writeFileSync(path.join(evidence, "probe.jsonl"), jsonl);
    fs.writeFileSync(path.join(evidence, "probe.json"), json);
    return true;
  } catch {
    return false;
  }
}

/* --------------------------- terminal waiting ---------------------------- */
/* One shared absolute deadline. No extra sub-window is added at the deadline. */
async function awaitTerminal(deadlineAt, streams) {
  for (;;) {
    const live = liveOwned();
    if (live.length === 0 && streamsClosed(streams)) {
      return { terminal: true, live: 0, reason: "terminal" };
    }
    if (Date.now() >= deadlineAt) {
      const remaining = liveOwned().length;
      return { terminal: remaining === 0 && streamsClosed(streams), live: remaining, reason: "deadline" };
    }
    await delay(LIMITS.pollIntervalMs);
  }
}

/* ------------------------------ finalization ----------------------------- */
const hardTimer = setTimeout(() => {
  void finalize("hard-timeout", 3, { hardTimeout: true }, { killOwned: true, deadlineAt: hardDeadlineAt });
}, LIMITS.hardTimeoutMs);

let finishing = false;
async function finalize(outcome, exitCode, extra = {}, options = {}) {
  if (finishing) return;
  finishing = true;
  clearTimeout(hardTimer);
  const deadlineAt = Math.min(options.deadlineAt ?? hardDeadlineAt, hardDeadlineAt);
  let rescueUsed = extra.rescueUsed === true;
  if (options.killOwned) {
    if (liveOwned().length > 0) {
      rescueUsed = true;
      safeRecord({ type: "observer-rescue", phase: "finalize", owned: liveOwned().length });
    }
    killOwnedGroups();
  }
  const term = await awaitTerminal(deadlineAt, activeStreams);
  const scratchBytes = measureTreeBytes(probeDir);
  const scratchOk = scratchBytes <= LIMITS.maxScratchBytes;
  if (!scratchOk) noteFailure("SCRATCH_CEILING", { scratchBytes });
  if (failure && exitCode === 0) exitCode = 3;
  if (!term.terminal && exitCode === 0) exitCode = 3;
  /* Authoritative measured outcome is placed AFTER caller metadata so it can
   * never be overwritten. */
  const doc = {
    ...extra,
    schema: "paperclip.frozen-validator.probe-observer/v1",
    mode,
    outcome,
    parentDeathProof: null,
    containment: "unproved",
    terminal: term.terminal,
    terminalReason: term.reason,
    liveOwned: term.live,
    rescueUsed,
    unknownOwnership,
    totalProcesses: totalProcessCount(),
    maxProcesses: LIMITS.maxProcesses,
    processCeilingExceeded: totalProcessCount() > LIMITS.maxProcesses,
    failureCode: failure ? failure.code : null,
    failureExtra: failure ? failure.extra : null,
    hardTimeoutMs: LIMITS.hardTimeoutMs,
    maxOutputBytes: LIMITS.maxOutputBytes,
    maxRowBytes: LIMITS.maxRowBytes,
    maxScratchBytes: LIMITS.maxScratchBytes,
    outputBytes: rowBytes + channelBytes,
    rowBytes,
    channelBytes,
    scratchBytes,
    owned: [...owned.values()],
  };
  const evidenceOk = writeEvidence(doc);
  const terminalSuccess =
    term.terminal && !unknownOwnership && scratchOk && evidenceOk && !failure && exitCode === 0;
  let cleanupOk = true;
  if (terminalSuccess) {
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

/* ------------------------------ supervisor ------------------------------- */
async function runSupervisorProbe() {
  const supervisor = spawn(NODE, [SUPERVISOR, "supervise"], {
    cwd: HOST_ROOT,
    env: closedProbeEnv,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    detached: true,
    shell: false,
  });
  activeStreams = [supervisor.stdout, supervisor.stderr];
  supervisor.stdout.on("data", accountChannel);
  supervisor.stderr.on("data", accountChannel);
  const supEntry = remember("supervisor", supervisor.pid, process.pid);
  if (!supEntry) return finalize("UNKNOWN_OWNERSHIP", 3, { stage: "supervisor" }, { killOwned: true, deadlineAt: hardDeadlineAt });

  let ready = null;
  supervisor.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "child-ready") {
      const childEntry = remember("child", message.child, supervisor.pid);
      const grandEntry = remember("grandchild", message.grandchild, message.child);
      if (!childEntry || !grandEntry) return;
      if (!ready) {
        ready = message;
        safeRecord({
          type: "ready",
          supervisor: supervisor.pid,
          child: message.child,
          grandchild: message.grandchild,
          processCount: totalProcessCount(),
        });
      }
      return;
    }
    if (message.type === "supervisor-error") {
      safeRecord({ type: "supervisor-error", code: message.code ?? null });
      return;
    }
    if (message.type === "supervisor-exit") {
      safeRecord({ ...message, type: "supervisor-report" });
      return;
    }
    if (message.type === "child-error") {
      safeRecord({ type: "child-error", message: message.message ?? null });
    }
  });

  const readyDeadline = Math.min(hardDeadlineAt, Date.now() + LIMITS.maxReadyWaitMs);
  while (!ready && Date.now() < readyDeadline && !unknownOwnership && !failure) {
    await delay(LIMITS.pollIntervalMs);
  }
  if (unknownOwnership) {
    return finalize("UNKNOWN_OWNERSHIP", 3, { stage: "handshake" }, { killOwned: true, deadlineAt: hardDeadlineAt });
  }
  if (!ready) {
    return finalize("MISSING_READY", 3, { stage: "handshake" }, { killOwned: true, deadlineAt: hardDeadlineAt });
  }
  if (totalProcessCount() > LIMITS.maxProcesses) {
    return finalize("PROCESS_CEILING", 3, { totalProcesses: totalProcessCount() }, { killOwned: true, deadlineAt: hardDeadlineAt });
  }

  if (mode === "normal-close") {
    try {
      supervisor.send({ type: "terminate", signal: "SIGTERM", graceMs: LIMITS.termKillGraceMs });
    } catch {
      /* channel gone; residual path below rescues */
    }
    const deadlineAt = Date.now() + LIMITS.reapDeadlineMs;
    const term = await awaitTerminal(deadlineAt, activeStreams);
    const terminalProofOk = term.terminal;
    safeRecord({ type: "normal-close-result", ...term, terminalProofOk });
    return finalize(
      term.terminal ? "normal-teardown" : "normal-close-residual",
      term.terminal ? 0 : 3,
      { terminalProofOk, terminal: term.terminal, rescueUsed: false },
      { killOwned: !term.terminal, deadlineAt },
    );
  }

  /* bootstrap-kill: SIGKILL ONLY the disposable supervisor, never helper/root. */
  const killed = signalPidOnly(supEntry.pid, "SIGKILL");
  if (!killed) return finalize("SUPERVISOR_SIGNAL", 3, { stage: "bootstrap-kill" }, { killOwned: true, deadlineAt: hardDeadlineAt });
  const killAt = Date.now();
  safeRecord({ type: "bootstrap-kill", supervisor: supEntry.pid, at: new Date(killAt).toISOString() });

  const observeAt = LIMITS.observeBeforeExpiryMs;
  if (Date.now() - killAt < observeAt) await delay(observeAt - (Date.now() - killAt));
  const observedLive = liveOwned();
  safeRecord({ type: "observation", at: new Date().toISOString(), survivors: observedLive });

  /* One absolute terminal deadline: 3s self-expiry then one <=2s reap window. */
  const deadlineAt = killAt + LIMITS.selfExpiryMs + LIMITS.reapDeadlineMs;
  const term = await awaitTerminal(deadlineAt, activeStreams);
  const terminalWithoutRescue = term.terminal;
  safeRecord({ type: "bootstrap-kill-result", ...term, observedSurvivors: observedLive.length, terminalWithoutRescue });
  const outcome = term.terminal
    ? observedLive.length > 0
      ? "bootstrap-kill-self-expiry"
      : "bootstrap-kill-terminal"
    : "bootstrap-kill-residual";
  return finalize(
    outcome,
    term.terminal ? 0 : 3,
    { observedSurvivors: observedLive.length, terminalWithoutRescue, terminal: term.terminal, rescueUsed: false },
    { killOwned: !term.terminal, deadlineAt },
  );
}

/* ------------------------------ worker smoke ----------------------------- */
const EXPECTED_LIFECYCLE = [
  "main-send:start",
  "worker-recv:started",
  "main-send:run",
  "worker-recv:testfileFinished",
];
const TAIL_LIFECYCLE = ["main-send:stop", "worker-recv:stopped"];
function validateLifecycle(entries) {
  let pointer = 0;
  let tail = 0;
  for (const entry of entries) {
    const key = `${entry.dir}:${entry.messageType}`;
    if (pointer < EXPECTED_LIFECYCLE.length) {
      if (key !== EXPECTED_LIFECYCLE[pointer]) return { ok: false, reason: "unexpected-or-out-of-order", key, pointer };
      pointer += 1;
      continue;
    }
    if (key === TAIL_LIFECYCLE[tail]) {
      tail += 1;
      if (tail >= TAIL_LIFECYCLE.length) break;
      continue;
    }
    return { ok: false, reason: "unexpected-lifecycle-tail", key, pointer };
  }
  if (pointer < EXPECTED_LIFECYCLE.length) return { ok: false, reason: "missing-lifecycle", pointer };
  return { ok: true };
}

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
  activeStreams = [smoke.stdout, smoke.stderr];
  smoke.stdout.on("data", accountChannel);
  smoke.stderr.on("data", accountChannel);
  const entry = remember("vitest-main", smoke.pid, process.pid);
  if (!entry) return finalize("UNKNOWN_OWNERSHIP", 3, { stage: "worker-smoke" }, { killOwned: true, deadlineAt: hardDeadlineAt });

  const lifecycle = [];
  smoke.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "probe-lifecycle") {
      lifecycle.push({ dir: message.dir, messageType: message.messageType });
      safeRecord({ type: "probe-lifecycle", dir: message.dir, messageType: message.messageType });
      return;
    }
    if (message.type === "probe-fork-admitted") {
      remember("vitest-worker", message.pid, smoke.pid);
      safeRecord({ type: "probe-fork-admitted", pid: message.pid ?? null });
      return;
    }
    safeRecord({ type: "probe-message", messageType: message.type ?? null });
  });

  const exit = await new Promise((resolve) => {
    smoke.on("error", () => resolve({ code: 3 }));
    smoke.on("close", (code) => resolve({ code: typeof code === "number" ? code : 3 }));
  });

  const lifecycleCheck = validateLifecycle(lifecycle);
  safeRecord({ type: "worker-smoke-result", exitCode: exit.code, lifecycle, lifecycleCheck });
  const deadlineAt = Math.min(hardDeadlineAt, Date.now() + LIMITS.reapDeadlineMs);
  if (!lifecycleCheck.ok) {
    return finalize(
      "WORKER_LIFECYCLE",
      3,
      { lifecycle, lifecycleCheck, terminal: false, rescueUsed: false },
      { killOwned: true, deadlineAt: hardDeadlineAt },
    );
  }
  const term = await awaitTerminal(deadlineAt, activeStreams);
  if (!term.terminal) {
    return finalize("RESIDUAL", 3, { lifecycle, terminal: false, rescueUsed: false }, { killOwned: true, deadlineAt });
  }
  if (exit.code !== 0) {
    return finalize("worker-smoke-refused", 3, { lifecycle, terminal: true, rescueUsed: false }, { killOwned: false, deadlineAt });
  }
  return finalize(
    "worker-smoke-complete",
    0,
    { lifecycle, terminalProofOk: term.terminal, terminal: true, rescueUsed: false },
    { killOwned: false, deadlineAt },
  );
}

/* -------------------------------- dispatch ------------------------------- */
safeRecord({
  type: "observer-start",
  mode,
  hostRoot: HOST_ROOT,
  node: NODE,
  maxProcesses: LIMITS.maxProcesses,
  hardTimeoutMs: LIMITS.hardTimeoutMs,
  selfExpiryMs: LIMITS.selfExpiryMs,
});

try {
  if (mode === "worker-smoke") await runWorkerSmoke();
  else await runSupervisorProbe();
} catch (error) {
  await finalize("probe-error", 3, { message: String(error?.message ?? error) }, { killOwned: true, deadlineAt: hardDeadlineAt });
}
