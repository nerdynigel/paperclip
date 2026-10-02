/**
 * Frozen-validator Q probe — disposable observer / entrypoint (THE-574, F″ correction).
 *
 * SOURCE-ONLY PROPOSAL. Not installable authority and not a runtime PASS. The
 * canonical Q token in the accepted packet top-level argv is this file:
 *
 *   <N> <H>/server/src/__tests__/frozen-validator-probe/probe-observer.mjs <mode>
 *
 * Modes: normal-close | bootstrap-kill | worker-smoke. Built-ins only. No
 * product/Git/DB/provider/network import, no shell, no live-process killing.
 *
 * F″ corrections (THE-575 adverse rows): all post-spawn failure/timeout paths
 * fail closed AND complete owned-graph cleanup with awaited reap/pipe closure
 * inside the one bound; recorded processes are bound to PID/starttime/current
 * PGID and explicit ancestry/owned scope; owned group membership is discovered
 * from /proc independently of a live group leader; terminal requires no live
 * owned descendant AND stdio close; one absolute <=2s reap deadline (not
 * cumulative); enforced 4MiB owned scratch / 64KiB UTF-8 row / 1MiB aggregate
 * output (including supervisor channels) / max4 processes; worker-smoke requires
 * the ordered start/started/run/testfileFinished IPC lifecycle. Rescue is
 * recorded separately and NEVER counts as positive containment.
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

class ProbeFail extends Error {
  constructor(code, extra = {}) {
    super(code);
    this.name = "ProbeFail";
    this.code = code;
    this.extra = extra;
  }
}

/* ------------------------------- accounting ------------------------------ */
const rowLines = [];
let rowBytes = 0;
let channelBytes = 0;
let pendingFailure = null;
const hardDeadlineAt = Date.now() + LIMITS.hardTimeoutMs;

function record(row) {
  let line;
  try {
    line = JSON.stringify(row);
  } catch {
    line = JSON.stringify({ type: "row-serialize-error" });
  }
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes > LIMITS.maxRowBytes) throw new ProbeFail("ROW_CEILING", { rowType: row?.type ?? null });
  if (rowBytes + channelBytes + bytes > LIMITS.maxOutputBytes) {
    throw new ProbeFail("OUTPUT_CEILING", { rowType: row?.type ?? null });
  }
  rowBytes += bytes;
  rowLines.push(line);
}
function safeRecord(row) {
  try {
    record(row);
  } catch (error) {
    if (error instanceof ProbeFail) pendingFailure = error;
    else throw error;
  }
}
function accountChannel(chunk) {
  channelBytes += chunk.length;
  if (rowBytes + channelBytes > LIMITS.maxOutputBytes) {
    if (!pendingFailure) pendingFailure = new ProbeFail("OUTPUT_CEILING", { source: "channel" });
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
function adoptMember(member) {
  const entry = { role: "owned-group-member", ...member };
  owned.set(member.pid, entry);
  return entry;
}
function liveOwned() {
  if (pendingFailure) throw pendingFailure;
  const live = [];
  for (const [pid, entry] of owned.entries()) {
    const now = procStat(pid);
    if (now && now.starttime === entry.starttime) live.push(entry);
  }
  for (const pgid of ownedGroups) {
    for (const pid of procList()) {
      if (owned.has(pid)) continue;
      const stat = procStat(pid);
      if (!stat || stat.pgid !== pgid) continue;
      /* Owned scope: group membership started at/after the recorded leader. */
      if (minOwnedStarttime !== null && stat.starttime < minOwnedStarttime) {
        unknownOwnership = true;
        safeRecord({ type: "stale-group-member", pid, pgid, starttime: stat.starttime, minOwnedStarttime });
        continue;
      }
      if (ancestryOwned(pid) || stat.starttime >= (minOwnedStarttime ?? stat.starttime)) {
        live.push(adoptMember({ pid, ppid: stat.ppid, pgid: stat.pgid, starttime: stat.starttime }));
      }
    }
  }
  if (owned.size > LIMITS.maxProcesses) {
    throw new ProbeFail("PROCESS_CEILING", { processCount: owned.size });
  }
  return live;
}
function liveOwnedSafe() {
  try {
    return liveOwned();
  } catch (error) {
    if (!pendingFailure) pendingFailure = error;
    return [];
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
function killOwnedGroups() {
  const groups = new Set();
  for (const entry of owned.values()) groups.add(entry.pgid);
  for (const pgid of ownedGroups) groups.add(pgid);
  for (const pgid of groups) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      /* group already gone */
    }
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
function writeEvidence(doc) {
  try {
    fs.writeFileSync(path.join(evidence, "probe.jsonl"), rowLines.join("\n") + (rowLines.length ? "\n" : ""));
    fs.writeFileSync(path.join(evidence, "probe.json"), JSON.stringify(doc, null, 2));
    return true;
  } catch {
    return false;
  }
}

/* --------------------------- terminal waiting ---------------------------- */
async function awaitTerminal(deadlineAt, streams, { rescueOnDeadline }) {
  let rescued = false;
  for (;;) {
    if (pendingFailure) throw pendingFailure;
    const live = liveOwned();
    if (live.length === 0 && streamsClosed(streams)) {
      return { terminal: true, rescued, live: 0, reason: "terminal" };
    }
    if (Date.now() >= deadlineAt) {
      if (rescueOnDeadline && live.length > 0 && !rescued) {
        rescued = true;
        safeRecord({ type: "observer-rescue", phase: "terminal-deadline", live: live.length });
        killOwnedGroups();
        const subDeadline = Date.now() + 250;
        while (Date.now() < subDeadline) {
          if (liveOwnedSafe().length === 0 && streamsClosed(streams)) break;
          await delay(LIMITS.pollIntervalMs);
        }
      }
      const remaining = liveOwnedSafe().length;
      return { terminal: remaining === 0 && streamsClosed(streams), rescued, live: remaining, reason: "deadline" };
    }
    await delay(LIMITS.pollIntervalMs);
  }
}

/* ------------------------------ finalization ----------------------------- */
const hardTimer = setTimeout(() => {
  void finalize("hard-timeout", 3, { hardTimeout: true }, { killOwned: true });
}, LIMITS.hardTimeoutMs);

let finishing = false;
async function finalize(outcome, exitCode, extra = {}, options = {}) {
  if (finishing) return;
  finishing = true;
  clearTimeout(hardTimer);
  let rescueUsed = extra.rescueUsed === true;
  if (options.killOwned) {
    const live = liveOwnedSafe();
    if (live.length > 0) {
      rescueUsed = true;
      safeRecord({ type: "observer-rescue", phase: "finalize", live: live.length });
      killOwnedGroups();
    }
  }
  let term = { terminal: false, rescued: rescueUsed, live: -1, reason: "unmeasured" };
  try {
    term = await awaitTerminal(
      Math.min(hardDeadlineAt, Date.now() + LIMITS.reapDeadlineMs),
      activeStreams,
      { rescueOnDeadline: false },
    );
  } catch (error) {
    pendingFailure = error;
  }
  if (!term.terminal && exitCode === 0) exitCode = 3;
  const scratchBytesBefore = measureTreeBytes(path.join(scratch, "probe"));
  const doc = {
    schema: "paperclip.frozen-validator.probe-observer/v1",
    mode,
    outcome,
    parentDeathProof: null,
    containment: "unproved",
    hardTimeoutMs: LIMITS.hardTimeoutMs,
    maxProcesses: LIMITS.maxProcesses,
    maxScratchBytes: LIMITS.maxScratchBytes,
    outputBytes: rowBytes + channelBytes,
    rowBytes,
    channelBytes,
    scratchBytes: scratchBytesBefore,
    owned: [...owned.values()],
    unknownOwnership,
    rescueUsed: rescueUsed || term.rescued,
    terminal: term.terminal,
    liveOwned: term.live,
    ...extra,
  };
  const evidenceOk = writeEvidence(doc);
  const scratchBytes = measureTreeBytes(path.join(scratch, "probe"));
  const scratchOk = scratchBytes <= LIMITS.maxScratchBytes;
  const terminalSuccess = term.terminal && !unknownOwnership && scratchOk && evidenceOk;
  let cleanupOk = true;
  if (terminalSuccess && exitCode === 0) {
    try {
      const resolved = path.resolve(work);
      if (fs.realpathSync(resolved) !== resolved) cleanupOk = false;
      else fs.rmSync(resolved, { recursive: true, force: true });
    } catch {
      cleanupOk = false;
    }
  }
  if (!evidenceOk) process.exit(5);
  if (!scratchOk && exitCode === 0) exitCode = 3;
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
  if (!supEntry) return finalize("UNKNOWN_OWNERSHIP", 3, { stage: "supervisor" }, { killOwned: true });

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
          processCount: owned.size,
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
  while (!ready && Date.now() < readyDeadline && !unknownOwnership && !pendingFailure) {
    await delay(LIMITS.pollIntervalMs);
  }
  if (pendingFailure) return finalize(pendingFailure.code, 3, pendingFailure.extra, { killOwned: true });
  if (unknownOwnership) return finalize("UNKNOWN_OWNERSHIP", 3, { stage: "handshake" }, { killOwned: true });
  if (!ready) return finalize("MISSING_READY", 3, { stage: "handshake" }, { killOwned: true });
  if (owned.size > LIMITS.maxProcesses) {
    return finalize("PROCESS_CEILING", 3, { processCount: owned.size }, { killOwned: true });
  }

  if (mode === "normal-close") {
    try {
      supervisor.send({ type: "terminate", signal: "SIGTERM", graceMs: LIMITS.termKillGraceMs });
    } catch {
      /* channel gone; rescue path below */
    }
    const term = await awaitTerminal(Date.now() + LIMITS.reapDeadlineMs, activeStreams, { rescueOnDeadline: true });
    const terminalProofOk = term.terminal && !term.rescued;
    safeRecord({ type: "normal-close-result", ...term, terminalProofOk });
    return finalize(
      term.rescued ? "normal-close-rescue" : term.terminal ? "normal-teardown" : "normal-close-residual",
      term.terminal ? 0 : 3,
      { terminalProofOk, terminal: term.terminal, rescueUsed: term.rescued },
      { killOwned: !term.terminal },
    );
  }

  /* bootstrap-kill: SIGKILL ONLY the disposable supervisor, never helper/root. */
  const killed = signalPidOnly(supEntry.pid, "SIGKILL");
  if (!killed) return finalize("SUPERVISOR_SIGNAL", 3, { stage: "bootstrap-kill" }, { killOwned: true });
  const killAt = Date.now();
  safeRecord({ type: "bootstrap-kill", supervisor: supEntry.pid, at: new Date(killAt).toISOString() });

  const observeAt = LIMITS.observeBeforeExpiryMs;
  if (Date.now() - killAt < observeAt) await delay(observeAt - (Date.now() - killAt));
  const observedLive = liveOwnedSafe();
  safeRecord({ type: "observation", at: new Date().toISOString(), survivors: observedLive });

  /* One absolute terminal deadline: 3s self-expiry then one <=2s reap window. */
  const deadlineAt = killAt + LIMITS.selfExpiryMs + LIMITS.reapDeadlineMs;
  const term = await awaitTerminal(deadlineAt, activeStreams, { rescueOnDeadline: true });
  const terminalWithoutRescue = term.terminal && !term.rescued;
  safeRecord({ type: "bootstrap-kill-result", ...term, observedSurvivors: observedLive.length, terminalWithoutRescue });
  const outcome = term.rescued
    ? "bootstrap-kill-rescue"
    : !term.terminal
      ? "bootstrap-kill-residual"
      : observedLive.length > 0
        ? "bootstrap-kill-self-expiry"
        : "bootstrap-kill-terminal";
  return finalize(
    outcome,
    term.terminal ? 0 : 3,
    { observedSurvivors: observedLive.length, terminalWithoutRescue, terminal: term.terminal, rescueUsed: term.rescued },
    { killOwned: !term.terminal },
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
  if (!entry) return finalize("UNKNOWN_OWNERSHIP", 3, { stage: "worker-smoke" }, { killOwned: true });

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
  if (!lifecycleCheck.ok) {
    return finalize("WORKER_LIFECYCLE", 3, { lifecycle, lifecycleCheck, terminal: false }, { killOwned: true });
  }
  const term = await awaitTerminal(
    Math.min(hardDeadlineAt, Date.now() + LIMITS.reapDeadlineMs),
    activeStreams,
    { rescueOnDeadline: true },
  );
  if (pendingFailure) return finalize(pendingFailure.code, 3, pendingFailure.extra, { killOwned: true });
  if (!term.terminal) {
    return finalize("RESIDUAL", 3, { lifecycle, terminal: false, rescueUsed: term.rescued }, { killOwned: true });
  }
  if (exit.code !== 0) {
    return finalize("worker-smoke-refused", 3, { lifecycle, terminal: true, rescueUsed: term.rescued }, { killOwned: false });
  }
  return finalize(
    "worker-smoke-complete",
    0,
    { lifecycle, terminalProofOk: term.terminal && !term.rescued, terminal: true, rescueUsed: term.rescued },
    { killOwned: false },
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
  if (error instanceof ProbeFail) await finalize(error.code, 3, error.extra, { killOwned: true });
  else await finalize("probe-error", 3, { message: String(error?.message ?? error) }, { killOwned: true });
}
