/**
 * Frozen-validator Q probe — worker-smoke lifecycle preload (THE-574).
 *
 * SOURCE-ONLY PROPOSAL. Probe-specific lifecycle; built-ins only, no product,
 * Git, DB, provider or network import. Installs the exact ordered worker graph
 * guard for the single pinned Vitest forks worker, enforces a closed worker env
 * (only FORCE_TTY="" is admissible) and relays the Vitest worker's own lifecycle
 * messages to the observer over the observer-supplied IPC channel so that
 * start/started/run/testfileFinished are independently observable.
 *
 * This never replaces the frozen validator preload and grants no execution
 * authority or validator verdict.
 */

import { createRequire, syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);
const HOST_ROOT = path.resolve(HERE, "../../../..");

function send(message) {
  if (typeof process.send === "function") {
    try {
      process.send(message);
    } catch {
      /* observer channel closed */
    }
  }
}

const require = createRequire(path.join(HOST_ROOT, "package.json"));
let vitestPackageDir = null;
try {
  vitestPackageDir = path.dirname(require.resolve("vitest/package.json"));
} catch {
  process.stderr.write("PROBE_TOOLCHAIN: pinned Vitest is not resolvable\n");
  process.exit(3);
}
const SUPPRESS_WARNINGS = path.join(vitestPackageDir, "suppress-warnings.cjs");
const FORKS_WORKER = path.join(vitestPackageDir, "dist/workers/forks.js");
if (!fs.existsSync(SUPPRESS_WARNINGS) || !fs.existsSync(FORKS_WORKER)) {
  process.stderr.write("PROBE_TOOLCHAIN: pinned Vitest worker inputs are missing\n");
  process.exit(3);
}
const CERTIFIED_EXECARGV = Object.freeze([
  "--experimental-import-meta-resolve",
  "--require",
  SUPPRESS_WARNINGS,
  "--conditions",
  "node",
  "--conditions",
  "production",
  "--import",
  SELF,
]);

const ENV_ALLOW = new Set([
  "PATH", "LANG", "LC_ALL", "HOME", "TMPDIR", "NODE_ENV", "PAPERCLIP_LOG_LEVEL",
  "PAPERCLIP_RUN_SCRATCH_DIR", "FORCE_TTY", "TEST", "VITEST", "VITEST_MODE",
  "VITEST_POOL_ID", "VITEST_WORKER_ID", "PROBE_WORK_DIR",
]);
const ENV_VALUE = new Map([
  ["NODE_ENV", "production"],
  ["TEST", "true"],
  ["VITEST", "true"],
  ["FORCE_TTY", ""],
]);

function refuse(code, message) {
  process.stderr.write(`${code}: ${message}\n`);
  process.exit(3);
}

function assertWorkerExecArgv(execArgv) {
  if (!Array.isArray(execArgv) || execArgv.length !== CERTIFIED_EXECARGV.length) {
    refuse("PROBE_WORKER_ARGV", "worker execArgv is not the exact ordered probe graph");
  }
  for (let index = 0; index < CERTIFIED_EXECARGV.length; index += 1) {
    if (execArgv[index] !== CERTIFIED_EXECARGV[index]) {
      refuse("PROBE_WORKER_ARGV", `worker execArgv token ${index} is not certified`);
    }
  }
}

function closedWorkerEnv(source) {
  if (!source || typeof source !== "object") refuse("PROBE_WORKER_ENV", "worker env must be an object");
  for (const key of Object.keys(source)) {
    if (!ENV_ALLOW.has(key)) refuse("PROBE_WORKER_ENV", `unapproved worker env key: ${key}`);
    const value = ENV_VALUE.get(key);
    if (value !== undefined && source[key] !== value) {
      refuse("PROBE_WORKER_ENV", `worker env value for ${key} is not the single admitted value`);
    }
  }
  return {
    PATH: source.PATH ?? "",
    LANG: "C",
    LC_ALL: "C",
    HOME: source.HOME,
    TMPDIR: source.TMPDIR,
    NODE_ENV: "production",
    PAPERCLIP_LOG_LEVEL: "silent",
    PAPERCLIP_RUN_SCRATCH_DIR: source.PAPERCLIP_RUN_SCRATCH_DIR,
    FORCE_TTY: "",
    TEST: source.TEST ?? "true",
    VITEST: source.VITEST ?? "true",
    VITEST_MODE: source.VITEST_MODE ?? "RUN",
    PROBE_WORK_DIR: source.PROBE_WORK_DIR,
  };
}

const childProcess = require("node:child_process");
const RAW_FORK = childProcess.fork;

function guardedFork(modulePath, args, options) {
  let real;
  try {
    real = fs.realpathSync(modulePath);
  } catch {
    refuse("PROBE_FORK", `fork module is not resolvable: ${String(modulePath)}`);
  }
  if (real !== FORKS_WORKER) refuse("PROBE_FORK", `only the pinned forks worker may fork: ${real}`);
  if (Array.isArray(args) && args.length !== 0) refuse("PROBE_FORK", "forks worker argv must be empty");
  if (!options || typeof options !== "object") refuse("PROBE_FORK", "worker options are missing");
  if (options.shell || options.detached) refuse("PROBE_FORK", "worker shell/detached must be false");
  assertWorkerExecArgv(options.execArgv);
  const env = closedWorkerEnv(options.env);
  const child = RAW_FORK(modulePath, args, {
    ...options,
    env,
    shell: false,
    detached: false,
  });
  if (typeof child.on === "function") {
    child.on("message", (message) => {
      if (!message || typeof message !== "object" || typeof message.type !== "string") return;
      send({ type: `probe-worker:${message.type}`, at: Date.now() });
    });
  }
  send({ type: "probe-fork-admitted", pid: child.pid ?? null, at: Date.now() });
  return child;
}

function refuseLaunch() {
  throw new Error("PROBE_CHILD: only the pinned Vitest forks worker may launch a child");
}

childProcess.fork = guardedFork;
childProcess.spawn = refuseLaunch;
childProcess.spawnSync = refuseLaunch;
childProcess.exec = refuseLaunch;
childProcess.execSync = refuseLaunch;
childProcess.execFile = refuseLaunch;
childProcess.execFileSync = refuseLaunch;
syncBuiltinESMExports();

send({ type: "probe-preload-ready", at: Date.now() });
