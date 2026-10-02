/**
 * Frozen validator host loader (THE-567, corrective contract v4 / Contracts A-F).
 *
 * Plain built-in ESM only at module scope. No product, Vitest or Vite import
 * before the guards pass. Exports:
 *   - getValidatedRoleContext(): memoized accessor (one validation per process)
 *   - buildValidatedRoleContext(): first-pass validation (create | attach)
 *   - loadBoundSubject(ctx): canonical Vite SSR load of the exact bound subject
 *   - ledger primitives and the exact Git token policy used by the preload
 *
 * STATIC / UNEXECUTED. This grants no execution authority and proves no runtime
 * compatibility.
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAW_EXEC_FILE_SYNC = execFileSync;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(HERE, "frozen-validator.manifest.json");
const THIS_FILE = path.join(HERE, "frozen-validator-loader.mjs");

const ROLES = ["candidate", "base"];
const PHASES = ["create", "attach"];
const FIXED_CEILINGS = Object.freeze({
  gitCallsPerRole: 600,
  gitCallTimeoutMs: 15000,
  gitCallMaxOutputBytes: 1048576,
  roleStdioMaxBytes: 8388608,
  caseLogMaxBytes: 4194304,
  caseLogRowMaxBytes: 65536,
  stdioCloseDeadlineMs: 2000,
  reapPollIntervalMs: 50,
  reapTimeoutMs: 2000,
  testTimeoutMs: 15000,
  hookTimeoutMs: 30000,
  teardownTimeoutMs: 30000,
  helperMaxDurationMs: 600000,
});

export class FixtureGuardError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "FixtureGuardError";
    this.code = code;
  }
}

function refuse(code, message) {
  throw new FixtureGuardError(code, message);
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function sha256FileSync(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}
function isSameOrInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel));
}
function pathOverlaps(a, b) {
  return isSameOrInside(a, b) || isSameOrInside(b, a);
}
function assertNoSymlinkComponents(target) {
  const resolved = path.resolve(target);
  let current = path.sep;
  for (const part of resolved.split(path.sep)) {
    if (part === "") continue;
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) refuse("SCRATCH_SYMLINK", `symlinked path component: ${current}`);
  }
}
function assertRealDirectory(target, code) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    refuse(code, `required directory does not exist: ${target}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    refuse(code, `required canonical directory is not a real directory: ${target}`);
  }
  const real = fs.realpathSync(target);
  if (path.resolve(real) !== path.resolve(target)) {
    refuse(code, `required directory has a symlink alias: ${target} -> ${real}`);
  }
}
function findEnclosingGitRepository(start) {
  let current = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/* ------------------------------------------------------------------------- */
/* Contract D: permanent-grant ledger primitives                             */
/* ------------------------------------------------------------------------- */

export function createLedger({ remaining, spent = 0 }) {
  if (!Number.isSafeInteger(remaining) || remaining < 0 || !Number.isSafeInteger(spent) || spent < 0) {
    refuse("GIT_ALLOCATION", "ledger remaining/spent must be non-negative safe integers");
  }
  return { remaining, spent };
}
export function debitLedger(ledger, count = 1) {
  for (let i = 0; i < count; i += 1) {
    if (ledger.remaining <= 0) refuse("GIT_BUDGET", "aggregate Git ceiling exceeded");
    ledger.remaining -= 1;
    ledger.spent += 1;
  }
}
export function transferLedger(ledger) {
  if (ledger.remaining < 2) refuse("GIT_BUDGET", "no transferable Git budget remains for a child");
  const allocation = ledger.remaining - 1;
  ledger.remaining = 1;
  return allocation;
}
export function returnLedgerTransfer(ledger, allocation) {
  ledger.remaining += allocation;
}

/* ------------------------------------------------------------------------- */
/* Contract B: exact, element-wise Git token policy                          */
/* ------------------------------------------------------------------------- */

const SLOT = Object.freeze({
  REL: /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/,
  BRANCH: /^[A-Za-z0-9._/+-]+$/,
  SHA40: /^[0-9a-f]{40}$/,
  REF: /^[A-Za-z0-9._/@^~{}-]+$/,
  REF_COMMIT: /^[A-Za-z0-9._/@^~{}-]+\^\{commit\}$/,
  REMOTE_NAME: /^[A-Za-z0-9._-]+$/,
  REMOTE_URL: /^(https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(\.git)?|git@github\.com:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(\.git)?)$/,
  MSG: /^(seed|nested|ahead|divergent|second)$/,
});
function isRelNoTraversal(token) {
  return SLOT.REL.test(token) && !token.split("/").includes("..");
}

const READ_TEMPLATES = [
  ["rev-parse", "--show-toplevel"],
  ["rev-parse", "HEAD"],
  ["rev-parse", "--git-common-dir"],
  ["rev-parse", "--git-dir"],
  ["rev-parse", "--verify", "--quiet", SLOT.REF_COMMIT],
  ["rev-parse", "--verify", SLOT.REF_COMMIT],
  ["merge-base", "--is-ancestor", SLOT.SHA40, SLOT.SHA40],
  ["symbolic-ref", "--quiet", "--short", "HEAD"],
  ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
  ["worktree", "list", "--porcelain"],
  ["config", "--get", "remote.origin.url"],
  ["remote"],
  ["remote", "get-url", "--push", SLOT.REMOTE_NAME],
];
const SETUP_TEMPLATES = [
  ["init"],
  ["config", "user.email", "fixture@example.com"],
  ["config", "user.name", "Frozen-Fixture"],
  ["add", "README.md"],
  ["commit", "-m", SLOT.MSG],
  ["remote", "add", "origin", SLOT.REMOTE_URL],
  ["worktree", "add", "-b", SLOT.BRANCH, SLOT.REL, "HEAD"],
  ["checkout", "-b", SLOT.BRANCH],
  ["reset", "--hard", SLOT.SHA40],
];

function matchTemplate(template, args) {
  if (template.length !== args.length) return false;
  for (let i = 0; i < template.length; i += 1) {
    const expected = template[i];
    const actual = args[i];
    if (typeof actual !== "string") return false;
    if (typeof expected === "string") {
      if (actual !== expected) return false;
    } else if (expected === SLOT.REL) {
      if (!isRelNoTraversal(actual)) return false;
    } else if (!expected.test(actual)) {
      return false;
    }
  }
  return true;
}

/** Classify an exact Git argv. Returns {kind, template} or refuses GIT_TEMPLATE. */
export function matchGitTemplate(args) {
  if (!Array.isArray(args)) refuse("GIT_TEMPLATE", "git argv must be an array");
  for (const [kind, table] of [
    ["read", READ_TEMPLATES],
    ["setup", SETUP_TEMPLATES],
  ]) {
    for (const template of table) {
      if (matchTemplate(template, args)) return { kind, template };
    }
  }
  return refuse("GIT_TEMPLATE", `git argv is not an approved exact template: ${JSON.stringify(args)}`);
}

/**
 * Admit a Git launch. Validates exact argv, canonical cwd containment under the
 * owned repos root, and target operands before any process exists.
 */
export function planGitLaunch({ args, cwd, reposRoot }) {
  const matched = matchGitTemplate(args);
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) refuse("GIT_CWD", "git cwd must be absolute");
  let canonicalCwd;
  try {
    canonicalCwd = fs.realpathSync(cwd);
  } catch {
    refuse("GIT_CWD", `git cwd does not exist: ${cwd}`);
  }
  if (!isSameOrInside(reposRoot, canonicalCwd)) {
    refuse("GIT_CWD_ESCAPE", `git cwd is outside the owned repos root: ${canonicalCwd}`);
  }
  if (args[0] === "worktree" && args[1] === "add") {
    const target = args[5];
    if (!isSameOrInside(reposRoot, path.resolve(target))) {
      refuse("GIT_TARGET_ESCAPE", `worktree target is outside the owned repos root: ${target}`);
    }
    if (fs.existsSync(target)) refuse("GIT_TARGET_EXISTS", `worktree target already exists: ${target}`);
  }
  return { kind: matched.kind, argv: args, cwd: canonicalCwd };
}

/* ------------------------------------------------------------------------- */
/* Hermetic Git environment                                                  */
/* ------------------------------------------------------------------------- */

function hermeticGitEnv(workDir) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_")) continue;
    env[key] = value;
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_ATTR_NOSYSTEM = "1";
  env.GIT_DISCOVERY_ACROSS_FILESYSTEM = "0";
  env.GIT_ASKPASS = "/bin/false";
  env.SSH_ASKPASS = "/bin/false";
  env.LC_ALL = "C";
  if (workDir) {
    env.GIT_CEILING_DIRECTORIES = workDir;
    env.GIT_TEMPLATE_DIR = path.join(workDir, "empty-template");
  }
  return env;
}

/** Loader-internal source-pin reader: RAW exec, scoped to H or the role cwd. */
function loaderGitRead(args, cwd, allowedRoots, ledger) {
  const first = args[0];
  const second = args[1];
  const allowed =
    (first === "rev-parse" && (second === "--show-toplevel" || second === "HEAD")) ||
    first === "hash-object" ||
    (first === "status" && second === "--porcelain");
  if (!allowed) refuse("LOADER_READ", `loader reader refused argv: ${JSON.stringify(args)}`);
  if (!allowedRoots.some((root) => path.resolve(root) === path.resolve(cwd))) {
    refuse("LOADER_READ_ROOT", `loader reader cwd is not an allowed root: ${cwd}`);
  }
  debitLedger(ledger);
  return RAW_EXEC_FILE_SYNC("git", args, {
    cwd,
    env: hermeticGitEnv(),
    encoding: "utf8",
    timeout: FIXED_CEILINGS.gitCallTimeoutMs,
    maxBuffer: FIXED_CEILINGS.gitCallMaxOutputBytes,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/* ------------------------------------------------------------------------- */
/* Manifest + fixed environment                                              */
/* ------------------------------------------------------------------------- */

function readFixedEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    refuse("MISSING_ENV", `required fixed environment key is missing: ${name}`);
  }
  return value.trim();
}
function parseManifest() {
  let raw;
  try {
    raw = fs.readFileSync(MANIFEST_PATH);
  } catch {
    refuse("MANIFEST_MISSING", `manifest is not readable: ${MANIFEST_PATH}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch {
    refuse("MANIFEST_INVALID", "manifest is not valid JSON");
  }
  if (manifest?.schema !== "paperclip.frozen-validator.manifest/v1") {
    refuse("MANIFEST_SCHEMA", "manifest schema is not the pinned version");
  }
  return { manifest, manifestSha256: sha256Bytes(raw) };
}

function validateHostIdentity(budgetLedger, hostSha, manifestPin, manifest, manifestSha256) {
  const top = loaderGitRead(["rev-parse", "--show-toplevel"], HERE, [HERE, HOST_ROOT], budgetLedger);
  if (path.resolve(top) !== HOST_ROOT) refuse("HOST_TOPLEVEL", `host top-level ${top} is not ${HOST_ROOT}`);
  const head = loaderGitRead(["rev-parse", "HEAD"], HOST_ROOT, [HOST_ROOT], budgetLedger);
  if (head !== hostSha) refuse("HOST_HEAD", `host HEAD ${head} is not the certified pin ${hostSha}`);
  if (manifestSha256 !== manifestPin) refuse("MANIFEST_HASH", "manifest SHA256 does not match the certified pin");
  for (const [rel, expected] of Object.entries(manifest.hostFiles ?? {})) {
    const absolute = path.join(HOST_ROOT, rel);
    if (!fs.existsSync(absolute)) refuse("HOST_FILE_MISSING", `pinned host file is missing: ${rel}`);
    const sha = sha256FileSync(absolute);
    const blob = loaderGitRead(["hash-object", rel], HOST_ROOT, [HOST_ROOT], budgetLedger);
    if (sha !== expected.sha256 || blob !== expected.blob) {
      refuse("HOST_FILE_DRIFT", `pinned host file bytes/blobs drifted: ${rel}`);
    }
  }
  const selfExpected = manifest.hostFiles?.["server/src/__tests__/frozen-validator-loader.mjs"];
  if (!selfExpected || sha256FileSync(THIS_FILE) !== selfExpected.sha256) {
    refuse("LOADER_SELF", "loader bytes do not match the pinned host manifest entry");
  }
}

function validateForeignEnv() {
  if (process.env.NODE_PATH || process.env.NODE_OPTIONS) {
    refuse("FOREIGN_NODE_ENV", "NODE_PATH/NODE_OPTIONS must not be present");
  }
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.SENTRY_DSN) {
    refuse("FOREIGN_OBSERVABILITY", "observability endpoints/DSNs must be absent");
  }
}

function validateScratch(manifest) {
  const scratchRaw = process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? "";
  const tmpRaw = process.env.TMPDIR ?? "";
  if (scratchRaw.trim() === "" || tmpRaw.trim() === "") {
    refuse("SCRATCH_EMPTY", "PAPERCLIP_RUN_SCRATCH_DIR and TMPDIR must be nonempty");
  }
  if (!path.isAbsolute(scratchRaw) || !path.isAbsolute(tmpRaw)) {
    refuse("SCRATCH_NOT_ABSOLUTE", "scratch and TMPDIR must be absolute");
  }
  const scratch = path.resolve(scratchRaw);
  const tmp = path.resolve(tmpRaw);
  assertRealDirectory(scratch, "SCRATCH_MISSING");
  assertRealDirectory(tmp, "TMPDIR_MISSING");
  assertNoSymlinkComponents(scratch);
  if (typeof process.getuid === "function") {
    const uid = process.getuid();
    if (fs.statSync(scratch).uid !== uid || fs.statSync(tmp).uid !== uid) {
      refuse("SCRATCH_OWNER", "scratch and TMPDIR must be owned by the executing UID");
    }
  }
  const enclosing = findEnclosingGitRepository(scratch) ?? findEnclosingGitRepository(tmp);
  if (enclosing) refuse("SCRATCH_IN_GIT", `scratch/TMPDIR must not be inside a Git repository (${enclosing})`);
  const roots = [HOST_ROOT, ...ROLES.map((r) => manifest.roles?.[r]?.cwd).filter(Boolean)];
  for (const root of roots) {
    if (pathOverlaps(scratch, root) || pathOverlaps(tmp, root)) {
      refuse("SCRATCH_SOURCE_OVERLAP", `scratch/TMPDIR overlaps a protected source root: ${root}`);
    }
  }
  return { scratch, tmp };
}

/* ------------------------------------------------------------------------- */
/* Contract A.2: counted canonical source-pin validation                     */
/* ------------------------------------------------------------------------- */

function validateSourcePins(manifest, role, roleConfig, scratch, tmp, budgetLedger) {
  const roleCwd = path.resolve(roleConfig.cwd);
  assertRealDirectory(roleCwd, "ROLE_CWD");
  assertNoSymlinkComponents(roleCwd);
  const top = loaderGitRead(["rev-parse", "--show-toplevel"], roleCwd, [roleCwd], budgetLedger);
  if (path.resolve(top) !== roleCwd) refuse("ROLE_TOPLEVEL", `role top-level ${top} is not ${roleCwd}`);

  const roots = [HOST_ROOT, ...ROLES.map((r) => manifest.roles[r].cwd)];
  for (let i = 0; i < roots.length; i += 1) {
    for (let j = i + 1; j < roots.length; j += 1) {
      if (pathOverlaps(roots[i], roots[j])) {
        refuse("SOURCE_OVERLAP", `H/C/B roots overlap: ${roots[i]} vs ${roots[j]}`);
      }
    }
    if (pathOverlaps(scratch, roots[i]) || pathOverlaps(tmp, roots[i])) {
      refuse("SCRATCH_SOURCE_OVERLAP", `scratch/TMPDIR overlaps a source root: ${roots[i]}`);
    }
  }

  const head = loaderGitRead(["rev-parse", "HEAD"], roleCwd, [roleCwd], budgetLedger);
  if (!SLOT.SHA40.test(roleConfig.revision) || head !== roleConfig.revision) {
    refuse("ROLE_HEAD", `role HEAD ${head} is not the pinned revision ${roleConfig.revision}`);
  }
  const status = RAW_EXEC_FILE_SYNC(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { cwd: roleCwd, env: hermeticGitEnv(), encoding: "utf8", timeout: FIXED_CEILINGS.gitCallTimeoutMs, maxBuffer: FIXED_CEILINGS.gitCallMaxOutputBytes },
  ).trim();
  if (status !== "") refuse("ROLE_DIRTY", "role tracked tree is not clean");

  for (const [rel, expected] of Object.entries(roleConfig.files ?? {})) {
    if (!isRelNoTraversal(rel)) refuse("ROLE_FILE_KEY", `role file key is not a safe relative path: ${rel}`);
    const absolute = path.join(roleCwd, rel);
    if (!fs.existsSync(absolute)) refuse("ROLE_FILE_MISSING", `pinned role file is missing: ${rel}`);
    const sha = sha256FileSync(absolute);
    const blob = loaderGitRead(["hash-object", rel], roleCwd, [roleCwd], budgetLedger);
    if (sha !== expected.sha256 || blob !== expected.blob) {
      refuse("ROLE_FILE_DRIFT", `pinned role file bytes/blobs drifted: ${rel}`);
    }
  }
  if (!roleConfig.files?.["server/src/services/workspace-runtime.ts"]) {
    refuse("ROLE_CLOSURE", "role manifest is missing workspace-runtime.ts");
  }
  return { roleCwd };
}

function validateNodeIdentity(manifest, fixedNode) {
  if (process.execPath !== fixedNode) {
    refuse("NODE_PATH", `process.execPath ${process.execPath} is not the certified Node ${fixedNode}`);
  }
  if (process.versions.node !== manifest.toolchain.node) {
    refuse("NODE_VERSION", `Node ${process.versions.node} is not the pinned ${manifest.toolchain.node}`);
  }
}

/* ------------------------------------------------------------------------- */
/* Contract A.1: receipt + lifecycle phases                                  */
/* ------------------------------------------------------------------------- */

function buildRolePaths(scratch, role) {
  const roleDir = path.join(scratch, "frozen-validator", role);
  const work = path.join(roleDir, "work");
  const evidence = path.join(roleDir, "evidence");
  return {
    roleDir,
    work,
    repos: path.join(work, "repos"),
    cache: path.join(work, "cache"),
    home: path.join(work, "home"),
    tmp: path.join(work, "tmp"),
    output: evidence,
    evidence,
  };
}

function receiptPath(roleDir) {
  return path.join(roleDir, "role-receipt.json");
}

function createRoleLifecycle(paths, ctx) {
  assertNoSymlinkComponents(path.dirname(paths.roleDir));
  if (fs.existsSync(paths.roleDir)) refuse("ROLE_DIR_EXISTS", `refusing a pre-existing role directory: ${paths.roleDir}`);
  fs.mkdirSync(path.dirname(paths.roleDir), { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.roleDir, { recursive: false, mode: 0o700 });
  for (const dir of [paths.work, paths.repos, paths.cache, paths.home, paths.tmp, paths.evidence]) {
    fs.mkdirSync(dir, { recursive: false, mode: 0o700 });
  }
  fs.mkdirSync(path.join(paths.work, "empty-template"), { recursive: false, mode: 0o700 });
  const receipt = {
    schema: "paperclip.frozen-validator.role-receipt/v1",
    role: ctx.role,
    hostRoot: HOST_ROOT,
    hostSha: ctx.hostSha,
    manifestSha256: ctx.manifestSha256,
    roleWorkspaceId: ctx.roleConfig.workspaceId,
    roleCwd: ctx.roleConfig.cwd,
    roleRevision: ctx.roleConfig.revision,
    scratch: ctx.scratch,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    bootstrapPid: process.pid,
    nonce: ctx.nonce,
    createdAt: new Date().toISOString(),
  };
  const temp = path.join(paths.roleDir, `.role-receipt.${randomUUID()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(receipt), { mode: 0o600 });
  fs.renameSync(temp, receiptPath(paths.roleDir));
}

function isLiveAncestor(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  let current = process.ppid;
  for (let depth = 0; depth < 12 && current > 1; depth += 1) {
    if (current === pid) return true;
    try {
      current = Number(fs.readFileSync(`/proc/${current}/stat`, "utf8").split(" ")[3]);
    } catch {
      return false;
    }
  }
  return false;
}

function attachRoleLifecycle(paths, ctx) {
  assertRealDirectory(paths.roleDir, "ROLE_DIR_MISSING");
  assertNoSymlinkComponents(paths.roleDir);
  if (typeof process.getuid === "function" && fs.statSync(paths.roleDir).uid !== process.getuid()) {
    refuse("ROLE_RECEIPT_OWNER", "roleDir is not owned by the executing UID");
  }
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath(paths.roleDir), "utf8"));
  } catch {
    refuse("ROLE_RECEIPT_MISSING", "role receipt is missing or unreadable");
  }
  const expected = {
    schema: "paperclip.frozen-validator.role-receipt/v1",
    role: ctx.role,
    hostRoot: HOST_ROOT,
    hostSha: ctx.hostSha,
    manifestSha256: ctx.manifestSha256,
    roleWorkspaceId: ctx.roleConfig.workspaceId,
    roleCwd: ctx.roleConfig.cwd,
    roleRevision: ctx.roleConfig.revision,
    scratch: ctx.scratch,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    nonce: ctx.nonce,
    bootstrapPid: ctx.bootstrapPid,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (receipt?.[key] !== value) refuse("ROLE_RECEIPT_MISMATCH", `role receipt mismatch on ${key}`);
  }
  if (!isLiveAncestor(ctx.bootstrapPid)) refuse("ROLE_RECEIPT_MISMATCH", "bootstrap PID is not a live ancestor");
  for (const dir of [paths.work, paths.repos, paths.cache, paths.home, paths.tmp, paths.evidence]) {
    assertRealDirectory(dir, "ROLE_SUBDIR_MISSING");
  }
}

/* ------------------------------------------------------------------------- */
/* Memoized context                                                          */
/* ------------------------------------------------------------------------- */

let MEMO = null;

export function buildValidatedRoleContext(options = {}) {
  if (MEMO) {
    const requested = options.phase;
    if (requested && MEMO.phase !== requested) refuse("CONTEXT_MODE_CONFLICT", "phase/role conflict on memoized context");
    return MEMO;
  }
  const role = (process.env.PC_FROZEN_VALIDATOR_ROLE ?? "").trim();
  if (!ROLES.includes(role)) refuse("ROLE_UNKNOWN", `role must be candidate or base; got ${JSON.stringify(role)}`);
  const phase = options.phase ?? (process.env.PC_FROZEN_VALIDATOR_PHASE ?? "").trim();
  if (!PHASES.includes(phase)) refuse("CONTEXT_PHASE", `phase must be create or attach; got ${JSON.stringify(phase)}`);
  const hostSha = readFixedEnv("PC_FROZEN_VALIDATOR_HOST_SHA");
  const manifestPin = readFixedEnv("PC_FROZEN_VALIDATOR_MANIFEST_SHA256");
  const nonce = readFixedEnv("PC_FROZEN_VALIDATOR_RECEIPT_NONCE");
  const fixedNode = readFixedEnv("PC_FROZEN_VALIDATOR_NODE");

  const { manifest, manifestSha256 } = parseManifest();

  let ledger;
  if (phase === "create") {
    ledger = createLedger({ remaining: FIXED_CEILINGS.gitCallsPerRole, spent: 0 });
  } else {
    const allocation = Number.parseInt(process.env.PC_FROZEN_VALIDATOR_GIT_ALLOCATION ?? "", 10);
    if (!Number.isSafeInteger(allocation) || allocation <= 0) {
      refuse("GIT_ALLOCATION", "attach phase requires a positive safe-integer Git allocation");
    }
    ledger = createLedger({ remaining: allocation, spent: 0 });
  }

  validateNodeIdentity(manifest, fixedNode);
  validateForeignEnv();
  validateHostIdentity(ledger, hostSha, manifestPin, manifest, manifestSha256);

  const roleConfig = manifest.roles?.[role];
  if (!roleConfig || typeof roleConfig.cwd !== "string") refuse("ROLE_CONFIG", `no role config for ${role}`);
  const { scratch, tmp } = validateScratch(manifest);
  const source = validateSourcePins(manifest, role, roleConfig, scratch, tmp, ledger);
  const dirs = buildRolePaths(scratch, role);

  const bootstrapPid = Number.parseInt(process.env.PC_FROZEN_VALIDATOR_BOOTSTRAP_PID ?? "", 10);
  const ctx = {
    role,
    phase,
    hostRoot: HOST_ROOT,
    hostSha,
    manifestPath: MANIFEST_PATH,
    manifest,
    manifestSha256,
    roleConfig,
    scratch,
    tmp,
    source,
    dirs,
    node: fixedNode,
    nonce,
    bootstrapPid,
    ceilings: FIXED_CEILINGS,
    ledger,
    git: { env: hermeticGitEnv(dirs.work) },
  };

  if (phase === "create") {
    createRoleLifecycle(dirs, ctx);
  } else {
    attachRoleLifecycle(dirs, ctx);
  }
  options.reporter?.({ gitCalls: ledger.spent, remaining: ledger.remaining });

  MEMO = ctx;
  return ctx;
}

export function getValidatedRoleContext() {
  if (!MEMO) buildValidatedRoleContext({});
  return MEMO;
}

/* ------------------------------------------------------------------------- */
/* Contract E.1: canonical closure plugin + E.4 Vite resolution              */
/* ------------------------------------------------------------------------- */

function resolveVitestPackage(manifest) {
  const tool = manifest.closure?.toolchainModules?.vitest;
  if (!tool?.pnpmDirPrefix) refuse("CLOSURE_TOOLCHAIN", "manifest has no Vitest closure entry");
  const pnpmRoot = path.join(HOST_ROOT, "node_modules/.pnpm");
  const candidates = fs
    .readdirSync(pnpmRoot)
    .filter((name) => name.startsWith(tool.pnpmDirPrefix))
    .map((name) => path.join(pnpmRoot, name, "node_modules", tool.package));
  const matches = candidates.filter((candidate) => {
    const pkgJson = path.join(candidate, "package.json");
    return fs.existsSync(pkgJson) && sha256FileSync(pkgJson) === tool.packageJsonSha256;
  });
  if (matches.length !== 1) refuse("CLOSURE_TOOLCHAIN", "could not uniquely resolve the pinned Vitest package");
  const real = fs.realpathSync(matches[0]);
  if (!isSameOrInside(path.join(HOST_ROOT, "node_modules/.pnpm"), real)) {
    refuse("CLOSURE_TOOLCHAIN", "Vitest realpath leaves the role-local pnpm store");
  }
  const packageJson = path.join(real, "package.json");
  return { packageDir: real, packageJson, packageJsonSha256: sha256FileSync(packageJson), tool };
}

function resolveViteEntry(manifest, vitest) {
  const tool = manifest.closure?.toolchainModules?.vite;
  if (!tool?.packageJsonSha256) refuse("CLOSURE_TOOLCHAIN", "manifest has no Vite closure entry");
  const require = createRequire(vitest.packageJson);
  let resolved;
  try {
    resolved = require.resolve("vite/package.json");
  } catch {
    refuse("CLOSURE_TOOLCHAIN", "Vite is not resolvable from the pinned Vitest closure");
  }
  const real = fs.realpathSync(resolved);
  if (path.join(HOST_ROOT, "node_modules/vite") === real || real.startsWith(path.join(HOST_ROOT, "node_modules/vite") + path.sep)) {
    refuse("CLOSURE_TOOLCHAIN", "refusing the root-link Vite fallback");
  }
  if (!isSameOrInside(path.join(HOST_ROOT, "node_modules/.pnpm"), real)) {
    refuse("CLOSURE_TOOLCHAIN", "Vite realpath leaves the role-local pnpm store");
  }
  if (sha256FileSync(real) !== tool.packageJsonSha256) {
    refuse("CLOSURE_TOOLCHAIN", "Vite package.json SHA256 does not match the pinned toolchain");
  }
  const pkg = JSON.parse(fs.readFileSync(real, "utf8"));
  if (pkg.version !== tool.version) refuse("CLOSURE_TOOLCHAIN", `Vite version ${pkg.version} is not pinned ${tool.version}`);
  const exportsField = pkg.exports?.["."];
  let entry;
  if (typeof exportsField === "string") entry = exportsField;
  else if (exportsField && typeof exportsField === "object") {
    for (const condition of tool.conditions ?? ["node", "import", "default"]) {
      if (typeof exportsField[condition] === "string") {
        entry = exportsField[condition];
        break;
      }
    }
  }
  if (!entry) refuse("CLOSURE_TOOLCHAIN", "could not select the Vite entry under the pinned conditions");
  const entryPath = path.resolve(path.dirname(real), entry);
  if (!fs.existsSync(entryPath)) refuse("VITE_ENTRY_MISSING", `Vite entry does not exist: ${entryPath}`);
  if (!entryPath.endsWith(path.join("dist", "node", "index.js"))) {
    refuse("VITE_ENTRY_SHAPE", `Vite entry is not dist/node/index.js: ${entryPath}`);
  }
  const entrySha = sha256FileSync(entryPath);
  if (!tool.entrySha256 || entrySha !== tool.entrySha256) {
    refuse("VITE_ENTRY_HASH", "Vite entry SHA256 does not match the pinned artifact");
  }
  return { entryPath, entrySha256: entrySha, realpath: path.dirname(real), version: pkg.version };
}

function createClosureAuditPlugin(roleConfig, audits) {
  const closureRoot = path.resolve(roleConfig.cwd);
  const toolchainPrefixes = manifestsToolchainPrefixes();
  const contains = (absolute) =>
    isSameOrInside(closureRoot, absolute) ||
    toolchainPrefixes.some((prefix) => isSameOrInside(prefix, absolute));
  const check = (id) => {
    if (typeof id !== "string") return;
    if (id.includes("\0")) refuse("CLOSURE_VIRTUAL", `virtual module refused: ${id}`);
    if (id.startsWith("node:")) return;
    const absolute = path.isAbsolute(id) ? id : null;
    if (!absolute) return;
    let real = absolute;
    try {
      real = fs.realpathSync(absolute);
    } catch {
      /* not yet on disk */
    }
    if (!contains(real)) refuse("CLOSURE_ESCAPE", `module target outside the role closure: ${real}`);
    audits.push({ id, realpath: real });
  };
  return {
    name: "frozen-validator-closure-audit",
    enforce: "pre",
    resolveId(source) {
      if (typeof source === "string" && source.startsWith("@paperclipai/")) return null;
      if (path.isAbsolute(source)) check(source);
      return null;
    },
    load(id) {
      check(id);
      return null;
    },
    buildEnd() {
      // bounded audit is written by loadBoundSubject.
    },
  };
}
let TOOLCHAIN_PREFIXES = [];
function manifestsToolchainPrefixes() {
  return TOOLCHAIN_PREFIXES;
}

/**
 * Contract A + E.4: load exactly the bound subject exports through the canonical
 * Vitest-closure Vite 8.2.2. Never loads the host heartbeat.
 */
export async function loadBoundSubject(ctx) {
  const { roleConfig, dirs, manifest } = ctx;
  const vitest = resolveVitestPackage(manifest);
  const vite = resolveViteEntry(manifest, vitest);
  TOOLCHAIN_PREFIXES = [vitest.packageDir, path.dirname(vite.realpath)];

  const viteModule = await import(pathToFileURL(vite.entryPath).href);
  if (typeof viteModule.createServer !== "function") refuse("VITE_API", "Vite module does not export createServer");

  const audits = [];
  const runnerAlias = {
    find: /^@paperclipai\/paperclip-runner$/,
    replacement: path.join(roleConfig.cwd, "packages/paperclip-runner/src/index.ts"),
  };
  const runnerLiveAlias = {
    find: /^@paperclipai\/paperclip-runner\/live$/,
    replacement: path.join(roleConfig.cwd, "packages/paperclip-runner/dist/live/index.js"),
  };
  const server = await viteModule.createServer({
    root: roleConfig.cwd,
    configFile: false,
    envFile: false,
    appType: "custom",
    cacheDir: dirs.cache,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    resolve: { alias: [runnerAlias, runnerLiveAlias] },
    ssr: { noExternal: true },
    plugins: [createClosureAuditPlugin(roleConfig, audits)],
  });
  try {
    const heartbeat = await server.ssrLoadModule(path.join(roleConfig.cwd, "server/src/services/heartbeat.ts"), {
      fixStacktrace: false,
    });
    const homePaths = await server.ssrLoadModule(path.join(roleConfig.cwd, "server/src/home-paths.ts"), {
      fixStacktrace: false,
    });
    const validate = heartbeat?.assertGitSensitiveAdapterWorkspaceValid;
    const resolveHome = homePaths?.resolveDefaultAgentWorkspaceDir;
    if (typeof validate !== "function" || typeof resolveHome !== "function") {
      refuse("SUBJECT_EXPORTS", "bound subject is missing a required callable export");
    }
    const auditPath = path.join(dirs.output, "module-audit.jsonl");
    const bounded = audits.slice(0, 20000).map((a) => JSON.stringify(a)).join("\n") + "\n";
    fs.writeFileSync(auditPath, bounded);
    return {
      assertGitSensitiveAdapterWorkspaceValid: validate,
      resolveDefaultAgentWorkspaceDir: resolveHome,
      close: () => server.close(),
      subjectRevision: roleConfig.revision,
      subjectWorkspaceId: roleConfig.workspaceId,
      vite: { realpath: vite.realpath, version: vite.version, entrySha256: vite.entrySha256 },
      auditPath,
    };
  } catch (error) {
    await server.close().catch(() => {});
    throw error;
  }
}

export const FROZEN_VALIDATOR_FIXED_CEILINGS = FIXED_CEILINGS;
export const FROZEN_VALIDATOR_HOST_ROOT = HOST_ROOT;
export const FROZEN_VALIDATOR_LOADER_PATH = THIS_FILE;
export const FROZEN_VALIDATOR_SLOTS = SLOT;
