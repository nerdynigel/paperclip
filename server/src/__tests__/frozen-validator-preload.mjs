/**
 * Frozen validator worker preload (THE-567 corrected static publication).
 *
 * Runs via `node --import` before Vitest evaluates its config or the fixture.
 * It repeats the role/identity/containment guards, then installs a counted Git
 * and child supervision layer before any product module loads. Built-ins only
 * plus the host loader guard module (itself built-ins only).
 *
 * Proposed static interface; unexecuted and unproved.
 */

import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import {
  buildValidatedRoleContext,
  FROZEN_VALIDATOR_LOADER_PATH,
} from "./frozen-validator-loader.mjs";

function report(message) {
  if (typeof process.send === "function") {
    try {
      process.send(message);
    } catch {
      /* supervised IPC unavailable; local counters still enforce */
    }
  }
}

const context = buildValidatedRoleContext({
  reporter: (accounting) => report({ type: "frozen-validator-git", delta: 0, total: accounting.gitCalls }),
});

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");

const RAW = {
  execFile: childProcess.execFile,
  execFileSync: childProcess.execFileSync,
  spawn: childProcess.spawn,
  fork: childProcess.fork,
};

const policy = context.manifest.gitPolicy ?? {};
const setupSubcommands = new Set(policy.allowedSetupSubcommands ?? []);
const readSubcommands = new Set(policy.allowedReadSubcommands ?? []);
const forbiddenFlags = new Set(policy.forbiddenFlags ?? []);
const PINNED_VITEST = path.join(context.hostRoot, "node_modules/vitest/vitest.mjs");
const PINNED_PRELOAD = path.join(context.hostRoot, "server/src/__tests__/frozen-validator-preload.mjs");

let gitCount = context.git.budget.count;
const gitLimit = context.ceilings.gitCallsPerRole;

function refuse(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function assertContainedCwd(cwd) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
    refuse("GIT_CWD", "git cwd must be an absolute owned path");
  }
  const resolved = path.resolve(cwd);
  const repos = path.resolve(context.dirs.repos);
  const rel = path.relative(repos, resolved);
  if (!(rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)))) {
    refuse("GIT_CWD_ESCAPE", `git cwd is outside the owned repos root: ${resolved}`);
  }
}

function classifyGit(args) {
  if (!Array.isArray(args) || typeof args[0] !== "string") {
    refuse("GIT_ARGS", "git argv must start with a subcommand string");
  }
  for (const arg of args) {
    if (typeof arg !== "string") refuse("GIT_ARGS", "git argv entries must be strings");
    const flag = arg.split("=", 1)[0];
    if (forbiddenFlags.has(flag)) {
      refuse("GIT_FORBIDDEN_FLAG", `git flag is not permitted: ${flag}`);
    }
  }
  if (!readSubcommands.has(args[0]) && !setupSubcommands.has(args[0])) {
    refuse("GIT_SUBCOMMAND", `git subcommand is not permitted: ${args[0]}`);
  }
  return setupSubcommands.has(args[0]) ? "setup" : "read";
}

function countGit() {
  gitCount += 1;
  report({ type: "frozen-validator-git", delta: 1, total: gitCount });
  if (gitCount > gitLimit) {
    refuse("GIT_BUDGET", `aggregate Git ceiling exceeded (${gitLimit})`);
  }
}

function hardenedGitOptions(options) {
  const options2 = { ...(options ?? {}) };
  return {
    ...options2,
    env: context.git.env,
    timeout: context.ceilings.gitCallTimeoutMs,
    maxBuffer: context.ceilings.gitCallMaxOutputBytes,
  };
}

function sanitizeError(error) {
  if (!error || typeof error !== "object") return error;
  const scrubbed = new Error(String(error.message ?? "git failure").replaceAll(context.scratch, "<scratch>"));
  scrubbed.code = error.code;
  return scrubbed;
}

function guardedExecFileSync(file, args, options) {
  if (file !== "git") refuse("CHILD_FORBIDDEN", "only git may run through execFileSync");
  classifyGit(args);
  assertContainedCwd(options?.cwd);
  countGit();
  try {
    return RAW.execFileSync(file, args, hardenedGitOptions(options));
  } catch (error) {
    throw sanitizeError(error);
  }
}

function guardedExecFile(file, args, options, callback) {
  let opts = options;
  let cb = callback;
  if (typeof opts === "function") {
    cb = opts;
    opts = {};
  }
  if (file !== "git") {
    const error = new Error("CHILD_FORBIDDEN: only git may run through execFile");
    if (typeof cb === "function") return cb(error);
    throw error;
  }
  classifyGit(args);
  assertContainedCwd(opts?.cwd);
  countGit();
  return RAW.execFile(file, args, hardenedGitOptions(opts), (error, stdout, stderr) => {
    if (typeof cb === "function") cb(error ? sanitizeError(error) : null, stdout, stderr);
  });
}

function isPinnedWorkerSpawn(file, args) {
  if (file !== process.execPath) return false;
  const list = Array.isArray(args) ? args : [];
  return list.includes(PINNED_VITEST) || list.includes(PINNED_PRELOAD);
}

function guardedSpawn(file, args, options) {
  if (!isPinnedWorkerSpawn(file, args)) {
    refuse("CHILD_FORBIDDEN", `only the pinned Vitest worker may spawn: ${String(file)}`);
  }
  return RAW.spawn(file, args, options);
}

function guardedFork(modulePath, args, options) {
  const execArgv = Array.isArray(options?.execArgv) ? options.execArgv : [];
  if (modulePath !== PINNED_VITEST && !execArgv.includes(PINNED_PRELOAD)) {
    refuse("CHILD_FORBIDDEN", `only the pinned Vitest worker may fork: ${String(modulePath)}`);
  }
  return RAW.fork(modulePath, args, options);
}

childProcess.execFileSync = guardedExecFileSync;
childProcess.execFile = guardedExecFile;
childProcess.spawn = guardedSpawn;
childProcess.fork = guardedFork;
childProcess.exec = () => refuse("SHELL_FORBIDDEN", "shell exec is not permitted");
childProcess.execSync = () => refuse("SHELL_FORBIDDEN", "shell execSync is not permitted");
syncBuiltinESMExports();

function shutdown(code) {
  report({ type: "frozen-validator-exit", code });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

report({
  type: "frozen-validator-preload",
  role: context.role,
  loader: FROZEN_VALIDATOR_LOADER_PATH,
  gitBase: context.git.budget.count,
});
