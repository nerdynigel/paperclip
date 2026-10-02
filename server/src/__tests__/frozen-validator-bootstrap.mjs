/**
 * Frozen validator bootstrap (THE-567 corrected static publication).
 *
 * Plain built-in ESM plus the host loader guard. Validates the role/host/
 * manifest/scratch guards BEFORE any write or child spawn, derives the owned
 * role directories, then supervises exactly one Vitest child process with a
 * sanitized environment, shared Git accounting and bounded stdio.
 *
 * Proposed static interface; helper scope, Vite/Vitest loading and the full
 * dependency closure are UNPROVED.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildValidatedRoleContext,
  FROZEN_VALIDATOR_FIXED_CEILINGS,
} from "./frozen-validator-loader.mjs";

const BOOTSTRAP_FLAGS = new Set(["--role", "--host-sha", "--manifest-sha256", "--node"]);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!BOOTSTRAP_FLAGS.has(flag) || typeof value !== "string" || value.startsWith("--")) {
      throw new Error(`BOOTSTRAP_ARGS: unexpected argument ${String(flag)}`);
    }
    parsed[flag.slice(2)] = value;
  }
  for (const required of ["role", "host-sha", "manifest-sha256", "node"]) {
    if (!parsed[required]) throw new Error(`BOOTSTRAP_ARGS: missing --${required}`);
  }
  if (!path.isAbsolute(parsed.node)) throw new Error("BOOTSTRAP_ARGS: --node must be absolute");
  return parsed;
}

const args = parseArgs(process.argv.slice(2));

const context = buildValidatedRoleContext({
  reporter: (accounting) => {
    // Guard reads are the bootstrap's own; the worker continues from this total.
    if (accounting.gitCalls > FROZEN_VALIDATOR_FIXED_CEILINGS.gitCallsPerRole) {
      failClosed("GIT_BUDGET", "bootstrap guard exceeded the aggregate Git ceiling");
    }
  },
});

function failClosed(code, message) {
  process.stderr.write(`${code}: ${message}\n`);
  process.exit(2);
}

if (args.role !== context.role) {
  failClosed("ROLE_MISMATCH", "--role does not match the validated role");
}
if (args.node !== context.node) {
  failClosed("NODE_MISMATCH", "--node does not match the executing Node binary");
}
if (args["host-sha"] !== (process.env.PC_FROZEN_VALIDATOR_HOST_SHA ?? "").trim()) {
  failClosed("HOST_SHA_MISMATCH", "--host-sha does not match the validated host pin");
}
if (args["manifest-sha256"] !== (process.env.PC_FROZEN_VALIDATOR_MANIFEST_SHA256 ?? "").trim()) {
  failClosed("MANIFEST_SHA_MISMATCH", "--manifest-sha256 does not match the validated manifest pin");
}

fs.mkdirSync(context.dirs.repos, { recursive: true });
fs.mkdirSync(context.dirs.cache, { recursive: true });
fs.mkdirSync(context.dirs.output, { recursive: true });
fs.mkdirSync(context.dirs.home, { recursive: true });
const childTmp = path.join(context.dirs.roleDir, "tmp");
fs.mkdirSync(childTmp, { recursive: true });

const testFile = path.join(context.hostRoot, "server/src/__tests__/frozen-validator-independent.test.ts");
const preloadFile = path.join(context.hostRoot, "server/src/__tests__/frozen-validator-preload.mjs");
const configFile = path.join(context.hostRoot, "server/src/__tests__/frozen-validator.vitest.config.mjs");
const vitestEntry = path.join(context.hostRoot, "node_modules/vitest/vitest.mjs");

for (const required of [testFile, preloadFile, configFile, vitestEntry]) {
  if (!fs.existsSync(required)) {
    failClosed("CHILD_INPUT_MISSING", `required child input is missing: ${required}`);
  }
}

const childEnv = {
  PATH: process.env.PATH ?? "",
  LANG: "C",
  LC_ALL: "C",
  HOME: context.dirs.home,
  PAPERCLIP_HOME: context.dirs.home,
  TMPDIR: childTmp,
  NODE_ENV: "production",
  PAPERCLIP_LOG_LEVEL: "silent",
  PAPERCLIP_RUN_SCRATCH_DIR: context.scratch,
  PC_FROZEN_VALIDATOR_ROLE: context.role,
  PC_FROZEN_VALIDATOR_HOST_SHA: args["host-sha"],
  PC_FROZEN_VALIDATOR_MANIFEST_SHA256: args["manifest-sha256"],
  PC_FROZEN_VALIDATOR_GIT_BASE_COUNT: String(context.git.budget.count),
};
for (const passthrough of ["PAPERCLIP_RUN_ID", "PAPERCLIP_AGENT_ID", "PAPERCLIP_COMPANY_ID"]) {
  if (typeof process.env[passthrough] === "string") {
    childEnv[passthrough] = process.env[passthrough];
  }
}

const childArgs = [
  "--import",
  preloadFile,
  vitestEntry,
  "run",
  "--config",
  configFile,
  "--pool=forks",
  "--maxWorkers=1",
  "--no-file-parallelism",
  testFile,
];

const child = spawn(args.node, childArgs, {
  cwd: context.hostRoot,
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  detached: true,
});

let gitCount = context.git.budget.count;
let stdioBytes = 0;
let overLimit = false;
let stdoutChunks = [];
let stderrChunks = [];

function terminate(reason) {
  overLimit = true;
  process.stderr.write(`frozen-validator: terminating child tree (${reason})\n`);
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function accountStdio(chunk, sink) {
  stdioBytes += chunk.length;
  if (stdioBytes > context.ceilings.roleStdioMaxBytes) {
    terminate("stdio-ceiling");
    return;
  }
  sink.push(chunk);
}

child.stdout.on("data", (chunk) => accountStdio(chunk, stdoutChunks));
child.stderr.on("data", (chunk) => accountStdio(chunk, stderrChunks));

child.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "frozen-validator-git") {
    if (message.delta > 0) gitCount += message.delta;
    else if (typeof message.total === "number") gitCount = message.total;
    if (gitCount > context.ceilings.gitCallsPerRole) terminate("git-ceiling");
  }
});

const deadline = setTimeout(() => terminate("helper-deadline"), context.ceilings.helperMaxDurationMs);

function forwardSignal(signal) {
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
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
process.on("SIGINT", () => forwardSignal("SIGINT"));

const exitCode = await new Promise((resolve) => {
  child.on("error", () => resolve(3));
  child.on("close", (code) => resolve(typeof code === "number" ? code : 3));
});
clearTimeout(deadline);

function writeBoundedLog(name, chunks) {
  const target = path.join(context.dirs.output, name);
  const body = Buffer.concat(chunks);
  const bounded = body.length > context.ceilings.roleStdioMaxBytes ? body.subarray(0, context.ceilings.roleStdioMaxBytes) : body;
  try {
    fs.writeFileSync(target, bounded);
  } catch {
    /* keep cleanup safe; failure must not hide the child outcome */
  }
}
writeBoundedLog("child-stdout.log", stdoutChunks);
writeBoundedLog("child-stderr.log", stderrChunks);

process.exit(overLimit ? 4 : exitCode);
