/**
 * Frozen validator bootstrap (THE-567, corrective contract v4 / V4 pass).
 *
 * Create phase: validate, create the role lifecycle exclusively, write the role
 * receipt, then (only if containment is proved) supervise one detached Vitest
 * child with a transfer-ledger endowment, bounded stdio, awaited terminal group
 * proof, durable evidence before disposable cleanup and an authenticated
 * monotonic per-instance aggregate.
 *
 * STATIC / UNEXECUTED. Detached parent-death containment is UNPROVED; the
 * bootstrap refuses before spawning the child in that state.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildValidatedRoleContext,
  transferLedger,
  FROZEN_VALIDATOR_FIXED_CEILINGS,
} from "./frozen-validator-loader.mjs";

const ARG_FLAGS = new Set(["--role", "--host-sha", "--manifest-sha256", "--node"]);

function failClosed(code, message, exitCode = 2) {
  process.stderr.write(`${code}: ${message}\n`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!ARG_FLAGS.has(flag) || typeof value !== "string" || value.startsWith("--")) {
      failClosed("BOOTSTRAP_ARGS", `unexpected argument ${String(flag)}`);
    }
    parsed[flag.slice(2)] = value;
  }
  for (const required of ["role", "host-sha", "manifest-sha256", "node"]) {
    if (!parsed[required]) failClosed("BOOTSTRAP_ARGS", `missing --${required}`);
  }
  if (!path.isAbsolute(parsed.node)) failClosed("BOOTSTRAP_ARGS", "--node must be absolute");
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const nonce = randomUUID();
const reportToken = randomUUID();

process.env.PC_FROZEN_VALIDATOR_PHASE = "create";
process.env.PC_FROZEN_VALIDATOR_ROLE = args.role;
process.env.PC_FROZEN_VALIDATOR_HOST_SHA = args["host-sha"];
process.env.PC_FROZEN_VALIDATOR_MANIFEST_SHA256 = args["manifest-sha256"];
process.env.PC_FROZEN_VALIDATOR_NODE = args.node;
process.env.PC_FROZEN_VALIDATOR_RECEIPT_NONCE = nonce;
process.env.PC_FROZEN_VALIDATOR_BOOTSTRAP_PID = String(process.pid);

if (args.node !== process.execPath) {
  failClosed("NODE_MISMATCH", "--node does not match the executing Node binary");
}

const context = buildValidatedRoleContext({
  phase: "create",
  reporter: (accounting) => {
    if (accounting.gitCalls > FROZEN_VALIDATOR_FIXED_CEILINGS.gitCallsPerRole) {
      failClosed("GIT_BUDGET", "create-phase guards exceeded the aggregate Git ceiling");
    }
  },
});

/* V4-2: refuse before any child when detached parent-death containment is unproved. */
const parentDeathProof = context.manifest.containment?.parentDeathProof ?? null;
if (!parentDeathProof || typeof parentDeathProof !== "string") {
  failClosed(
    "PARENT_DEATH_UNPROVED",
    "detached parent-death containment is unproved; refusing to launch the child",
    7,
  );
}

const testFile = path.join(context.hostRoot, "server/src/__tests__/frozen-validator-independent.test.ts");
const preloadFile = path.join(context.hostRoot, "server/src/__tests__/frozen-validator-preload.mjs");
const configFile = path.join(context.hostRoot, "server/src/__tests__/frozen-validator.vitest.config.mjs");
const vitestEntry = path.join(context.hostRoot, "node_modules/vitest/vitest.mjs");
for (const required of [testFile, preloadFile, configFile, vitestEntry]) {
  if (!fs.existsSync(required)) failClosed("CHILD_INPUT_MISSING", `required child input is missing: ${required}`);
}

const childInstanceId = randomUUID();
const allocation = transferLedger(context.ledger);
const observedBase = context.ledger.spent;

const childEnv = {
  PATH: process.env.PATH ?? "",
  LANG: "C",
  LC_ALL: "C",
  HOME: context.dirs.home,
  PAPERCLIP_HOME: context.dirs.home,
  TMPDIR: context.dirs.tmp,
  NODE_ENV: "production",
  PAPERCLIP_LOG_LEVEL: "silent",
  PAPERCLIP_RUN_SCRATCH_DIR: context.scratch,
  PC_FROZEN_VALIDATOR_ROLE: context.role,
  PC_FROZEN_VALIDATOR_HOST_SHA: context.hostSha,
  PC_FROZEN_VALIDATOR_MANIFEST_SHA256: context.manifestSha256,
  PC_FROZEN_VALIDATOR_NODE: context.node,
  PC_FROZEN_VALIDATOR_PHASE: "attach",
  PC_FROZEN_VALIDATOR_RECEIPT_NONCE: nonce,
  PC_FROZEN_VALIDATOR_BOOTSTRAP_PID: String(process.pid),
  PC_FROZEN_VALIDATOR_INSTANCE_ID: childInstanceId,
  PC_FROZEN_VALIDATOR_REPORT_TOKEN: reportToken,
  PC_FROZEN_VALIDATOR_GIT_ALLOCATION: String(allocation),
  PC_FROZEN_VALIDATOR_GIT_OBSERVED_BASE: String(observedBase),
};
for (const passthrough of ["PAPERCLIP_RUN_ID", "PAPERCLIP_AGENT_ID", "PAPERCLIP_COMPANY_ID"]) {
  if (typeof process.env[passthrough] === "string") childEnv[passthrough] = process.env[passthrough];
}

const childArgs = [
  "--import", preloadFile,
  vitestEntry,
  "run",
  // Source-backed config-loader pin: Vitest 4.1.11 forwards its CLI
  // `configLoader` option (dist/chunks/cac.uFydS1Z4.js -> cli-api configLoader)
  // to Vite's createServer inline config. Vite 8.2.2
  // dist/node/chunks/node.js loadConfigFromFile accepts 'native' and
  // nativeImportConfigFile imports the plain .mjs without the bundle loader or
  // any node_modules/.vite-temp write inside H. No fallback broaden.
  "--configLoader", "native",
  "--config", configFile,
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
  shell: false,
});

const supervisor = {
  schema: "paperclip.frozen-validator.supervisor/v1",
  role: context.role,
  instanceId: childInstanceId,
  bootstrapPid: process.pid,
  childPid: child.pid ?? null,
  allocation,
  observedBase,
  seenReports: 0,
  gitObservedSpent: observedBase,
  ipcBackpressure: 0,
  childExitedAt: null,
  stdioClosedAt: null,
  stdioCloseTimedOut: false,
  reapStartedAt: null,
  reapAttempts: 0,
  residualAfterKill: false,
  groupLiveAfterReap: true,
  parentDeathContainment: "unproved",
  terminationReason: null,
  exitCode: null,
};

let stdioBytes = 0;
let overLimit = false;
let stdoutChunks = [];
let stderrChunks = [];
let stdioCloseTimer = null;
let reapPromise = Promise.resolve();
const perInstance = new Map();

function aggregateObserved() {
  let total = context.ledger.spent;
  for (const entry of perInstance.values()) total += entry.spent;
  return total;
}

function terminate(reason) {
  if (supervisor.terminationReason) return;
  supervisor.terminationReason = reason;
  overLimit = true;
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

/* V4-4: authenticated (token), monotonic (per-instance seq) aggregate. */
child.on("message", (message) => {
  if (!message || typeof message !== "object" || message.type !== "frozen-validator-git") return;
  if (message.v !== 4 || message.token !== reportToken) return;
  if (typeof message.instanceId !== "string" || !Number.isInteger(message.seq)) return;
  const previous = perInstance.get(message.instanceId);
  if (previous && message.seq <= previous.seq) return;
  perInstance.set(message.instanceId, {
    seq: message.seq,
    spent: Number.isInteger(message.spent) ? message.spent : previous?.spent ?? 0,
    remaining: Number.isInteger(message.remaining) ? message.remaining : previous?.remaining ?? 0,
    parentInstanceId: message.parentInstanceId ?? null,
  });
  supervisor.seenReports += 1;
  const observed = aggregateObserved();
  if (observed > supervisor.gitObservedSpent) supervisor.gitObservedSpent = observed;
  if (observed > context.ceilings.gitCallsPerRole) terminate("git-ceiling");
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reapGroup() {
  supervisor.reapStartedAt = new Date().toISOString();
  const pgid = child.pid;
  const deadline = Date.now() + context.ceilings.reapTimeoutMs;
  for (;;) {
    supervisor.reapAttempts += 1;
    let live = false;
    try {
      process.kill(-pgid, 0);
      live = true;
    } catch {
      live = false;
    }
    if (!live) {
      supervisor.groupLiveAfterReap = false;
      return;
    }
    if (Date.now() >= deadline) {
      try {
        process.kill(-pgid, "SIGKILL");
      } catch {
        /* already gone */
      }
      try {
        process.kill(-pgid, 0);
        supervisor.residualAfterKill = true;
      } catch {
        supervisor.residualAfterKill = false;
      }
      supervisor.groupLiveAfterReap = supervisor.residualAfterKill;
      return;
    }
    await delay(context.ceilings.reapPollIntervalMs);
  }
}

child.on("exit", (code, signal) => {
  supervisor.childExitedAt = new Date().toISOString();
  supervisor.exitCode = typeof code === "number" ? code : null;
  supervisor.signal = signal ?? null;
  reapPromise = reapGroup();
  stdioCloseTimer = setTimeout(() => {
    supervisor.stdioCloseTimedOut = true;
    for (const stream of [child.stdout, child.stderr]) {
      try {
        stream.destroy();
      } catch {
        /* ignore */
      }
    }
    try {
      child.disconnect();
    } catch {
      /* ignore */
    }
  }, context.ceilings.stdioCloseDeadlineMs);
});

const deadline = setTimeout(() => terminate("helper-deadline"), context.ceilings.helperMaxDurationMs);
function forwardSignal(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* ignore */
    }
  }
}
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
process.on("SIGINT", () => forwardSignal("SIGINT"));

const exitCode = await new Promise((resolve) => {
  child.on("error", () => resolve(3));
  child.on("close", (code) => {
    supervisor.stdioClosedAt = new Date().toISOString();
    if (stdioCloseTimer) clearTimeout(stdioCloseTimer);
    resolve(typeof code === "number" ? code : 3);
  });
});
clearTimeout(deadline);

/* V4-residual 1: successful awaited group-reap AND stdio-close proof is required
 * BEFORE any disposable cleanup. On nonterminal proof failure or evidence-write
 * failure the work tree and evidence are preserved and a truthful nonzero code
 * is returned. */
await reapPromise;
if (stdioCloseTimer) clearTimeout(stdioCloseTimer);
const terminalOk =
  !supervisor.groupLiveAfterReap && !supervisor.residualAfterKill && !supervisor.stdioCloseTimedOut;
supervisor.terminalProofOk = terminalOk;

let evidenceFailure = false;
try {
  fs.writeFileSync(path.join(context.dirs.output, "child-stdout.log"), Buffer.concat(stdoutChunks));
  fs.writeFileSync(path.join(context.dirs.output, "child-stderr.log"), Buffer.concat(stderrChunks));
  fs.writeFileSync(path.join(context.dirs.output, "supervisor.json"), JSON.stringify(supervisor, null, 2));
} catch {
  evidenceFailure = true;
}
if (evidenceFailure) process.exit(5);

if (!terminalOk) process.exit(7);

let cleanupFailure = false;
try {
  const work = path.resolve(context.dirs.work);
  if (fs.realpathSync(work) !== work) cleanupFailure = true;
  else fs.rmSync(work, { recursive: true, force: true });
} catch {
  cleanupFailure = true;
}
if (cleanupFailure) process.exit(6);

process.exit(overLimit ? 4 : exitCode);
