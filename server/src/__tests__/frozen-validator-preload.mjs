/**
 * Frozen validator worker preload (THE-567, corrective contract v4).
 *
 * Runs via `node --import` before Vitest evaluates its config or the fixture.
 * Repeats the attach-phase guards, then installs the exact-token Git policy and
 * the compatible child_process surface with monotonic aggregate accounting.
 *
 * STATIC / UNEXECUTED. Built-ins plus the host loader guard module only.
 */

import { createRequire, syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  debitLedger,
  FixtureGuardError,
  getValidatedRoleContext,
  planGitLaunch,
  returnLedgerTransfer,
  transferLedger,
} from "./frozen-validator-loader.mjs";

const context = getValidatedRoleContext();
const ledger = context.ledger;
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

function reportDebit() {
  seq += 1;
  sendUp({
    v: 4,
    instanceId,
    parentInstanceId,
    seq,
    delta: 1,
    spent: ledger.spent,
    remaining: ledger.remaining,
  });
}

function forwardUpstream(message) {
  if (message && typeof message === "object" && message.type === "frozen-validator-git") sendUp(message);
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

function refuse(code, message) {
  throw new FixtureGuardError(code, message);
}

/* Contract D: Rule A debit for every admitted Git launch (leaf). */
function admitGit(plan) {
  debitLedger(ledger, 1);
  reportDebit();
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
  if (norm.file !== "git") {
    refuse("CHILD_FORBIDDEN", "only admitted Git or the pinned worker may launch");
  }
  const plan = planGitLaunch({ args: norm.args, cwd: norm.options.cwd, reposRoot });
  admitGit(plan);
  return plan;
}

function launchAdmitted(plan, norm, callback) {
  return RAW.execFile(
    "git",
    plan.argv,
    hardenedGitOptions(norm.options, plan.cwd),
    callback,
  );
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
/* Contract D + exact worker graph for spawn/spawnSync/fork                   */
/* ------------------------------------------------------------------------- */

function isPinnedWorkerInvocation(file, args) {
  if (file !== process.execPath) return false;
  const list = Array.isArray(args) ? args : [];
  const importValues = [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === "--import" && typeof list[i + 1] === "string") importValues.push(list[i + 1]);
  }
  if (importValues.some((value) => value !== PINNED_PRELOAD)) return false;
  const hasVitest = list.some((token) => typeof token === "string" && token.endsWith(path.join("vitest", "vitest.mjs")));
  const hasPoolWorker = list.some((token) => typeof token === "string" && token.includes("tinypool"));
  return hasVitest || hasPoolWorker;
}

function endowWorker(options) {
  const allocation = transferLedger(ledger);
  const childInstanceId = randomUUID();
  const env = { ...(options?.env ?? process.env) };
  env.PC_FROZEN_VALIDATOR_PHASE = "attach";
  env.PC_FROZEN_VALIDATOR_GIT_ALLOCATION = String(allocation);
  env.PC_FROZEN_VALIDATOR_GIT_OBSERVED_BASE = String(ledger.spent);
  env.PC_FROZEN_VALIDATOR_INSTANCE_ID = childInstanceId;
  env.PC_FROZEN_VALIDATOR_BOOTSTRAP_PID = process.env.PC_FROZEN_VALIDATOR_BOOTSTRAP_PID ?? "";
  env.PC_FROZEN_VALIDATOR_RECEIPT_NONCE = process.env.PC_FROZEN_VALIDATOR_RECEIPT_NONCE ?? "";
  env.PC_FROZEN_VALIDATOR_ROLE = context.role;
  env.PC_FROZEN_VALIDATOR_HOST_SHA = context.hostSha;
  env.PC_FROZEN_VALIDATOR_MANIFEST_SHA256 = context.manifestSha256;
  env.PC_FROZEN_VALIDATOR_NODE = context.node;
  return { options: { ...options, env }, allocation };
}

function relayFrom(child) {
  if (child && typeof child.on === "function") child.on("message", forwardUpstream);
  return child;
}

function guardedSpawn(file, args, options) {
  if (file === "git") {
    const plan = planGitLaunch({ args, cwd: options?.cwd, reposRoot });
    admitGit(plan);
    return RAW.spawn("git", plan.argv, {
      ...hardenedGitOptions(options, plan.cwd),
      timeout: context.ceilings.gitCallTimeoutMs,
      killSignal: "SIGKILL",
    });
  }
  if (!isPinnedWorkerInvocation(file, args)) {
    refuse("CHILD_FORBIDDEN", `only the pinned worker graph may spawn: ${String(file)}`);
  }
  const { options: endowed, allocation } = endowWorker(options);
  try {
    return relayFrom(RAW.spawn(file, args, endowed));
  } catch (error) {
    returnLedgerTransfer(ledger, allocation);
    throw error;
  }
}

function guardedSpawnSync(file, args, options) {
  if (file === "git") {
    const plan = planGitLaunch({ args, cwd: options?.cwd, reposRoot });
    admitGit(plan);
    return RAW.spawnSync("git", plan.argv, {
      ...hardenedGitOptions(options, plan.cwd),
      killSignal: "SIGKILL",
    });
  }
  refuse("CHILD_FORBIDDEN", "only admitted Git may run through spawnSync");
}

function guardedFork(modulePath, args, options) {
  const execArgv = Array.isArray(options?.execArgv) ? options.execArgv : [];
  const importValues = [];
  for (let i = 0; i < execArgv.length; i += 1) {
    if (execArgv[i] === "--import" && typeof execArgv[i + 1] === "string") importValues.push(execArgv[i + 1]);
  }
  const pinned =
    importValues.every((value) => value === PINNED_PRELOAD) &&
    (importValues.includes(PINNED_PRELOAD) ||
      (typeof modulePath === "string" && modulePath.endsWith(path.join("vitest", "vitest.mjs"))));
  if (!pinned) refuse("CHILD_FORBIDDEN", `only the pinned worker may fork: ${String(modulePath)}`);
  const { options: endowed, allocation } = endowWorker(options);
  try {
    return relayFrom(RAW.fork(modulePath, args, endowed));
  } catch (error) {
    returnLedgerTransfer(ledger, allocation);
    throw error;
  }
}

const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");
guardedExecFile[promisifyCustom] = (file, args, options) =>
  guardedExecFile(file, args, options);

childProcess.execFile = guardedExecFile;
childProcess.execFileSync = guardedExecFileSync;
childProcess.spawn = guardedSpawn;
childProcess.spawnSync = guardedSpawnSync;
childProcess.fork = guardedFork;
childProcess.exec = () => refuse("SHELL_FORBIDDEN", "shell exec is not permitted");
childProcess.execSync = () => refuse("SHELL_FORBIDDEN", "shell execSync is not permitted");
syncBuiltinESMExports();
