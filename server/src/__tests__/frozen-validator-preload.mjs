/**
 * Frozen validator worker preload (THE-567, corrective contract v4 + V4 residuals).
 *
 * Runs via `node --import` before Vitest evaluates its config or the fixture.
 * Repeats the attach-phase guards, then installs the exact-token Git policy, the
 * compatible child_process surface, and an authenticated monotonic per-instance
 * accounting relay. Non-Git child launches are admitted only for the exact
 * certified Vitest forks-worker graph.
 *
 * STATIC / UNEXECUTED. Built-ins plus the host loader guard module only.
 */

import { createRequire, syncBuiltinESMExports } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  debitLedger,
  FixtureGuardError,
  getValidatedRoleContext,
  planGitLaunch,
  returnLedgerTransfer,
  transferLedger,
} from "./frozen-validator-loader.mjs";

function sha256FileSync(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const reportToken = process.env.PC_FROZEN_VALIDATOR_REPORT_TOKEN ?? "";
const instanceId = randomUUID();
const parentInstanceId = process.env.PC_FROZEN_VALIDATOR_INSTANCE_ID ?? null;
let seq = 0;

function sendUp(message) {
  if (typeof process.send === "function") {
    try {
      if (process.send(message) === false) context.ipcBackpressure = (context.ipcBackpressure ?? 0) + 1;
    } catch {
      context.ipcDisconnected = true;
    }
  }
}

function emitReport(delta) {
  seq += 1;
  sendUp({
    type: "frozen-validator-git",
    v: 4,
    token: reportToken,
    instanceId,
    parentInstanceId,
    seq,
    delta,
    spent: ledger.spent,
    remaining: ledger.remaining,
  });
}

const context = getValidatedRoleContext({
  reporter: (accounting) => {
    seq += 1;
    sendUp({
      type: "frozen-validator-git",
      v: 4,
      token: reportToken,
      instanceId,
      parentInstanceId,
      seq,
      delta: accounting.gitCalls,
      spent: accounting.gitCalls,
      remaining: accounting.remaining,
    });
  },
});
const ledger = context.ledger;

function forwardUpstream(message) {
  if (!message || typeof message !== "object") return;
  if (message.type !== "frozen-validator-git") return;
  if (reportToken && message.token !== reportToken) return;
  sendUp(message);
}

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const RAW = {
  execFile: childProcess.execFile,
  execFileSync: childProcess.execFileSync,
  spawn: childProcess.spawn,
  spawnSync: childProcess.spawnSync,
  fork: childProcess.fork,
};

const reposRoot = path.resolve(context.dirs.repos);
const PINNED_PRELOAD = path.join(context.hostRoot, "server/src/__tests__/frozen-validator-preload.mjs");
const FORKS_WORKER = path.join(context.toolchain.vitest.packageDir, "dist/workers/forks.js");
const FORKS_WORKER_SHA = context.manifest.closure?.workerFiles?.V?.["dist/workers/forks.js"] ?? null;
const SUPPRESS_WARNINGS = path.join(context.toolchain.vitest.packageDir, "suppress-warnings.cjs");
const CERTIFIED_WORKER_EXECARGV = Object.freeze([
  "--experimental-import-meta-resolve",
  "--require",
  SUPPRESS_WARNINGS,
  "--conditions",
  "node",
  "--conditions",
  "production",
  "--import",
  PINNED_PRELOAD,
]);
const WORKER_ENV_ALLOW = new Set([
  "PATH", "LANG", "LC_ALL", "HOME", "PAPERCLIP_HOME", "TMPDIR", "NODE_ENV", "PAPERCLIP_LOG_LEVEL",
  "PAPERCLIP_RUN_SCRATCH_DIR", "PC_FROZEN_VALIDATOR_ROLE", "PC_FROZEN_VALIDATOR_HOST_SHA",
  "PC_FROZEN_VALIDATOR_MANIFEST_SHA256", "PC_FROZEN_VALIDATOR_NODE", "PC_FROZEN_VALIDATOR_PHASE",
  "PC_FROZEN_VALIDATOR_RECEIPT_NONCE", "PC_FROZEN_VALIDATOR_BOOTSTRAP_PID",
  "PC_FROZEN_VALIDATOR_INSTANCE_ID", "PC_FROZEN_VALIDATOR_REPORT_TOKEN",
  "PC_FROZEN_VALIDATOR_GIT_ALLOCATION", "PC_FROZEN_VALIDATOR_GIT_OBSERVED_BASE",
  "PAPERCLIP_RUN_ID", "PAPERCLIP_AGENT_ID", "PAPERCLIP_COMPANY_ID",
  "TEST", "VITEST", "VITEST_MODE", "VITEST_POOL_ID", "VITEST_WORKER_ID",
  // Source-backed (Vitest 4.1.11 dist/chunks/cli-api.CnMVyzaz.js resolveOptions):
  // the framework injects `FORCE_TTY: isatty(1) ? "true" : ""` into the worker
  // env. Under this fixture the stdio graph is always pipe/no-TTY, so the only
  // admissible value is the empty string. A missing key is tolerated; any other
  // value is refused below. This is NOT a general inherited-env widening.
  "FORCE_TTY",
]);

/* Source-backed admissible worker-env values (key -> the single allowed value). */
const WORKER_ENV_ALLOWED_VALUE = new Map([
  ["NODE_ENV", "production"],
  ["TEST", "true"],
  ["VITEST", "true"],
  ["FORCE_TTY", ""],
]);

function refuse(code, message) {
  throw new FixtureGuardError(code, message);
}

/* Residual 3: no admitted Git child may run through a shell. */
function assertNoShell(options) {
  if (options && options.shell) refuse("SHELL_FORBIDDEN", "shell execution is not permitted for Git launches");
}

function admitGit(plan) {
  debitLedger(ledger, 1);
  emitReport(1);
  return plan;
}

function hardenedGitOptions(options, cwd) {
  return {
    ...(options ?? {}),
    cwd,
    shell: false,
    env: { ...context.git.env, GIT_CEILING_DIRECTORIES: reposRoot },
    timeout: context.ceilings.gitCallTimeoutMs,
    maxBuffer: context.ceilings.gitCallMaxOutputBytes,
  };
}

function decorate(error, stdout, stderr) {
  const target = new Error(error?.message ?? "launch failure");
  target.code = error?.code;
  target.signal = error?.signal;
  target.cmd = error?.cmd;
  target.killed = error?.killed;
  target.stdout = stdout;
  target.stderr = stderr;
  return target;
}

/* ------------------------------------------------------------------------- */
/* Contract C: normalize / admit / launch with compatible promisify surface   */
/* ------------------------------------------------------------------------- */

function normalizeExecFileArgs(file, args, options, callback) {
  let normalizedArgs = [];
  let normalizedOptions = {};
  let normalizedCallback = null;
  if (Array.isArray(args)) {
    normalizedArgs = args;
    if (typeof options === "function") normalizedCallback = options;
    else {
      normalizedOptions = options ?? {};
      normalizedCallback = typeof callback === "function" ? callback : null;
    }
  } else if (typeof args === "function") {
    normalizedCallback = args;
  } else if (args && typeof args === "object") {
    normalizedOptions = args;
    normalizedCallback = typeof options === "function" ? options : null;
  } else if (args === undefined || args === null) {
    normalizedOptions = typeof options === "object" && options !== null ? options : {};
    normalizedCallback = typeof callback === "function" ? callback : null;
  } else {
    throw new TypeError("execFile: invalid argument shape");
  }
  if (typeof file !== "string") throw new TypeError("execFile: file must be a string");
  if (!Array.isArray(normalizedArgs)) throw new TypeError("execFile: args must be an array");
  return { file, args: normalizedArgs, options: normalizedOptions, callback: normalizedCallback };
}

function admitLaunch(norm) {
  if (norm.file !== "git") refuse("CHILD_FORBIDDEN", "only admitted Git may launch through execFile");
  assertNoShell(norm.options);
  const plan = planGitLaunch({ args: norm.args, cwd: norm.options.cwd, reposRoot });
  admitGit(plan);
  return plan;
}

function launchAdmitted(plan, norm, callback) {
  return RAW.execFile("git", plan.argv, hardenedGitOptions(norm.options, plan.cwd), callback);
}

function guardedExecFile(file, args, options, callback) {
  const norm = normalizeExecFileArgs(file, args, options, callback);
  let plan;
  try {
    plan = admitLaunch(norm);
  } catch (refusal) {
    if (typeof norm.callback === "function") throw refusal;
    return Promise.reject(refusal);
  }
  if (typeof norm.callback === "function") {
    return launchAdmitted(plan, norm, (error, stdout, stderr) =>
      norm.callback(error ? decorate(error, stdout, stderr) : null, stdout, stderr),
    );
  }
  return promisifiedExecFile(norm, plan);
}

function promisifiedExecFile(norm, plan) {
  let setResult = null;
  let buffered = null;
  const promise = new Promise((resolve, reject) => {
    setResult = { resolve, reject };
  });
  const onSettled = (error, stdout, stderr) => {
    const action = error
      ? () => setResult.reject(decorate(error, stdout, stderr))
      : () => setResult.resolve({ stdout, stderr });
    if (setResult) action();
    else buffered = action;
  };
  let child;
  try {
    child = launchAdmitted(plan, norm, onSettled);
  } catch (launchError) {
    return Promise.reject(decorate(launchError));
  }
  if (buffered) buffered();
  promise.child = child;
  promise.kill = (signal) => child.kill(signal ?? "SIGTERM");
  return promise;
}

function guardedExecFileSync(file, args, options) {
  if (file !== "git") refuse("CHILD_FORBIDDEN", "only admitted Git may run through execFileSync");
  const norm = normalizeExecFileArgs(file, args, options);
  assertNoShell(norm.options);
  const plan = admitLaunch(norm);
  return RAW.execFileSync("git", plan.argv, hardenedGitOptions(norm.options, plan.cwd));
}

/* ------------------------------------------------------------------------- */
/* Residual 2: exact certified worker graph for fork; spawn is Git-only      */
/* ------------------------------------------------------------------------- */

function assertWorkerExecArgv(execArgv) {
  if (!Array.isArray(execArgv) || execArgv.length !== CERTIFIED_WORKER_EXECARGV.length) {
    refuse("CHILD_FORBIDDEN", "worker execArgv is not the exact certified token graph");
  }
  for (let index = 0; index < CERTIFIED_WORKER_EXECARGV.length; index += 1) {
    if (execArgv[index] !== CERTIFIED_WORKER_EXECARGV[index]) {
      refuse("CHILD_FORBIDDEN", `worker execArgv token ${index} is not certified`);
    }
  }
}

function assertWorkerEnv(env) {
  if (env === undefined) return;
  if (!env || typeof env !== "object") refuse("CHILD_FORBIDDEN", "worker env must be an object");
  for (const key of Object.keys(env)) {
    if (!WORKER_ENV_ALLOW.has(key)) refuse("CHILD_FORBIDDEN", `unapproved worker env key: ${key}`);
    const allowedValue = WORKER_ENV_ALLOWED_VALUE.get(key);
    if (allowedValue !== undefined && env[key] !== allowedValue) {
      refuse("CHILD_FORBIDDEN", `worker env value for ${key} is not the single admitted value`);
    }
  }
  if (env.FORCE_TTY !== undefined && env.FORCE_TTY !== "") {
    refuse("CHILD_FORBIDDEN", "FORCE_TTY may only be the empty pipe/no-TTY value");
  }
}

function assertWorkerOptions(options) {
  if (!options || typeof options !== "object") refuse("CHILD_FORBIDDEN", "worker options are missing");
  if (options.shell) refuse("CHILD_FORBIDDEN", "worker shell must be false");
  if (options.detached) refuse("CHILD_FORBIDDEN", "worker detached must be false");
  if (options.execPath !== undefined && options.execPath !== context.node) {
    refuse("CHILD_FORBIDDEN", "worker execPath is not the pinned Node");
  }
  if (path.resolve(process.cwd()) !== context.hostRoot) {
    refuse("CHILD_FORBIDDEN", "worker inherited cwd is not the host root");
  }
  if (options.cwd !== undefined && path.resolve(options.cwd) !== context.hostRoot) {
    refuse("CHILD_FORBIDDEN", "worker cwd is not the host root");
  }
  if (options.serialization !== undefined && options.serialization !== "advanced") {
    refuse("CHILD_FORBIDDEN", "worker serialization must be advanced");
  }
  if (options.stdio !== undefined && options.stdio !== "pipe") {
    refuse("CHILD_FORBIDDEN", "worker stdio must be pipe");
  }
  assertWorkerEnv(options.env);
}

function sanitizedWorkerBase() {
  return {
    PATH: process.env.PATH ?? "",
    LANG: "C",
    LC_ALL: "C",
    HOME: context.dirs.home,
    PAPERCLIP_HOME: context.dirs.home,
    TMPDIR: context.dirs.tmp,
    NODE_ENV: "production",
    PAPERCLIP_LOG_LEVEL: "silent",
    PAPERCLIP_RUN_SCRATCH_DIR: context.scratch,
    // Closed canonical framework value: pipe/no-TTY graph always yields empty.
    FORCE_TTY: "",
  };
}

function endowWorker(options) {
  const allocation = transferLedger(ledger);
  const childInstanceId = randomUUID();
  const env = sanitizedWorkerBase();
  for (const key of ["TEST", "VITEST", "VITEST_MODE", "VITEST_POOL_ID", "VITEST_WORKER_ID", "PAPERCLIP_RUN_ID", "PAPERCLIP_AGENT_ID", "PAPERCLIP_COMPANY_ID"]) {
    if (options?.env && typeof options.env[key] === "string") env[key] = options.env[key];
  }
  env.PC_FROZEN_VALIDATOR_PHASE = "attach";
  env.PC_FROZEN_VALIDATOR_ROLE = context.role;
  env.PC_FROZEN_VALIDATOR_HOST_SHA = context.hostSha;
  env.PC_FROZEN_VALIDATOR_MANIFEST_SHA256 = context.manifestSha256;
  env.PC_FROZEN_VALIDATOR_NODE = context.node;
  env.PC_FROZEN_VALIDATOR_GIT_ALLOCATION = String(allocation);
  env.PC_FROZEN_VALIDATOR_GIT_OBSERVED_BASE = String(ledger.spent);
  env.PC_FROZEN_VALIDATOR_INSTANCE_ID = childInstanceId;
  env.PC_FROZEN_VALIDATOR_REPORT_TOKEN = reportToken;
  env.PC_FROZEN_VALIDATOR_BOOTSTRAP_PID = process.env.PC_FROZEN_VALIDATOR_BOOTSTRAP_PID ?? "";
  env.PC_FROZEN_VALIDATOR_RECEIPT_NONCE = process.env.PC_FROZEN_VALIDATOR_RECEIPT_NONCE ?? "";
  return { options: { ...options, env, shell: false, detached: false }, allocation };
}

function relayFrom(child) {
  if (child && typeof child.on === "function") child.on("message", forwardUpstream);
  return child;
}

function guardedSpawn(file, args, options) {
  if (file !== "git") refuse("CHILD_FORBIDDEN", `only admitted Git may spawn: ${String(file)}`);
  assertNoShell(options);
  const plan = planGitLaunch({ args, cwd: options?.cwd, reposRoot });
  admitGit(plan);
  return RAW.spawn("git", plan.argv, {
    ...hardenedGitOptions(options, plan.cwd),
    timeout: context.ceilings.gitCallTimeoutMs,
    killSignal: "SIGKILL",
  });
}

function guardedSpawnSync(file, args, options) {
  if (file !== "git") refuse("CHILD_FORBIDDEN", "only admitted Git may run through spawnSync");
  assertNoShell(options);
  const plan = planGitLaunch({ args, cwd: options?.cwd, reposRoot });
  admitGit(plan);
  return RAW.spawnSync("git", plan.argv, {
    ...hardenedGitOptions(options, plan.cwd),
    killSignal: "SIGKILL",
  });
}

function guardedFork(modulePath, args, options) {
  let real = modulePath;
  try {
    real = fs.realpathSync(modulePath);
  } catch {
    refuse("CHILD_FORBIDDEN", `fork module is not resolvable: ${String(modulePath)}`);
  }
  if (real !== FORKS_WORKER) refuse("CHILD_FORBIDDEN", `only the pinned forks worker may fork: ${real}`);
  if (String(real).includes("tinypool")) refuse("CHILD_FORBIDDEN", "tinypool worker is not admitted");
  if (!FORKS_WORKER_SHA || sha256FileSync(real) !== FORKS_WORKER_SHA) {
    refuse("CHILD_FORBIDDEN", "forks worker SHA256 does not match the pinned worker closure");
  }
  if (Array.isArray(args) && args.length !== 0) refuse("CHILD_FORBIDDEN", "forks worker argv must be empty");
  assertWorkerOptions(options);
  assertWorkerExecArgv(options.execArgv);
  const { options: endowed, allocation } = endowWorker(options);
  try {
    return relayFrom(RAW.fork(modulePath, args, endowed));
  } catch (error) {
    returnLedgerTransfer(ledger, allocation);
    throw error;
  }
}

const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");
guardedExecFile[promisifyCustom] = (file, args, options) => guardedExecFile(file, args, options);

childProcess.execFile = guardedExecFile;
childProcess.execFileSync = guardedExecFileSync;
childProcess.spawn = guardedSpawn;
childProcess.spawnSync = guardedSpawnSync;
childProcess.fork = guardedFork;
childProcess.exec = () => refuse("SHELL_FORBIDDEN", "shell exec is not permitted");
childProcess.execSync = () => refuse("SHELL_FORBIDDEN", "shell execSync is not permitted");
syncBuiltinESMExports();
