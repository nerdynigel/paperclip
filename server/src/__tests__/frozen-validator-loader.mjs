/**
 * Frozen validator host loader (THE-567 corrected static publication).
 *
 * Plain built-in ESM only at module scope. No product, Vitest or Vite import
 * until the initial guards pass. Exports:
 *   - buildValidatedRoleContext(): pure guard, built-ins + counted local Git reads
 *   - loadBoundSubject(ctx): dynamic Vite SSR load of the exact bound subject
 *
 * This is a proposed static interface. Compatibility with the complete subject
 * graph and side-effect confinement is UNPROVED. It is not a runtime capability
 * verdict and grants no execution authority.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAW_EXEC_FILE_SYNC = execFileSync;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(HERE, "frozen-validator.manifest.json");
const THIS_FILE = path.join(HERE, "frozen-validator-loader.mjs");

const ROLES = ["candidate", "base"];
const FIXED_CEILINGS = Object.freeze({
  gitCallsPerRole: 600,
  gitCallTimeoutMs: 15000,
  gitCallMaxOutputBytes: 1048576,
  roleStdioMaxBytes: 8388608,
  caseLogMaxBytes: 4194304,
  caseLogRowMaxBytes: 65536,
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

function sha256FileSync(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isSameOrInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function pathOverlaps(left, right) {
  return isSameOrInside(left, right) || isSameOrInside(right, left);
}

function assertNoSymlinkComponents(target) {
  const resolved = path.resolve(target);
  const parts = resolved.split(path.sep);
  let current = path.sep;
  for (const part of parts) {
    if (part === "") continue;
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return; // remaining components do not exist yet; validated separately
    }
    if (stat.isSymbolicLink()) {
      refuse("SCRATCH_SYMLINK", `refusing symlinked path component: ${current}`);
    }
  }
}

function assertExistingDirectory(target, code) {
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

function hermeticGitEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_")) continue;
    env[key] = value;
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.LC_ALL = "C";
  return env;
}

function countedGitRead(args, cwd, budget) {
  budget.count += 1;
  if (budget.count > budget.limit) {
    refuse("GIT_BUDGET", `aggregate Git read ceiling exceeded (${budget.limit})`);
  }
  return RAW_EXEC_FILE_SYNC("git", args, {
    cwd,
    env: hermeticGitEnv(),
    encoding: "utf8",
    timeout: FIXED_CEILINGS.gitCallTimeoutMs,
    maxBuffer: FIXED_CEILINGS.gitCallMaxOutputBytes,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

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
  return { manifest, manifestSha256: createHash("sha256").update(raw).digest("hex") };
}

function validateHostIdentity(budget, hostSha, manifestSha256, manifest, manifestRawSha) {
  const top = countedGitRead(["rev-parse", "--show-toplevel"], HERE, budget);
  if (path.resolve(top) !== HOST_ROOT) {
    refuse("HOST_TOPLEVEL", `fixture host top-level ${top} is not ${HOST_ROOT}`);
  }
  const head = countedGitRead(["rev-parse", "HEAD"], HOST_ROOT, budget);
  if (head !== hostSha) {
    refuse("HOST_HEAD", `host HEAD ${head} is not the certified host pin ${hostSha}`);
  }
  if (manifestRawSha !== manifestSha256) {
    refuse("MANIFEST_HASH", "manifest SHA256 does not match the certified manifest pin");
  }
  for (const [rel, expected] of Object.entries(manifest.hostFiles ?? {})) {
    const absolute = path.join(HOST_ROOT, rel);
    if (!fs.existsSync(absolute)) {
      refuse("HOST_FILE_MISSING", `pinned host file is missing: ${rel}`);
    }
    const sha = sha256FileSync(absolute);
    const blob = countedGitRead(["hash-object", rel], HOST_ROOT, budget);
    if (sha !== expected.sha256 || blob !== expected.blob) {
      refuse("HOST_FILE_DRIFT", `pinned host file bytes/blobs drifted: ${rel}`);
    }
  }
  const selfSha = sha256FileSync(THIS_FILE);
  const selfExpected = manifest.hostFiles?.["server/src/__tests__/frozen-validator-loader.mjs"];
  if (!selfExpected || selfSha !== selfExpected.sha256) {
    refuse("LOADER_SELF", "loader bytes do not match the pinned host manifest entry");
  }
}

function validateScratch(manifest) {
  if (process.env.NODE_PATH || process.env.NODE_OPTIONS) {
    refuse("FOREIGN_NODE_ENV", "NODE_PATH/NODE_OPTIONS must not be present");
  }
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.SENTRY_DSN) {
    refuse("FOREIGN_OBSERVABILITY", "observability endpoints/DSNs must be absent");
  }
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
  assertExistingDirectory(scratch, "SCRATCH_MISSING");
  assertExistingDirectory(tmp, "TMPDIR_MISSING");
  assertNoSymlinkComponents(scratch);
  assertNoSymlinkComponents(tmp);
  if (typeof process.getuid === "function") {
    const uid = process.getuid();
    if (fs.statSync(scratch).uid !== uid || fs.statSync(tmp).uid !== uid) {
      refuse("SCRATCH_OWNER", "scratch and TMPDIR must be owned by the executing UID");
    }
  }
  const enclosing = findEnclosingGitRepository(scratch) ?? findEnclosingGitRepository(tmp);
  if (enclosing) {
    refuse("SCRATCH_IN_GIT", `scratch/TMPDIR must not be inside a Git repository (${enclosing})`);
  }
  const roots = [HOST_ROOT, ...ROLES.map((role) => manifest.roles?.[role]?.cwd).filter(Boolean)];
  for (const root of roots) {
    if (pathOverlaps(scratch, root) || pathOverlaps(tmp, root)) {
      refuse("SCRATCH_SOURCE_OVERLAP", `scratch/TMPDIR overlaps a protected source root: ${root}`);
    }
  }
  return { scratch, tmp };
}

function buildRoleDirectories(scratch, role) {
  const roleDir = path.join(scratch, "frozen-validator", role);
  const dirs = {
    roleDir,
    repos: path.join(roleDir, "repos"),
    cache: path.join(roleDir, "cache"),
    output: path.join(roleDir, "output"),
    home: path.join(roleDir, "home"),
  };
  assertNoSymlinkComponents(path.dirname(roleDir));
  if (fs.existsSync(roleDir)) {
    refuse("ROLE_DIR_EXISTS", `refusing a pre-existing role directory: ${roleDir}`);
  }
  return dirs;
}

/**
 * Build the validated role context. Pure built-ins plus counted local Git reads.
 * `reporter` (optional) receives {gitCalls} deltas for supervised IPC accounting.
 */
export function buildValidatedRoleContext(options = {}) {
  const role = (process.env.PC_FROZEN_VALIDATOR_ROLE ?? "").trim();
  if (!ROLES.includes(role)) {
    refuse("ROLE_UNKNOWN", `PC_FROZEN_VALIDATOR_ROLE must be candidate or base; got ${JSON.stringify(role)}`);
  }
  const hostSha = readFixedEnv("PC_FROZEN_VALIDATOR_HOST_SHA");
  const manifestPin = readFixedEnv("PC_FROZEN_VALIDATOR_MANIFEST_SHA256");
  const node = process.execPath;

  const budget = { count: Number(options.initialGitCount ?? 0), limit: FIXED_CEILINGS.gitCallsPerRole };
  const { manifest, manifestSha256 } = parseManifest();
  validateHostIdentity(budget, hostSha, manifestPin, manifest, manifestSha256);

  const roleConfig = manifest.roles?.[role];
  if (!roleConfig || typeof roleConfig.cwd !== "string") {
    refuse("ROLE_CONFIG", `manifest has no role config for ${role}`);
  }
  if (path.resolve(roleConfig.cwd) !== HOST_ROOT && !fs.existsSync(roleConfig.cwd)) {
    refuse("ROLE_CWD", `role cwd does not exist: ${roleConfig.cwd}`);
  }

  const { scratch, tmp } = validateScratch(manifest);
  const dirs = buildRoleDirectories(scratch, role);

  options.reporter?.({ gitCalls: budget.count });

  return {
    role,
    hostRoot: HOST_ROOT,
    manifestPath: MANIFEST_PATH,
    manifest,
    manifestSha256,
    roleConfig,
    scratch,
    tmp,
    dirs,
    node,
    ceilings: FIXED_CEILINGS,
    git: { budget, env: hermeticGitEnv(), cwd: (cwd) => countedGitRead, read: countedGitRead },
  };
}

function createClosureAuditPlugin(roleConfig) {
  const closureRoot = path.resolve(roleConfig.cwd);
  return {
    name: "frozen-validator-closure-audit",
    enforce: "pre",
    resolveId(source, importer) {
      if (source.includes("\0")) {
        this.error(`frozen-validator: virtual module not permitted: ${source}`);
      }
      if (path.isAbsolute(source)) {
        const resolved = path.resolve(source);
        if (isSameOrInside(HOST_ROOT, resolved) && !isSameOrInside(closureRoot, resolved)) {
          this.error(`frozen-validator: refusing host/ancestor module target ${resolved}`);
        }
      }
      return null;
    },
    load(id) {
      if (path.isAbsolute(id)) {
        const resolved = path.resolve(id);
        if (isSameOrInside(HOST_ROOT, resolved) && !isSameOrInside(closureRoot, resolved)) {
          this.error(`frozen-validator: refusing host/ancestor module load ${resolved}`);
        }
      }
      return null;
    },
  };
}

/**
 * Load exactly the bound subject exports through a fresh Vite SSR instance for
 * the validated role. Never loads the host's own heartbeat. Unexecuted and
 * unproved against the full dependency closure.
 */
export async function loadBoundSubject(ctx) {
  const { roleConfig, dirs, manifest } = ctx;
  const viteEntry = path.join(ctx.hostRoot, "node_modules/vite/dist/node/index.js");
  if (!fs.existsSync(viteEntry)) {
    refuse("VITE_MISSING", `host Vite entrypoint is not installed: ${viteEntry}`);
  }
  const vite = await import(pathToFileURL(viteEntry).href);
  const createServer = vite.createServer;
  if (typeof createServer !== "function") {
    refuse("VITE_API", "host Vite module does not export createServer");
  }

  const runnerAlias = {
    find: /^@paperclipai\/paperclip-runner$/,
    replacement: path.join(roleConfig.cwd, "packages/paperclip-runner/src/index.ts"),
  };
  const runnerLiveAlias = {
    find: /^@paperclipai\/paperclip-runner\/live$/,
    replacement: path.join(roleConfig.cwd, "packages/paperclip-runner/dist/live/index.js"),
  };

  const server = await createServer({
    root: roleConfig.cwd,
    configFile: false,
    envFile: false,
    appType: "custom",
    cacheDir: dirs.cache,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    resolve: { alias: [runnerAlias, runnerLiveAlias] },
    ssr: { noExternal: [/^@paperclipai\//] },
    plugins: [createClosureAuditPlugin(roleConfig)],
  });

  try {
    const heartbeat = await server.ssrLoadModule(
      path.join(roleConfig.cwd, "server/src/services/heartbeat.ts"),
      { fixStacktrace: false },
    );
    const homePaths = await server.ssrLoadModule(
      path.join(roleConfig.cwd, "server/src/home-paths.ts"),
      { fixStacktrace: false },
    );
    const validate = heartbeat?.assertGitSensitiveAdapterWorkspaceValid;
    const resolveHome = homePaths?.resolveDefaultAgentWorkspaceDir;
    if (typeof validate !== "function" || typeof resolveHome !== "function") {
      refuse("SUBJECT_EXPORTS", "bound subject is missing a required callable export");
    }
    return {
      assertGitSensitiveAdapterWorkspaceValid: validate,
      resolveDefaultAgentWorkspaceDir: resolveHome,
      close: () => server.close(),
      subjectRevision: roleConfig.revision,
      subjectWorkspaceId: roleConfig.workspaceId,
      manifest,
    };
  } catch (error) {
    await server.close().catch(() => {});
    throw error;
  }
}

export const FROZEN_VALIDATOR_FIXED_CEILINGS = FIXED_CEILINGS;
export const FROZEN_VALIDATOR_HOST_ROOT = HOST_ROOT;
export const FROZEN_VALIDATOR_LOADER_PATH = THIS_FILE;
