/**
 * Frozen-validator Q probe — disposable surrogate supervisor (THE-574).
 *
 * SOURCE-ONLY PROPOSAL. Not installable authority and not a runtime PASS. This
 * file is a separate pinned probe source, deliberately disjoint from the frozen
 * validator payload/assertions. Built-ins only: no product, Git, DB, provider or
 * network import. It spawns exactly one surrogate child (which spawns one
 * grandchild) with the packet graph and relays child messages to the observer
 * over the observer-supplied IPC channel.
 *
 * Parent-death containment remains UNPROVED. This supervisor never claims a
 * positive containment result; the observer owns observation and rescue scoring.
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
});

let stdioBytes = 0;
let overLimit = false;
let stdoutChunks = [];
let stderrChunks = [];
function account(chunk, sink) {
  stdioBytes += chunk.length;
  if (stdioBytes > LIMITS.stdioMaxBytes) {
    overLimit = true;
    return;
  }
  sink.push(chunk);
}

const child = spawn(NODE, [CHILD], {
  cwd: HOST_ROOT,
  env: closedProbeEnv,
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  detached: true,
  shell: false,
});
child.stdout.on("data", (chunk) => account(chunk, stdoutChunks));
child.stderr.on("data", (chunk) => account(chunk, stderrChunks));

child.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "ready") {
    send({ type: "child-ready", child: message.child, grandchild: message.grandchild, supervisor: process.pid });
    return;
  }
  send(message);
});
child.on("error", (error) => send({ type: "child-error", message: String(error?.message ?? error) }));

let terminated = false;
function terminateGroup(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}
function finish(exitCode) {
  const row = {
    type: "supervisor-exit",
    supervisor: process.pid,
    child: child.pid ?? null,
    stdioBytes,
    overLimit,
  };
  if (JSON.stringify(row).length <= LIMITS.rowMaxBytes) send(row);
  process.exit(exitCode);
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type !== "terminate" || terminated) return;
  terminated = true;
  terminateGroup("SIGTERM");
  const killTimer = setTimeout(() => terminateGroup("SIGKILL"), LIMITS.termKillGraceMs);
  child.once("exit", () => {
    clearTimeout(killTimer);
    try {
      child.disconnect();
    } catch {
      /* ignore */
    }
    finish(overLimit ? 4 : 0);
  });
});

/* Self-expiry is defense-in-depth only, never a parent-death proof. */
const selfExpiry = setTimeout(() => {
  terminateGroup("SIGKILL");
  finish(overLimit ? 4 : 0);
}, LIMITS.selfExpiryMs);

child.once("exit", () => {
  clearTimeout(selfExpiry);
  try {
    child.disconnect();
  } catch {
    /* ignore */
  }
  finish(overLimit ? 4 : 0);
});
