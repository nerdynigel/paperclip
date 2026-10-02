/**
 * Frozen-validator Q probe — disposable surrogate supervisor (THE-574, Q′ = RC-1/RC-3).
 *
 * SOURCE-ONLY PROPOSAL. Not installable authority and not a runtime PASS. This
 * file is a separate pinned probe source, deliberately disjoint from the frozen
 * validator payload/assertions. Built-ins only: no product, Git, DB, provider or
 * network import. It spawns exactly one surrogate child (which spawns one
 * grandchild) with the packet graph and relays child messages to the observer
 * over the observer-supplied IPC channel.
 *
 * Implements the THE-581 accepted correction contract:
 *  RC-1 one absolute terminal-proof deadline D = proofStart + 2000 ms, with the
 *       500 ms TERM/KILL escalation scheduled at min(proofStart+500, D); no
 *       post-D awaited kill or grace; a post-D signal is synchronous, freshly
 *       identity-revalidated, recorded and never terminal.
 *  RC-3 numeric /proc parsing, visibility errors latched (never "no members"),
 *       recorded-identity/ancestry verification of every visible group member,
 *       reuse detection, and no signal without full verification.
 * The identity-check -> group-signal race remains explicitly UNPROVED.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_ROOT = path.resolve(HERE, "../../../..");
const NODE = process.execPath;
const CHILD = path.join(HERE, "probe-surrogate-child.mjs");

const LIMITS = Object.freeze({
  selfExpiryMs: 3000,
  termKillGraceMs: 500,
  reapDeadlineMs: 2000,
  stdioMaxBytes: 1048576,
  rowMaxBytes: 65536,
});

function send(message) {
  if (typeof process.send === "function") {
    try {
      process.send(message);
    } catch {
      /* observer closed the channel */
    }
  }
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
let unknownVisibility = false;
let unknownOwnership = false;
/* returns object | null (gone) | undefined (unknown visibility) */
function procStat(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  let raw;
  try {
    raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    unknownVisibility = true;
    return undefined;
  }
  const close = raw.lastIndexOf(")");
  if (close < 0) {
    unknownVisibility = true;
    return undefined;
  }
  const fields = raw.slice(close + 2).trim().split(/\s+/);
  const starttime = Number.parseInt(fields[19], 10);
  if (!Number.isSafeInteger(starttime)) {
    unknownVisibility = true;
    return undefined;
  }
  return { state: fields[0], ppid: Number.parseInt(fields[1], 10), pgid: Number.parseInt(fields[2], 10), starttime, starttimeRaw: fields[19] };
}
function procList() {
  let entries;
  try {
    entries = fs.readdirSync("/proc");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    unknownVisibility = true;
    return null;
  }
  return entries.filter((name) => /^[0-9]+$/.test(name)).map((name) => Number.parseInt(name, 10));
}

const work = path.resolve(process.env.PROBE_WORK_DIR ?? ".");
for (const dir of [work, path.join(work, "home"), path.join(work, "tmp")]) {
  try {
    fs.mkdirSync(dir, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}
const home = path.join(work, "home");
const tmp = path.join(work, "tmp");

const closedProbeEnv = Object.freeze({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  HOME: home,
  TMPDIR: tmp,
  NODE_ENV: "production",
  PAPERCLIP_LOG_LEVEL: "silent",
  FORCE_TTY: "",
  PROBE_WORK_DIR: work,
});

const child = spawn(NODE, [CHILD], {
  cwd: HOST_ROOT,
  env: closedProbeEnv,
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  detached: true,
  shell: false,
});
const record = procStat(child.pid);
if (record === undefined || record === null || record.ppid !== process.pid || record.pgid !== child.pid) {
  send({ type: "supervisor-error", code: "CHILD_ANCESTRY", child: child.pid ?? null });
  process.exit(3);
}
const grandchildRecords = new Map();
send({
  type: "supervisor-child",
  supervisor: process.pid,
  child: child.pid,
  childStarttime: record.starttime,
  childPgid: record.pgid,
});

let stdioBytes = 0;
let overLimit = false;
function account(chunk) {
  stdioBytes += chunk.length;
  if (stdioBytes > LIMITS.stdioMaxBytes) overLimit = true;
}
let stdoutClosed = false;
let stderrClosed = false;
child.stdout.on("data", account);
child.stderr.on("data", account);
child.stdout.on("close", () => {
  stdoutClosed = true;
});
child.stderr.on("close", () => {
  stderrClosed = true;
});

/* RC-3: every visible member must verify by recorded match or fresh ancestry. */
function visibleMembers() {
  const list = procList();
  if (list === null) return null;
  const members = [];
  for (const pid of list) {
    const stat = procStat(pid);
    if (stat === undefined) return null;
    if (stat === null) continue;
    if (stat.pgid !== child.pid) continue;
    members.push({ pid, ppid: stat.ppid, pgid: stat.pgid, starttime: stat.starttime, starttimeRaw: stat.starttimeRaw });
  }
  return members;
}
function identityMatch(member) {
  if (member.pid === child.pid) return member.starttime === record.starttime && member.pgid === record.pgid;
  const saved = grandchildRecords.get(member.pid);
  return Boolean(saved) && saved.starttime === member.starttime && saved.pgid === member.pgid;
}
function ancestryToChild(pid) {
  let current = pid;
  for (let depth = 0; depth < 12 && current > 1; depth += 1) {
    const stat = procStat(current);
    if (stat === undefined || stat === null) return false;
    if (current === child.pid) return true;
    current = stat.ppid;
  }
  return false;
}
function groupFullyVerified() {
  const members = visibleMembers();
  if (members === null) return false;
  for (const member of members) {
    if (identityMatch(member)) continue;
    if (ancestryToChild(member.pid)) continue;
    unknownOwnership = true;
    return false;
  }
  return true;
}
function groupGone() {
  const members = visibleMembers();
  if (members === null) return false; /* visibility unknown is not "gone" */
  return members.length === 0;
}
function signalGroup(signal) {
  if (!groupFullyVerified()) return false;
  const members = visibleMembers();
  if (members === null || members.length === 0) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    return false;
  }
}

let terminating = false;
/* RC-1: single absolute deadline; 500 ms escalation inside it; no post-D await. */
async function terminalProof(reason) {
  const proofStart = Date.now();
  const deadline = proofStart + LIMITS.reapDeadlineMs;
  const killAt = Math.min(proofStart + LIMITS.termKillGraceMs, deadline);
  let killSent = false;
  for (;;) {
    if (groupGone() && stdoutClosed && stderrClosed) {
      return { terminal: true, groupGone: true, stdioClosed: true, residual: false, visibilityUnknown: unknownVisibility, reason };
    }
    const now = Date.now();
    if (!killSent && now >= killAt) {
      killSent = true;
      signalGroup("SIGKILL"); /* synchronous, freshly revalidated, recorded by caller */
    }
    if (now >= deadline) {
      const gone = groupGone();
      const stdio = stdoutClosed && stderrClosed;
      return { terminal: gone && stdio && !unknownVisibility, groupGone: gone, stdioClosed: stdio, residual: !gone, visibilityUnknown: unknownVisibility, reason };
    }
    /* Never sleep past the absolute deadline (RC-1 <=2000 ms). */
    await delay(Math.min(LIMITS.pollIntervalMs, Math.max(0, deadline - now)));
  }
}
async function terminateAndReport(reason) {
  if (terminating) return;
  terminating = true;
  signalGroup("SIGTERM");
  const proof = await terminalProof(reason);
  try {
    child.disconnect();
  } catch {
    /* ignore */
  }
  send({ type: "supervisor-exit", reason, overLimit, stdioBytes, ...proof });
  process.exit(overLimit ? 4 : proof.terminal ? 0 : 3);
}

child.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "ready") {
    const gcStat = procStat(message.grandchild);
    if (gcStat === undefined) {
      unknownVisibility = true;
    } else if (gcStat !== null) {
      grandchildRecords.set(message.grandchild, { starttime: gcStat.starttime, pgid: gcStat.pgid });
    }
    send({
      type: "child-ready",
      child: message.child,
      grandchild: message.grandchild,
      supervisor: process.pid,
    });
    return;
  }
  send(message);
});
child.on("error", (error) => send({ type: "child-error", message: String(error?.message ?? error) }));
/* A child exit never cancels group escalation: orphaned group members must die. */
child.once("exit", () => {
  if (!terminating) void terminateAndReport("child-exit");
});
process.on("message", (message) => {
  if (message && typeof message === "object" && message.type === "terminate") {
    void terminateAndReport("terminate-request");
  }
});
/* Self-expiry is defense-in-depth only, never a parent-death proof. */
setTimeout(() => {
  if (!terminating) void terminateAndReport("self-expiry");
}, LIMITS.selfExpiryMs);
