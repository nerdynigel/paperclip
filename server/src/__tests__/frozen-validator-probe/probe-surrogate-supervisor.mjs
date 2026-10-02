/**
 * Frozen-validator Q probe — disposable surrogate supervisor (THE-574, F″ correction).
 *
 * SOURCE-ONLY PROPOSAL. Not installable authority and not a runtime PASS. This
 * file is a separate pinned probe source, deliberately disjoint from the frozen
 * validator payload/assertions. Built-ins only: no product, Git, DB, provider or
 * network import. It spawns exactly one surrogate child (which spawns one
 * grandchild) with the packet graph and relays child messages to the observer
 * over the observer-supplied IPC channel.
 *
 * Corrections at F″ (THE-575 adverse rows): bind the child to PID/starttime/
 * current PGID and ancestry before any signal; discover owned group membership
 * independently of a live group leader; terminal requires no live owned
 * descendant AND stdio close, and a child exit never cancels group escalation
 * or prematurely scores success; enforce a single <=2s reap bound and 500ms
 * TERM/KILL. Parent-death containment remains UNPROVED and is never positive.
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

const work = path.resolve(process.env.PROBE_WORK_DIR ?? ".");
fs.mkdirSync(work, { recursive: true, mode: 0o700 });
const home = path.join(work, "home");
const tmp = path.join(work, "tmp");
fs.mkdirSync(home, { recursive: true, mode: 0o700 });
fs.mkdirSync(tmp, { recursive: true, mode: 0o700 });

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
if (!record || record.ppid !== process.pid || record.pgid !== child.pid) {
  send({ type: "supervisor-error", code: "CHILD_ANCESTRY", child: child.pid ?? null });
  process.exit(3);
}
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

/* Owned group membership is discovered from /proc by PGID, independent of a
 * live leader; only members started at/after the recorded leader are admitted. */
function groupMembers() {
  const members = [];
  let entries;
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return members;
  }
  for (const name of entries) {
    if (!/^[0-9]+$/.test(name)) continue;
    const pid = Number.parseInt(name, 10);
    const stat = procStat(pid);
    if (!stat || stat.pgid !== child.pid) continue;
    if (stat.starttime < record.starttime) continue;
    members.push({ pid, ppid: stat.ppid, pgid: stat.pgid, starttime: stat.starttime });
  }
  return members;
}
function groupOwned() {
  return groupMembers().length > 0;
}
function signalGroup(signal) {
  if (!groupOwned()) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    return false;
  }
}

let terminating = false;
async function terminalProof(reason) {
  const deadline = Date.now() + LIMITS.reapDeadlineMs;
  let killTimer = null;
  killTimer = setTimeout(() => signalGroup("SIGKILL"), LIMITS.termKillGraceMs);
  while (Date.now() < deadline) {
    if (!groupOwned() && stdoutClosed && stderrClosed) {
      clearTimeout(killTimer);
      return { terminal: true, groupGone: true, stdioClosed: true, residual: false, reason };
    }
    await delay(25);
  }
  signalGroup("SIGKILL");
  const grace = Date.now() + LIMITS.termKillGraceMs;
  while (Date.now() < grace) {
    if (!groupOwned() && stdoutClosed && stderrClosed) break;
    await delay(25);
  }
  clearTimeout(killTimer);
  const groupGone = !groupOwned();
  const stdioClosed = stdoutClosed && stderrClosed;
  return { terminal: groupGone && stdioClosed, groupGone, stdioClosed, residual: !groupGone, reason };
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
