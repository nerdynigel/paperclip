/**
 * Frozen validator worker preload (THE-567, corrective contract v4 / V4 pass).
 *
 * Runs via `node --import` before Vitest evaluates its config or the fixture.
 * Repeats the attach-phase guards, then installs the exact-token Git policy, the
 * compatible child_process surface, and an authenticated monotonic per-instance
 * accounting relay. Non-Git child launches are admitted only for the exact
 * prepared Vitest forks-worker graph.
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
    // V4-4: the attach guard debits are reported immediately with the same schema.
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

function refuse(code, message) {
  throw new FixtureGuardError(code, message);
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
  const plan = admitLaunch(norm);
  return RAW.execFileSync("git", plan.argv, hardenedGitOptions(norm.options, plan.cwd));
}

/* ------------------------------------------------------------------------- */
/* V4-5: exact prepared worker graph for fork; spawn is Git-only             */
/* ------------------------------------------------------------------------- */

function assertWorkerExecArgv(execArgv) {
  let sawPreload = false;
  for (let index = 0; index < execArgv.length; index += 1) {
    const token = execArgv[index];
    if (token === "--import") {
      if (execArgv[index + 1] !== PINNED_PRELOAD) refuse("CHILD_FORBIDDEN", "worker --import is not the pinned preload");
      sawPreload = true;
      index += 1;
    } else if (token === "--experimental-import-meta-resolve") {
      continue;
    } else if (token === "--require") {
      if (execArgv[index + 1] !== SUPPRESS_WARNINGS) refuse("CHILD_FORBIDDEN", "worker --require is not the pinned suppress-warnings.cjs");
      index += 1;
    } else if (token === "--conditions") {
      if (!["node", "production", "module", "module-sync"].includes(execArgv[index + 1])) {
        refuse("CHILD_FORBIDDEN", `unexpected worker condition: ${execArgv[index + 1]}`);
      }
      index += 1;
    } else {
      refuse("CHILD_FORBIDDEN", `unapproved worker execArgv token: ${token}`);
    }
  }
  if (!sawPreload) refuse("CHILD_FORBIDDEN", "worker execArgv must include the pinned preload");
}

function endowWorker(options) {
  const allocation = transferLedger(ledger);
  const childInstanceId = randomUUID();
  const env = { ...(options?.env ?? process.env) };
  env.PC_FROZEN_VALIDATOR_PHASE = "attach";
  env.PC_FROZEN_VALIDATOR_GIT_ALLOCATION = String(allocation);
  env.PC_FROZEN_VALIDATOR_GIT_OBSERVED_BASE = String(ledger.spent);
  env.PC_FROZEN_VALIDATOR_INSTANCE_ID = childInstanceId;
  env.PC_FROZEN_VALIDATOR_REPORT_TOKEN = reportToken;
  env.PC_FROZEN_VALIDATOR_BOOTSTRAP_PID = process.env.PC_FROZEN_VALIDATOR_BOOTSTRAP_PID ?? "";
  env.PC_FROZEN_VALIDATOR_RECEIPT_NONCE = process.env.PC_FROZEN_VALIDATOR_RECEIPT_NONCE ?? "";
  env.PC_FROZEN_VALIDATOR_ROLE = context.role;
  env.PC_FROZEN_VALIDATOR_HOST_SHA = context.hostSha;
  env.PC_FROZEN_VALIDATOR_MANIFEST_SHA256 = context.manifestSha256;
  env.PC_FROZEN_VALIDATOR_NODE = context.node;
  return { options: { ...options, env, shell: false }, allocation };
}

function relayFrom(child) {
  if (child && typeof child.on === "function") child.on("message", forwardUpstream);
  return child;
}

function guardedSpawn(file, args, options) {
  if (file !== "git") refuse("CHILD_FORBIDDEN", `only admitted Git may spawn: ${String(file)}`);
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
  if (options?.shell || options?.detached) refuse("CHILD_FORBIDDEN", "worker launch may not set shell or detached");
  if (options?.execPath && options.execPath !== context.node) refuse("CHILD_FORBIDDEN", "worker execPath is not the pinned Node");
  const execArgv = Array.isArray(options?.execArgv) ? options.execArgv : [];
  assertWorkerExecArgv(execArgv);
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
