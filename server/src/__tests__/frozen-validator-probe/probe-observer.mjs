/**
 * Frozen-validator Q probe — disposable observer / entrypoint (THE-574, Q′ = RC-1..RC-4).
 *
 * SOURCE-ONLY PROPOSAL. Not installable authority and not a runtime PASS. The
 * canonical Q token in the accepted packet top-level argv is this file:
 *
 *   <N> <H>/server/src/__tests__/frozen-validator-probe/probe-observer.mjs <mode>
 *
 * Modes: normal-close | bootstrap-kill | worker-smoke. Built-ins only. No
 * product/Git/DB/provider/network import, no shell, no live-process killing.
 *
 * Implements the THE-581 accepted correction contract RC-1..RC-4:
 *  RC-1 supervisor terminal proof <=2s incl. 500ms escalation (see supervisor).
 *  RC-2 one reserved bounded cleanup phase per failure/ceiling/lifecycle/hard
 *       path; hard trigger at t0+8s reserves the 10s tail; single clamp.
 *  RC-3 numeric fail-closed ownership; unknown /proc visibility never terminal
 *       nor signal authority; all-member group verification; reuse detection.
 *  RC-4 canonical unique owned scratch; every write (incl. fallback marker)
 *       bounded <=4MiB; exclusive no-follow evidence writes.
 * The identity-check -> group-signal race remains explicitly UNPROVED (no
 * pidfd/cgroup with Node built-ins). Rescue is never positive containment.
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
  // Statically >= the maximum serialized fallback marker (fixed key set,
  // enum mode/outcome, numeric projected).
  markerReserveBytes: 2048,
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
const t0 = Date.now();
const hardDeadlineAt = t0 + LIMITS.hardTimeoutMs;

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

/* -------------------- RC-4: canonical unique owned scratch ---------------- */
const scratchRaw = process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? "";
if (!path.isAbsolute(scratchRaw)) {
  process.stderr.write("PROBE_SCRATCH: PAPERCLIP_RUN_SCRATCH_DIR must be absolute and run-owned\n");
  process.exit(2);
}
const resolvedScratch = path.resolve(scratchRaw);
let realScratch;
try {
  realScratch = fs.realpathSync(resolvedScratch);
} catch {
  process.stderr.write("PROBE_SCRATCH: scratch does not exist\n");
  process.exit(2);
}
if (realScratch !== resolvedScratch) {
  process.stderr.write("PROBE_SCRATCH: scratch path is not canonical (symlink alias)\n");
  process.exit(2);
}
const scratchStat = fs.lstatSync(resolvedScratch);
if (!scratchStat.isDirectory() || scratchStat.isSymbolicLink()) {
  process.stderr.write("PROBE_SCRATCH: scratch must be a real directory\n");
  process.exit(2);
}
if (typeof process.getuid === "function" && scratchStat.uid !== process.getuid()) {
  process.stderr.write("PROBE_SCRATCH_OWNER: scratch is not owned by the executing UID\n");
  process.exit(2);
}
if ((scratchStat.mode & 0o022) !== 0) {
  process.stderr.write("PROBE_SCRATCH_MODE: scratch must not be group/other writable\n");
  process.exit(2);
}
function exclusiveMkdir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") {
      process.stderr.write(`PROBE_SCRATCH_EXISTS: refusing pre-existing path ${dir}\n`);
      process.exit(2);
    }
    throw error;
  }
}
const probeDir = path.join(resolvedScratch, "probe");
const work = path.join(probeDir, "work");
const evidence = path.join(probeDir, "evidence");
exclusiveMkdir(probeDir);
exclusiveMkdir(work);
exclusiveMkdir(evidence);
exclusiveMkdir(path.join(work, "home"));
exclusiveMkdir(path.join(work, "tmp"));
const probeReal = fs.realpathSync(probeDir);
const probeHome = path.join(work, "home");
const probeTmp = path.join(work, "tmp");

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

/* -------------------- RC-3: numeric, fail-closed /proc reads -------------- */
let unknownVisibility = false;
let unknownOwnership = false;
let scratchLayoutFailure = false;

/* returns object | null (gone, ENOENT) | undefined (unknown visibility) */
function procStat(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  let raw;
  try {
    raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    unknownVisibility = true;
    safeRecord({ type: "proc-read-unknown", pid, code: error.code ?? null });
    return undefined;
  }
  const close = raw.lastIndexOf(")");
  if (close < 0) {
    unknownVisibility = true;
    safeRecord({ type: "proc-parse-unknown", pid });
    return undefined;
  }
  const fields = raw.slice(close + 2).trim().split(/\s+/);
  const starttime = Number.parseInt(fields[19], 10);
  if (!Number.isSafeInteger(starttime)) {
    unknownVisibility = true;
    safeRecord({ type: "proc-starttime-unknown", pid, raw: fields[19] ?? null });
    return undefined;
  }
  return {
    state: fields[0],
    ppid: Number.parseInt(fields[1], 10),
    pgid: Number.parseInt(fields[2], 10),
    starttime,
    starttimeRaw: fields[19],
  };
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/* returns number[] | null (unknown visibility) */
function procList() {
  let entries;
  try {
    entries = fs.readdirSync("/proc");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    unknownVisibility = true;
    safeRecord({ type: "proc-list-unknown", code: error.code ?? null });
    return null;
  }
  return entries.filter((name) => /^[0-9]+$/.test(name)).map((name) => Number.parseInt(name, 10));
}

const owned = new Map();
const ownedGroups = new Set();
let minOwnedStarttime = null;

function remember(role, pid, expectedParentPid = null) {
  const stat = procStat(pid);
  if (stat === undefined) {
    safeRecord({ type: "unknown-ownership", role, pid, reason: "visibility" });
    return null;
  }
  if (stat === null) {
    unknownOwnership = true;
    safeRecord({ type: "unknown-ownership", role, pid, reason: "gone" });
    return null;
  }
  if (expectedParentPid !== null && stat.ppid !== expectedParentPid) {
    unknownOwnership = true;
    safeRecord({ type: "ancestry-mismatch", role, pid, expectedParentPid, ppid: stat.ppid });
    return null;
  }
  const entry = { role, pid, ppid: stat.ppid, pgid: stat.pgid, starttime: stat.starttime, starttimeRaw: stat.starttimeRaw };
  owned.set(pid, entry);
  ownedGroups.add(stat.pgid);
  minOwnedStarttime = minOwnedStarttime === null ? stat.starttime : Math.min(minOwnedStarttime, stat.starttime);
  return entry;
}
function ancestryOwned(pid) {
  let current = pid;
  for (let depth = 0; depth < 12 && current > 1; depth += 1) {
    const stat = procStat(current);
    if (stat === undefined || stat === null) return false;
    if (owned.has(current)) return true;
    current = stat.ppid;
  }
  return false;
}
function visibleMembers(pgid) {
  const list = procList();
  if (list === null) return null;
  const members = [];
  for (const pid of list) {
    const stat = procStat(pid);
    if (stat === undefined) return null;
    if (stat === null) continue;
    if (stat.pgid !== pgid) continue;
    members.push({ pid, ppid: stat.ppid, pgid: stat.pgid, starttime: stat.starttime, starttimeRaw: stat.starttimeRaw });
  }
  return members;
}
/* Enumeration is never disabled by a ceiling failure and never throws. */
function liveOwned() {
  const live = [];
  for (const [pid, entry] of owned) {
    const stat = procStat(pid);
    if (stat === undefined) continue;
    if (stat === null) continue;
    if (stat.starttime !== entry.starttime || stat.pgid !== entry.pgid) {
      unknownOwnership = true;
      safeRecord({ type: "pid-reuse", role: entry.role, pid });
      continue;
    }
    live.push(entry);
  }
  for (const pgid of ownedGroups) {
    const members = visibleMembers(pgid);
    if (members === null) continue;
    for (const member of members) {
      if (owned.has(member.pid)) continue;
      if (ancestryOwned(member.pid)) {
        const entry = { role: "owned-group-member", ...member };
        owned.set(member.pid, entry);
        live.push(entry);
      } else {
        unknownOwnership = true;
        safeRecord({ type: "unverified-group-member", pid: member.pid, pgid });
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
/* RC-3 rule 6: every currently visible member of the PGID must verify. */
function groupFullyVerified(pgid) {
  const members = visibleMembers(pgid);
  if (members === null) {
    safeRecord({ type: "signal-refused", pgid, reason: "visibility-unknown" });
    return false;
  }
  for (const member of members) {
    const rec = owned.get(member.pid);
    const identityMatch = rec && rec.starttime === member.starttime && rec.pgid === member.pgid && rec.pid === member.pid;
    if (identityMatch) continue;
    if (ancestryOwned(member.pid)) continue;
    unknownOwnership = true;
    safeRecord({ type: "signal-refused", pgid, pid: member.pid, reason: "unverified-member" });
    return false;
  }
  return true;
}
function killOwnedGroups() {
  for (const pgid of ownedGroups) {
    if (!groupFullyVerified(pgid)) continue;
    const members = visibleMembers(pgid);
    if (members === null || members.length === 0) continue;
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
  const stat = procStat(pid);
  if (stat === undefined || stat === null) return false;
  if (stat.starttime !== entry.starttime || stat.pgid !== entry.pgid) {
    unknownOwnership = true;
    safeRecord({ type: "signal-refused", pid, reason: "reuse" });
    return false;
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

let activeStreams = [];
/* RC-2 rule 5: closure measured from actual close events, not destroyed. */
function streamsClosed(streams) {
  if (!Array.isArray(streams) || streams.length === 0) return true;
  return streams.every((stream) => stream.closed === true);
}

/* -------------------- RC-4: measurable bounded scratch -------------------- */
function measureTreeBytes(root) {
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      unknownVisibility = true;
      safeRecord({ type: "scratch-stat-unknown", path: current, code: error.code ?? null });
      continue;
    }
    if (stat.isSymbolicLink()) {
      scratchLayoutFailure = true;
      safeRecord({ type: "scratch-symlink", path: current });
      continue;
    }
    if (stat.isDirectory()) {
      let entries;
      try {
        entries = fs.readdirSync(current);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        unknownVisibility = true;
        safeRecord({ type: "scratch-list-unknown", path: current, code: error.code ?? null });
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
function writeFileNoFollow(file, content) {
  const parent = path.dirname(file);
  let parentReal;
  try {
    parentReal = fs.realpathSync(parent);
  } catch {
    return false;
  }
  if (parentReal !== path.resolve(parent)) return false;
  if (parentReal !== probeReal && !parentReal.startsWith(probeReal + path.sep)) return false;
  let fd;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.writeSync(fd, content);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}
function buildMarker(doc) {
  return {
    schema: "paperclip.frozen-validator.probe-observer/v1",
    mode,
    outcome: doc.outcome,
    truncated: true,
    reason: "scratch-ceiling",
    projected: doc.projected ?? null,
  };
}
/* RC-4 rule 3: budget every write, including the reserved fallback marker. */
function writeEvidence(doc) {
  const jsonl = rowLines.join("\n") + (rowLines.length ? "\n" : "");
  const json = JSON.stringify(doc, null, 2);
  const jsonlBytes = Buffer.byteLength(jsonl, "utf8");
  const jsonBytes = Buffer.byteLength(json, "utf8");
  if (scratchLayoutFailure) noteFailure("SCRATCH_LAYOUT");
  const current = measureTreeBytes(probeDir);
  if (current + jsonlBytes + jsonBytes > LIMITS.maxScratchBytes - LIMITS.markerReserveBytes) {
    noteFailure("SCRATCH_CEILING", { current, jsonlBytes, jsonBytes });
    const marker = JSON.stringify(buildMarker(doc));
    const markerBytes = Buffer.byteLength(marker, "utf8");
    if (current + markerBytes > LIMITS.maxScratchBytes) {
      noteFailure("SCRATCH_CEILING", { markerFits: false, current, markerBytes });
      return false;
    }
    return writeFileNoFollow(path.join(evidence, "probe.jsonl"), "") && writeFileNoFollow(path.join(evidence, "probe.json"), marker);
  }
  return writeFileNoFollow(path.join(evidence, "probe.jsonl"), jsonl) && writeFileNoFollow(path.join(evidence, "probe.json"), json);
}

/* --------------------------- terminal waiting ---------------------------- */
/* One absolute deadline. No post-deadline grace or fresh sub-window. */
async function awaitTerminal(deadlineAt, streams) {
  for (;;) {
    const live = liveOwned();
    if (live.length === 0 && streamsClosed(streams) && !unknownVisibility) {
      return { terminal: true, live: 0, reason: "terminal" };
    }
    if (Date.now() >= deadlineAt) {
      const remaining = liveOwned().length;
      return { terminal: remaining === 0 && streamsClosed(streams) && !unknownVisibility, live: remaining, reason: "deadline" };
    }
    /* Never sleep past the absolute deadline (RC-2 rule 6). */
    await delay(Math.min(LIMITS.pollIntervalMs, Math.max(0, deadlineAt - Date.now())));
  }
}

/* ------------------------------ finalization ----------------------------- */
/* RC-2 rule 1: hard trigger at t0+8s reserves the 10s tail for kill+reap. */
const hardTriggerTimer = setTimeout(() => {
  void finalize("hard-timeout", 3, { hardTimeout: true }, { killOwned: true, deadlineAt: hardDeadlineAt });
}, LIMITS.hardTimeoutMs - LIMITS.reapDeadlineMs);

/* RC-2 rule 2: reserved bounded rescue+reap used by every failure/residual path.
 * Never produces terminal success. */
async function rescueAndReap(reason, preferredDeadline) {
  const live = liveOwned();
  let rescued = false;
  if (live.length > 0) {
    rescued = true;
    safeRecord({ type: "observer-rescue", phase: reason, live: live.length });
  }
  killOwnedGroups();
  const deadline = Math.min(
    preferredDeadline ?? Date.now() + LIMITS.reapDeadlineMs,
    Date.now() + LIMITS.reapDeadlineMs,
    hardDeadlineAt,
  );
  const term = await awaitTerminal(deadline, activeStreams);
  return { rescued, term, deadline };
}

let finishing = false;
async function finalize(outcome, exitCode, extra = {}, options = {}) {
  if (finishing) return;
  finishing = true;
  clearTimeout(hardTriggerTimer);
  const now = Date.now();
  /* RC-2 rule 3: single clamp in one place. */
  const cleanupDeadline = Math.min(options.deadlineAt ?? now + LIMITS.reapDeadlineMs, now + LIMITS.reapDeadlineMs, hardDeadlineAt);
  let rescueUsed = extra.rescueUsed === true;
  let term;
  if (options.killOwned) {
    const result = await rescueAndReap(options.reason ?? outcome, options.deadlineAt);
    rescueUsed = rescueUsed || result.rescued;
    term = result.term;
  } else {
    term = await awaitTerminal(cleanupDeadline, activeStreams);
  }
  const scratchBytes = measureTreeBytes(probeDir);
  const scratchOk = scratchBytes <= LIMITS.maxScratchBytes && !scratchLayoutFailure;
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
    unknownVisibility,
    scratchLayoutFailure,
    totalProcesses: totalProcessCount(),
    maxProcesses: LIMITS.maxProcesses,
    processCeilingExceeded: totalProcessCount() > LIMITS.maxProcesses,
    failureCode: failure ? failure.code : null,
    failureExtra: failure ? failure.extra : null,
    hardTimeoutMs: LIMITS.hardTimeoutMs,
    maxOutputBytes: LIMITS.maxOutputBytes,
    maxRowBytes: LIMITS.maxRowBytes,
    maxScratchBytes: LIMITS.maxScratchBytes,
    markerReserveBytes: LIMITS.markerReserveBytes,
    outputBytes: rowBytes + channelBytes,
    rowBytes,
    channelBytes,
    scratchBytes,
    owned: [...owned.values()],
  };
  const evidenceOk = writeEvidence(doc);
  const terminalSuccess =
    term.terminal &&
    !unknownOwnership &&
    !unknownVisibility &&
    !scratchLayoutFailure &&
    scratchOk &&
    evidenceOk &&
    !failure &&
    exitCode === 0;
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
  if (unknownOwnership || unknownVisibility || !cleanupOk) process.exit(exitCode === 0 ? 6 : exitCode);
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
        safeRecord({ type: "ready", supervisor: supervisor.pid, child: message.child, grandchild: message.grandchild, processCount: totalProcessCount() });
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
  while (!ready && Date.now() < readyDeadline && !unknownOwnership && !unknownVisibility && !failure) {
    await delay(LIMITS.pollIntervalMs);
  }
  if (unknownOwnership || unknownVisibility) return finalize("UNKNOWN_OWNERSHIP", 3, { stage: "handshake" }, { killOwned: true });
  if (!ready) return finalize("MISSING_READY", 3, { stage: "handshake" }, { killOwned: true });
  if (totalProcessCount() > LIMITS.maxProcesses) {
    return finalize("PROCESS_CEILING", 3, { totalProcesses: totalProcessCount() }, { killOwned: true });
  }

  if (mode === "normal-close") {
    try {
      supervisor.send({ type: "terminate", signal: "SIGTERM", graceMs: LIMITS.termKillGraceMs });
    } catch {
      /* channel gone; residual path below rescues */
    }
    const phaseDeadline = Date.now() + LIMITS.reapDeadlineMs;
    const term = await awaitTerminal(phaseDeadline, activeStreams);
    safeRecord({ type: "normal-close-result", ...term, terminalProofOk: term.terminal });
    return finalize(
      term.terminal ? "normal-teardown" : "normal-close-residual",
      term.terminal ? 0 : 3,
      { terminalProofOk: term.terminal, terminal: term.terminal },
      term.terminal ? { killOwned: false, deadlineAt: phaseDeadline } : { killOwned: true },
    );
  }

  /* bootstrap-kill: SIGKILL ONLY the disposable supervisor, never helper/root. */
  const killed = signalPidOnly(supEntry.pid, "SIGKILL");
  if (!killed) return finalize("SUPERVISOR_SIGNAL", 3, { stage: "bootstrap-kill" }, { killOwned: true });
  const killAt = Date.now();
  safeRecord({ type: "bootstrap-kill", supervisor: supEntry.pid, at: new Date(killAt).toISOString() });

  const observeAt = LIMITS.observeBeforeExpiryMs;
  if (Date.now() - killAt < observeAt) await delay(observeAt - (Date.now() - killAt));
  const observedLive = liveOwned();
  safeRecord({ type: "observation", at: new Date().toISOString(), survivors: observedLive });

  /* Self-expiry window ends at killAt+3s; the reserved <=2s reap is executed
   * BEFORE the killAt+5s overall budget by finalize(). */
  const selfExpiryDeadline = killAt + LIMITS.selfExpiryMs;
  const term = await awaitTerminal(selfExpiryDeadline, activeStreams);
  safeRecord({ type: "bootstrap-kill-result", ...term, observedSurvivors: observedLive.length });
  if (term.terminal) {
    return finalize(
      observedLive.length > 0 ? "bootstrap-kill-self-expiry" : "bootstrap-kill-terminal",
      0,
      { observedSurvivors: observedLive.length, terminalWithoutRescue: true, terminal: true },
      { killOwned: false, deadlineAt: selfExpiryDeadline },
    );
  }
  return finalize(
    "bootstrap-kill-rescue",
    3,
    { observedSurvivors: observedLive.length, terminalWithoutRescue: false, terminal: false },
    { killOwned: true },
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
      env: { ...closedProbeEnv, PAPERCLIP_RUN_SCRATCH_DIR: realScratch },
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
  /* RC-2 rule 4: this bounded window is used for the failure cleanup too. */
  const deadlineAt = Math.min(hardDeadlineAt, Date.now() + LIMITS.reapDeadlineMs);
  if (!lifecycleCheck.ok) {
    return finalize(
      "WORKER_LIFECYCLE",
      3,
      { lifecycle, lifecycleCheck, terminal: false },
      { killOwned: true, deadlineAt },
    );
  }
  const term = await awaitTerminal(deadlineAt, activeStreams);
  if (!term.terminal) {
    return finalize("RESIDUAL", 3, { lifecycle, terminal: false }, { killOwned: true });
  }
  if (exit.code !== 0) {
    return finalize("worker-smoke-refused", 3, { lifecycle, terminal: true }, { killOwned: false, deadlineAt });
  }
  return finalize(
    "worker-smoke-complete",
    0,
    { lifecycle, terminalProofOk: term.terminal, terminal: true },
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
  await finalize("probe-error", 3, { message: String(error?.message ?? error) }, { killOwned: true });
}
