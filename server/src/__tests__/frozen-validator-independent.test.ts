/**
 * Frozen independent validator fixture (THE-567 static authoring).
 *
 * This file is a *proposal* published from the authoring checkout. It is not
 * executed by the authoring suite. It only runs when a runner binds it to one
 * exact frozen checkout through the environment contract below, and it refuses
 * to run against any other checkout (including the authoring checkout).
 *
 * Subject under test: `assertGitSensitiveAdapterWorkspaceValid` in
 * `server/src/services/heartbeat.ts` of the bound frozen checkout.
 *
 * Roles are run separately:
 *   - `base`      -> immutable base revision (pre descendant-discovery change)
 *   - `candidate` -> immutable candidate revision (descendant-discovery change)
 *
 * Every case records its input, expected classification, actual classification
 * and verdict to a JSON-lines case log. Security expectations are the frozen
 * contract; they are never relaxed to make a candidate defect pass. Cases where
 * the candidate is predicted to accept though the contract requires refusal are
 * marked `predictedCandidateVerdict: "accept"` and remain explicit red
 * assertions for the independent certification task (THE-564); they are not
 * source-repair authority.
 *
 * Design limits (see the companion manifest,
 * `doc/investigations/2026-10-02-frozen-validator-independent-fixture-THE-567.md`):
 *   - Static bytes only. Nothing here is executed by the authoring run and this
 *     file proves no candidate acceptance on its own.
 *   - Cross-root module load, dependency closure and helper budget remain
 *     Reliability-owned runtime inputs; they are not granted by this file.
 *   - The fixture bounds its own Git setup subprocesses. The subject's internal
 *     Git usage is part of the candidate/base under test and is bounded instead
 *     by the per-test timeout.
 */

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDefaultAgentWorkspaceDir } from "../home-paths.js";
import {
  assertGitSensitiveAdapterWorkspaceValid,
  type ResolvedWorkspaceForRun,
} from "../services/heartbeat.ts";

const execFile = promisify(execFileCallback);

/* ------------------------------------------------------------------------- */
/* Frozen environment contract                                               */
/* ------------------------------------------------------------------------- */

const ROLE = (process.env.PC_FROZEN_VALIDATOR_ROLE ?? "").trim();
const FROZEN_ROOT = (process.env.PC_FROZEN_VALIDATOR_ROOT ?? "").trim();
const FROZEN_REVISION = (process.env.PC_FROZEN_VALIDATOR_REVISION ?? "").trim();
const FORBIDDEN_ROOT = (process.env.PC_FROZEN_VALIDATOR_FORBIDDEN_ROOT ?? "").trim();
const SCRATCH_ROOT_RAW = (
  process.env.PC_FROZEN_VALIDATOR_SCRATCH ??
  process.env.PAPERCLIP_RUN_SCRATCH_DIR ??
  ""
).trim();
const CASE_LOG_RAW = (process.env.PC_FROZEN_VALIDATOR_CASE_LOG ?? "").trim();

const GIT_MAX_CALLS = readPositiveInt(process.env.PC_FROZEN_VALIDATOR_GIT_MAX_CALLS, 600);
const GIT_CALL_TIMEOUT_MS = readPositiveInt(
  process.env.PC_FROZEN_VALIDATOR_GIT_TIMEOUT_MS,
  15_000,
);
const GIT_MAX_BUFFER = readPositiveInt(
  process.env.PC_FROZEN_VALIDATOR_GIT_MAX_BUFFER,
  1_048_576,
);

type Role = "base" | "candidate";

const PINNED_SOURCES: Record<
  Role,
  { revision: string; heartbeatBlob: string; heartbeatSha256: string }
> = {
  base: {
    revision: "871532c335bb8c0f501a200201f4e4ac1fc63fb0",
    heartbeatBlob: "76293aca7cc39f2f06e80d17704bd7bdd1ddc794",
    heartbeatSha256: "c668a1e69c75e652185b18283294a6e920b33867c7702224b154975f9d89600a",
  },
  candidate: {
    revision: "29bf67512aabd7b461a30e546c195e28c37f219e",
    heartbeatBlob: "47586831b3b90d8d16f2b053eba3177dfcd253a6",
    heartbeatSha256: "cbdfeedbcb28e660d4103ddfe585812585325e79202fc24902828699558b2750",
  },
};

const HEARTBEAT_RELATIVE_PATH = "server/src/services/heartbeat.ts";
const FIXTURE_FILE = fileURLToPath(import.meta.url);
const FIXTURE_DIR = path.dirname(FIXTURE_FILE);

const ALLOWED_GIT_SUBCOMMANDS = new Set([
  "init",
  "config",
  "add",
  "commit",
  "worktree",
  "branch",
  "checkout",
  "switch",
  "reset",
  "rev-parse",
  "merge-base",
  "remote",
  "hash-object",
  "symbolic-ref",
  "status",
]);

const READONLY_GIT_SUBCOMMANDS = new Set([
  "rev-parse",
  "hash-object",
  "cat-file",
  "config",
  "status",
]);

let gitCallCount = 0;
let scratchRoot = "";
let fixtureRoot = "";

const frozenEnabled = Boolean(ROLE && FROZEN_ROOT);
const frozenDescribe = frozenEnabled ? describe : describe.skip;

if (!frozenEnabled) {
  // Intentional: the published fixture is inert until a runner binds it to an
  // exact frozen checkout. It never silently exercises the authoring checkout.
  console.warn(
    "[frozen-validator-independent] skipped: set PC_FROZEN_VALIDATOR_ROLE and " +
      "PC_FROZEN_VALIDATOR_ROOT (plus FORBIDDEN_ROOT and SCRATCH) to run.",
  );
}

function readPositiveInt(raw: string | undefined, fallback: number) {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isPathSameOrInside(parentPath: string, childPath: string) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return (
    relative === "" ||
    (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/* ------------------------------------------------------------------------- */
/* Subject input builders (mirrors the production call shape)                */
/* ------------------------------------------------------------------------- */

type WorkspaceValidationInput = Parameters<
  typeof assertGitSensitiveAdapterWorkspaceValid
>[0];

function buildResolvedWorkspace(
  overrides: Partial<ResolvedWorkspaceForRun> = {},
): ResolvedWorkspaceForRun {
  return {
    cwd: "/tmp/project",
    source: "project_primary",
    projectId: "project-1",
    workspaceId: "workspace-1",
    repoUrl: null,
    repoRef: null,
    workspaceHints: [],
    warnings: [],
    baseCwdFallback: false,
    materializationFailures: [],
    ...overrides,
  };
}

function buildWorkspaceValidationInput(
  overrides: Partial<WorkspaceValidationInput> = {},
): WorkspaceValidationInput {
  return {
    adapterType: "codex_local",
    agentId: "agent-1",
    issue: {
      id: "issue-1",
      identifier: "THE-560",
      projectId: "project-1",
      projectWorkspaceId: "workspace-1",
    },
    resolvedWorkspace: buildResolvedWorkspace(),
    executionWorkspace: {
      baseCwd: "/tmp/project",
      source: "project_primary",
      projectId: "project-1",
      workspaceId: "workspace-1",
      repoUrl: null,
      repoRef: null,
      strategy: "project_primary",
      cwd: "/tmp/project",
      branchName: null,
      worktreePath: null,
      warnings: [],
      created: false,
      baseRefSha: null,
    },
    persistedExecutionWorkspace: {
      id: "execution-workspace-1",
      companyId: "company-1",
      projectId: "project-1",
      projectWorkspaceId: "workspace-1",
      sourceIssueId: "issue-1",
      mode: "project_workspace",
      strategyType: "project_primary",
      name: "Primary workspace",
      status: "active",
      cwd: "/tmp/project",
      repoUrl: null,
      baseRef: null,
      branchName: null,
      providerType: "local_path",
      providerRef: null,
      derivedFromExecutionWorkspaceId: null,
      lastUsedAt: new Date("2026-06-06T00:00:00.000Z"),
      openedAt: new Date("2026-06-06T00:00:00.000Z"),
      closedAt: null,
      cleanupEligibleAt: null,
      cleanupReason: null,
      config: null,
      metadata: null,
      createdAt: new Date("2026-06-06T00:00:00.000Z"),
      updatedAt: new Date("2026-06-06T00:00:00.000Z"),
    },
    executionTarget: { kind: "local" },
    ...overrides,
  };
}

interface InputParams {
  effectiveCwd: string | null;
  persistedCwd?: string | null;
  resolvedCwd?: string | null;
  baseCwd?: string | null;
  strategy?: "git_worktree" | "project_primary";
  persistedStrategy?: "git_worktree" | "project_primary";
  worktreePath?: string | null;
  providerRef?: string | null;
  branchName?: string | null;
  persistedBranchName?: string | null;
  repoUrl?: string | null;
  repoRef?: string | null;
  persistedBaseRef?: string | null;
  projectWorkspaceId?: string | null;
  persistedProjectWorkspaceId?: string | null;
}

function buildInput(params: InputParams): WorkspaceValidationInput {
  const base = buildWorkspaceValidationInput();
  const effective = params.effectiveCwd;
  const persistedCwd = params.persistedCwd ?? effective;
  const resolvedCwd = params.resolvedCwd ?? effective;
  const strategy = params.strategy ?? "project_primary";
  const persistedStrategy = params.persistedStrategy ?? "project_primary";
  const providerRef = params.providerRef ?? null;

  return buildWorkspaceValidationInput({
    resolvedWorkspace: buildResolvedWorkspace({
      cwd: resolvedCwd,
      repoUrl: params.repoUrl ?? null,
      repoRef: params.repoRef ?? null,
    }),
    executionWorkspace: {
      ...base.executionWorkspace,
      strategy,
      baseCwd: params.baseCwd ?? effective,
      cwd: effective,
      worktreePath: params.worktreePath ?? null,
      branchName: params.branchName ?? null,
    },
    persistedExecutionWorkspace: {
      ...base.persistedExecutionWorkspace!,
      strategyType: persistedStrategy,
      cwd: persistedCwd,
      providerType: providerRef ? "git_worktree" : "local_path",
      providerRef,
      branchName: params.persistedBranchName ?? params.branchName ?? null,
      repoUrl: params.repoUrl ?? null,
      baseRef: params.persistedBaseRef ?? null,
      projectWorkspaceId:
        params.persistedProjectWorkspaceId === undefined
          ? "workspace-1"
          : params.persistedProjectWorkspaceId,
    },
  });
}

/* ------------------------------------------------------------------------- */
/* Scratch + bounded Git setup                                               */
/* ------------------------------------------------------------------------- */

function assertScratch(candidatePath: string) {
  if (!scratchRoot || !fixtureRoot) {
    throw new Error("frozen fixture scratch root is not initialized");
  }
  if (!isPathSameOrInside(scratchRoot, candidatePath)) {
    throw new Error(
      `refusing git setup outside the run-owned scratch root: ${candidatePath}`,
    );
  }
}

async function fixtureGit(cwd: string, args: string[]) {
  const subcommand = args[0] ?? "";
  if (!ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`git subcommand not permitted by the fixture allowance: ${subcommand}`);
  }
  assertScratch(cwd);
  gitCallCount += 1;
  if (gitCallCount > GIT_MAX_CALLS) {
    throw new Error(
      `fixture git call ceiling exceeded (${GIT_MAX_CALLS}); refusing further setup git`,
    );
  }
  return execFile("git", args, {
    cwd,
    timeout: GIT_CALL_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
}

async function gitOut(cwd: string, args: string[]) {
  const { stdout } = await fixtureGit(cwd, args);
  return stdout.trim();
}

async function readonlyGit(cwd: string, args: string[]) {
  const subcommand = args[0] ?? "";
  if (!READONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`read-only git subcommand not permitted: ${subcommand}`);
  }
  return execFile("git", args, {
    cwd,
    timeout: GIT_CALL_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
}

async function sha256File(filePath: string) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

/* ------------------------------------------------------------------------- */
/* Git fixture factories (all confined to run-owned scratch)                 */
/* ------------------------------------------------------------------------- */

async function makeRepo(prefix: string, options: { remoteUrl?: string } = {}) {
  const root = await fs.mkdtemp(path.join(fixtureRoot, `${prefix}-`));
  await fixtureGit(root, ["init"]);
  await fixtureGit(root, ["config", "user.email", "fixture@example.com"]);
  await fixtureGit(root, ["config", "user.name", "Frozen Fixture"]);
  await fs.writeFile(path.join(root, "README.md"), "seed\n", "utf8");
  await fixtureGit(root, ["add", "README.md"]);
  await fixtureGit(root, ["commit", "-m", "seed"]);
  if (options.remoteUrl) {
    await fixtureGit(root, ["remote", "add", "origin", options.remoteUrl]);
  }
  const subdirectory = path.join(root, "server");
  await fs.mkdir(subdirectory, { recursive: true });
  return { root, subdirectory };
}

async function makeLinkedWorktree(
  prefix: string,
  options: { branch?: string; remoteUrl?: string } = {},
) {
  const main = await makeRepo(`${prefix}-main`, { remoteUrl: options.remoteUrl });
  const worktreeParent = await fs.mkdtemp(path.join(fixtureRoot, `${prefix}-wt-`));
  const worktreePath = path.join(worktreeParent, "workspace");
  await fixtureGit(main.root, [
    "worktree",
    "add",
    "-b",
    options.branch ?? "fixture-linked",
    worktreePath,
    "HEAD",
  ]);
  const subdirectory = path.join(worktreePath, "server");
  await fs.mkdir(subdirectory, { recursive: true });
  const headSha = await gitOut(worktreePath, ["rev-parse", "HEAD"]);
  return { mainRoot: main.root, worktreePath, subdirectory, headSha };
}

async function makeNestedRepo(prefix: string) {
  const outer = await makeRepo(`${prefix}-outer`);
  const nestedRoot = path.join(outer.subdirectory, "nested");
  await fs.mkdir(nestedRoot, { recursive: true });
  await fixtureGit(nestedRoot, ["init"]);
  await fixtureGit(nestedRoot, ["config", "user.email", "fixture@example.com"]);
  await fixtureGit(nestedRoot, ["config", "user.name", "Frozen Fixture"]);
  await fs.writeFile(path.join(nestedRoot, "README.md"), "nested\n", "utf8");
  await fixtureGit(nestedRoot, ["add", "README.md"]);
  await fixtureGit(nestedRoot, ["commit", "-m", "nested seed"]);
  const nestedServer = path.join(nestedRoot, "server");
  await fs.mkdir(nestedServer, { recursive: true });
  return { outerRoot: outer.root, outerServer: outer.subdirectory, nestedRoot, nestedServer };
}

async function makeDivergentRepo(prefix: string) {
  const repo = await makeRepo(prefix);
  const baseSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
  await fs.writeFile(path.join(repo.root, "README.md"), "ahead\n", "utf8");
  await fixtureGit(repo.root, ["add", "README.md"]);
  await fixtureGit(repo.root, ["commit", "-m", "ahead"]);
  const aheadSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
  await fixtureGit(repo.root, ["reset", "--hard", baseSha]);
  await fixtureGit(repo.root, ["checkout", "-b", "divergent"]);
  await fs.writeFile(path.join(repo.root, "README.md"), "divergent\n", "utf8");
  await fixtureGit(repo.root, ["add", "README.md"]);
  await fixtureGit(repo.root, ["commit", "-m", "divergent"]);
  const divergentSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
  return { root: repo.root, subdirectory: repo.subdirectory, baseSha, aheadSha, divergentSha };
}

/* ------------------------------------------------------------------------- */
/* Classification + records                                                 */
/* ------------------------------------------------------------------------- */

type Classification = "accept" | "refuse";
interface Verdict {
  classification: Classification;
  reason: string | null;
  message: string | null;
}

async function classify(input: WorkspaceValidationInput): Promise<Verdict> {
  try {
    await assertGitSensitiveAdapterWorkspaceValid(input);
    return { classification: "accept", reason: null, message: null };
  } catch (error) {
    const shaped = error as {
      message?: string;
      resultJson?: { workspaceValidation?: { reason?: string } };
    };
    return {
      classification: "refuse",
      reason: shaped?.resultJson?.workspaceValidation?.reason ?? null,
      message: shaped?.message ?? String(error),
    };
  }
}

interface RoleExpectation {
  classification: Classification;
  reason?: string;
}

interface FixtureCase {
  id: string;
  group: string;
  description: string;
  expected: { base: RoleExpectation; candidate: RoleExpectation };
  predictedCandidateVerdict?: Classification;
  predictedBaseVerdict?: Classification;
  gap?: string;
  build: () => Promise<WorkspaceValidationInput>;
}

interface CaseRecord {
  role: Role | null;
  id: string;
  group: string;
  description: string;
  input: Record<string, unknown>;
  expected: RoleExpectation;
  actual: Verdict;
  predictedCandidateVerdict?: Classification;
  predictedBaseVerdict?: Classification;
  verdict: "pass" | "fail" | "setup_error";
  gap?: string;
  error?: string;
}

const caseRecords: CaseRecord[] = [];

function summarizeInput(input: WorkspaceValidationInput): Record<string, unknown> {
  const rel = (value: string | null | undefined) =>
    typeof value === "string" && scratchRoot && isPathSameOrInside(scratchRoot, value)
      ? path.relative(scratchRoot, value)
      : value ?? null;
  const persisted = input.persistedExecutionWorkspace;
  return {
    adapterType: input.adapterType,
    projectWorkspaceId: input.issue?.projectWorkspaceId ?? null,
    effectiveCwd: rel(input.executionWorkspace.cwd),
    strategy: input.executionWorkspace.strategy,
    baseCwd: rel(input.executionWorkspace.baseCwd),
    worktreePath: rel(input.executionWorkspace.worktreePath),
    executionBranch: input.executionWorkspace.branchName ?? null,
    persistedCwd: rel(persisted?.cwd),
    persistedStrategyType: persisted?.strategyType ?? null,
    persistedProviderRef: rel(persisted?.providerRef),
    persistedBranch: persisted?.branchName ?? null,
    persistedBaseRef: persisted?.baseRef ?? null,
    persistedProjectWorkspaceId: persisted?.projectWorkspaceId ?? null,
    resolvedCwd: rel(input.resolvedWorkspace.cwd),
    resolvedRepoUrl: input.resolvedWorkspace.repoUrl ?? null,
    resolvedRepoRef: input.resolvedWorkspace.repoRef ?? null,
    executionTargetKind: (input.executionTarget as { kind?: string } | null)?.kind ?? null,
  };
}

function expectedFor(role: Role, fixtureCase: FixtureCase): RoleExpectation {
  return fixtureCase.expected[role];
}

function recordVerdict(fixtureCase: FixtureCase, record: CaseRecord) {
  caseRecords.push(record);
  console.info(
    `[frozen-validator-independent] ${record.verdict.toUpperCase()} ${fixtureCase.id} ` +
      `role=${record.role ?? "unbound"} expected=${JSON.stringify(record.expected)} ` +
      `actual=${record.actual.classification}:${record.actual.reason ?? "-"}`,
  );
}

/* ------------------------------------------------------------------------- */
/* Case matrix                                                              */
/* ------------------------------------------------------------------------- */

const CASES: FixtureCase[] = [];

function defineCase(fixtureCase: FixtureCase) {
  CASES.push(fixtureCase);
}

/* Group A: descendant discovery and roots. */
defineCase({
  id: "descendant.linked-worktree.success",
  group: "descendant",
  description:
    "A launch cwd that is a genuine descendant of a linked worktree must be accepted on candidate; base cannot discover it.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "accept" },
  },
  build: async () => {
    const worktree = await makeLinkedWorktree("desc-linked");
    return buildInput({
      effectiveCwd: worktree.subdirectory,
      persistedCwd: worktree.subdirectory,
      resolvedCwd: worktree.subdirectory,
      baseCwd: worktree.subdirectory,
      repoRef: worktree.headSha,
    });
  },
});

defineCase({
  id: "descendant.ordinary-repo.success",
  group: "descendant",
  description: "A launch cwd that is a genuine descendant of an ordinary repository must be accepted on candidate.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "accept" },
  },
  build: async () => {
    const repo = await makeRepo("desc-ordinary");
    const headSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
    return buildInput({
      effectiveCwd: repo.subdirectory,
      persistedCwd: repo.subdirectory,
      resolvedCwd: repo.subdirectory,
      baseCwd: repo.subdirectory,
      repoRef: headSha,
    });
  },
});

defineCase({
  id: "root.linked-worktree.success",
  group: "descendant",
  description:
    "A genuine linked-worktree root (direct .git FILE) must be accepted on both roles via the direct-metadata path.",
  expected: {
    base: { classification: "accept" },
    candidate: { classification: "accept" },
  },
  build: async () => {
    const worktree = await makeLinkedWorktree("root-linked");
    return buildInput({
      effectiveCwd: worktree.worktreePath,
      persistedCwd: worktree.worktreePath,
      resolvedCwd: worktree.worktreePath,
      baseCwd: worktree.worktreePath,
      repoRef: worktree.headSha,
    });
  },
});

defineCase({
  id: "root.ordinary.success",
  group: "descendant",
  description: "An ordinary repository root (direct .git DIR) must be accepted on both roles.",
  expected: {
    base: { classification: "accept" },
    candidate: { classification: "accept" },
  },
  build: async () => {
    const repo = await makeRepo("root-ordinary");
    const headSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
    return buildInput({
      effectiveCwd: repo.root,
      persistedCwd: repo.root,
      resolvedCwd: repo.root,
      baseCwd: repo.root,
      repoRef: headSha,
    });
  },
});

defineCase({
  id: "nonrepo.descendant.refuse",
  group: "descendant",
  description: "A real non-repository directory (no enclosing repository) must be refused with missing_git_metadata.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "missing_git_metadata" },
  },
  build: async () => {
    const dir = await fs.mkdtemp(path.join(fixtureRoot, "nonrepo-"));
    return buildInput({
      effectiveCwd: dir,
      persistedCwd: dir,
      resolvedCwd: dir,
      baseCwd: dir,
    });
  },
});

/* Group B: cwd / persisted / provider / branch guards. */
defineCase({
  id: "effective.persisted-cwd-mismatch.refuse",
  group: "cwd-guards",
  description: "Effective cwd differing from the persisted workspace cwd must be refused.",
  expected: {
    base: { classification: "refuse", reason: "persisted_cwd_mismatch" },
    candidate: { classification: "refuse", reason: "persisted_cwd_mismatch" },
  },
  build: async () => {
    const a = await fs.mkdtemp(path.join(fixtureRoot, "cwd-a-"));
    const b = await fs.mkdtemp(path.join(fixtureRoot, "cwd-b-"));
    return buildInput({ effectiveCwd: a, persistedCwd: b, resolvedCwd: a, baseCwd: a });
  },
});

defineCase({
  id: "missing.persisted-workspace.refuse",
  group: "cwd-guards",
  description: "A workspace-expecting issue with no persisted execution workspace must be refused.",
  expected: {
    base: { classification: "refuse", reason: "missing_persisted_execution_workspace" },
    candidate: { classification: "refuse", reason: "missing_persisted_execution_workspace" },
  },
  build: async () => {
    const dir = await fs.mkdtemp(path.join(fixtureRoot, "missing-persisted-"));
    const input = buildInput({ effectiveCwd: dir, resolvedCwd: dir, baseCwd: dir });
    return { ...input, persistedExecutionWorkspace: null };
  },
});

defineCase({
  id: "missing.effective-cwd.refuse",
  group: "cwd-guards",
  description: "A workspace-expecting issue with no effective adapter cwd must be refused.",
  expected: {
    base: { classification: "refuse", reason: "missing_effective_cwd" },
    candidate: { classification: "refuse", reason: "missing_effective_cwd" },
  },
  build: async () => {
    const dir = await fs.mkdtemp(path.join(fixtureRoot, "missing-effective-"));
    const input = buildInput({ effectiveCwd: null, persistedCwd: dir, resolvedCwd: dir, baseCwd: dir });
    return {
      ...input,
      executionWorkspace: { ...input.executionWorkspace, cwd: null },
    };
  },
});

defineCase({
  id: "missing.persisted-workspace-id.refuse",
  group: "cwd-guards",
  description: "A persisted workspace lacking its project workspace id must be refused.",
  expected: {
    base: { classification: "refuse", reason: "persisted_workspace_missing_project_workspace_id" },
    candidate: { classification: "refuse", reason: "persisted_workspace_missing_project_workspace_id" },
  },
  build: async () => {
    const dir = await fs.mkdtemp(path.join(fixtureRoot, "missing-pw-id-"));
    return buildInput({
      effectiveCwd: dir,
      persistedCwd: dir,
      resolvedCwd: dir,
      baseCwd: dir,
      persistedProjectWorkspaceId: null,
    });
  },
});

defineCase({
  id: "project-workspace.mismatch.refuse",
  group: "cwd-guards",
  description: "A persisted workspace bound to a different project workspace must be refused.",
  expected: {
    base: { classification: "refuse", reason: "project_workspace_mismatch" },
    candidate: { classification: "refuse", reason: "project_workspace_mismatch" },
  },
  build: async () => {
    const dir = await fs.mkdtemp(path.join(fixtureRoot, "pw-mismatch-"));
    return buildInput({
      effectiveCwd: dir,
      persistedCwd: dir,
      resolvedCwd: dir,
      baseCwd: dir,
      persistedProjectWorkspaceId: "workspace-other",
    });
  },
});

defineCase({
  id: "fallback.agent-home.refuse",
  group: "cwd-guards",
  description: "A workspace-expecting issue resolving to the agent fallback cwd must be refused.",
  expected: {
    base: { classification: "refuse", reason: "fallback_agent_home_cwd" },
    candidate: { classification: "refuse", reason: "fallback_agent_home_cwd" },
  },
  build: async () => {
    const fallback = resolveDefaultAgentWorkspaceDir("agent-1");
    return buildInput({
      effectiveCwd: fallback,
      persistedCwd: fallback,
      resolvedCwd: fallback,
      baseCwd: fallback,
    });
  },
});

defineCase({
  id: "provider-ref.descendant.refuse",
  group: "cwd-guards",
  description:
    "A git_worktree workspace whose providerRef is the worktree root but whose cwd is a descendant must be refused by the provider guard before any descendant acceptance.",
  expected: {
    base: { classification: "refuse", reason: "git_worktree_provider_ref_mismatch" },
    candidate: { classification: "refuse", reason: "git_worktree_provider_ref_mismatch" },
  },
  build: async () => {
    const worktree = await makeLinkedWorktree("provider-guard");
    return buildInput({
      effectiveCwd: worktree.subdirectory,
      persistedCwd: worktree.subdirectory,
      resolvedCwd: worktree.subdirectory,
      baseCwd: worktree.subdirectory,
      strategy: "git_worktree",
      persistedStrategy: "git_worktree",
      worktreePath: worktree.worktreePath,
      providerRef: worktree.worktreePath,
    });
  },
});

defineCase({
  id: "branch.descendant.refuse",
  group: "cwd-guards",
  description:
    "A git_worktree descendant where providerRef and persisted cwd both equal the descendant and the checked-out branch differs from the recorded branch must refuse.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_worktree_branch_mismatch" },
  },
  build: async () => {
    const worktree = await makeLinkedWorktree("branch-guard", { branch: "THE-567-recorded" });
    await fixtureGit(worktree.subdirectory, ["checkout", "-b", "THE-567-actual"]);
    return buildInput({
      effectiveCwd: worktree.subdirectory,
      persistedCwd: worktree.subdirectory,
      resolvedCwd: worktree.subdirectory,
      baseCwd: worktree.subdirectory,
      strategy: "git_worktree",
      persistedStrategy: "git_worktree",
      worktreePath: worktree.subdirectory,
      providerRef: worktree.subdirectory,
      branchName: "THE-567-recorded",
      persistedBranchName: "THE-567-recorded",
    });
  },
});

/* Group C: authority / origin / nesting / symlinks. */
defineCase({
  id: "authority.root-mismatch.refuse",
  group: "authority",
  description:
    "Two distinct repositories A and B: effective=persisted=B/server, resolved/base=A. The recorded authoritative root is A, so acceptance against B is a self-match defect.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  predictedCandidateVerdict: "accept",
  gap: "candidate expectedRoots includes the persisted cwd, so B self-matches; recorded as predicted red.",
  build: async () => {
    const repoA = await makeRepo("authority-a");
    const repoB = await makeRepo("authority-b");
    const aHead = await gitOut(repoA.root, ["rev-parse", "HEAD"]);
    return buildInput({
      effectiveCwd: repoB.subdirectory,
      persistedCwd: repoB.subdirectory,
      resolvedCwd: repoA.root,
      baseCwd: repoA.root,
      repoRef: aHead,
    });
  },
});

defineCase({
  id: "origin.mismatch.refuse",
  group: "authority",
  description: "A descendant whose containing repository origin differs from the declared remote must refuse.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  build: async () => {
    const repo = await makeRepo("origin-mismatch", {
      remoteUrl: "https://github.com/example/actual.git",
    });
    const headSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
    return buildInput({
      effectiveCwd: repo.subdirectory,
      persistedCwd: repo.subdirectory,
      resolvedCwd: repo.subdirectory,
      baseCwd: repo.subdirectory,
      repoUrl: "https://github.com/example/expected.git",
      repoRef: headSha,
    });
  },
});

defineCase({
  id: "origin.missing.refuse",
  group: "authority",
  description:
    "A valid descendant that declares a remote repo URL but whose repository has no origin must refuse; the candidate only checks a truthy origin.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  predictedCandidateVerdict: "accept",
  gap: "candidate skips the origin comparison when origin is absent; recorded as predicted red.",
  build: async () => {
    const repo = await makeRepo("origin-missing");
    const headSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
    return buildInput({
      effectiveCwd: repo.subdirectory,
      persistedCwd: repo.subdirectory,
      resolvedCwd: repo.subdirectory,
      baseCwd: repo.subdirectory,
      repoUrl: "https://github.com/example/missing-origin.git",
      repoRef: headSha,
    });
  },
});

defineCase({
  id: "origin.match.normalization.success",
  group: "authority",
  description:
    "A descendant whose origin is the scp form of the declared HTTPS remote must normalize to a match and be accepted (candidate).",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "accept" },
  },
  build: async () => {
    const repo = await makeRepo("origin-match", {
      remoteUrl: "git@github.com:Example/Repo.git",
    });
    const headSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
    return buildInput({
      effectiveCwd: repo.subdirectory,
      persistedCwd: repo.subdirectory,
      resolvedCwd: repo.subdirectory,
      baseCwd: repo.subdirectory,
      repoUrl: "https://github.com/example/repo",
      repoRef: headSha,
    });
  },
});

defineCase({
  id: "nested.repo.refuse",
  group: "authority",
  description:
    "A nested repository inside the authoritative outer repository: effective/persisted=outer/nested/server with resolved/base=outer must refuse against the outer authority.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  predictedCandidateVerdict: "accept",
  gap: "candidate nearest root nested self-matches the persisted cwd root; recorded as predicted red.",
  build: async () => {
    const nested = await makeNestedRepo("nested");
    const outerHead = await gitOut(nested.outerRoot, ["rev-parse", "HEAD"]);
    return buildInput({
      effectiveCwd: nested.nestedServer,
      persistedCwd: nested.nestedServer,
      resolvedCwd: nested.outerRoot,
      baseCwd: nested.outerRoot,
      repoRef: outerHead,
    });
  },
});

defineCase({
  id: "nested.direct-root.refuse",
  group: "authority",
  description:
    "A nested repository root carrying its own direct .git metadata must not bypass the authoritative outer root.",
  expected: {
    base: { classification: "refuse", reason: "git_metadata_wrong_repository" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  predictedCandidateVerdict: "accept",
  predictedBaseVerdict: "accept",
  gap: "direct .git metadata short-circuits root/origin/pin checks on both roles; recorded as predicted red.",
  build: async () => {
    const nested = await makeNestedRepo("nested-direct");
    return buildInput({
      effectiveCwd: nested.nestedRoot,
      persistedCwd: nested.nestedRoot,
      resolvedCwd: nested.outerRoot,
      baseCwd: nested.outerRoot,
    });
  },
});

defineCase({
  id: "symlink.escaping.refuse",
  group: "authority",
  description:
    "A symlink inside the authoritative outer repository pointing at a different repository must refuse.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  predictedCandidateVerdict: "accept",
  gap: "candidate canonical target root can self-match the persisted cwd root; recorded as predicted red.",
  build: async () => {
    const outer = await makeRepo("symlink-outer");
    const other = await makeRepo("symlink-other");
    const link = path.join(outer.root, "link");
    await fs.symlink(other.subdirectory, link, "dir");
    const outerHead = await gitOut(outer.root, ["rev-parse", "HEAD"]);
    return buildInput({
      effectiveCwd: link,
      persistedCwd: link,
      resolvedCwd: outer.root,
      baseCwd: outer.root,
      repoRef: outerHead,
    });
  },
});

defineCase({
  id: "symlink.in-root.success",
  group: "authority",
  description:
    "A symlink that stays inside the expected repository must be accepted when the exact cwd contract is satisfied (candidate).",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "accept" },
  },
  build: async () => {
    const outer = await makeRepo("symlink-inroot");
    const link = path.join(outer.root, "link");
    await fs.symlink(outer.subdirectory, link, "dir");
    const headSha = await gitOut(outer.root, ["rev-parse", "HEAD"]);
    return buildInput({
      effectiveCwd: link,
      persistedCwd: link,
      resolvedCwd: outer.root,
      baseCwd: outer.root,
      repoRef: headSha,
    });
  },
});

/* Group D: pin semantics. */
defineCase({
  id: "pin.divergent-nonancestor.refuse",
  group: "pins",
  description: "A descendant whose HEAD and declared pin are on divergent branches must refuse.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_pin" },
  },
  build: async () => {
    const repo = await makeDivergentRepo("pin-divergent");
    return buildInput({
      effectiveCwd: repo.subdirectory,
      persistedCwd: repo.subdirectory,
      resolvedCwd: repo.subdirectory,
      baseCwd: repo.subdirectory,
      repoRef: repo.aheadSha,
    });
  },
});

defineCase({
  id: "pin.unresolved-nonref.refuse",
  group: "pins",
  description:
    "A valid descendant declaring a pin that does not resolve locally must refuse; the candidate skips refusal when the pin cannot resolve.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_pin" },
  },
  predictedCandidateVerdict: "accept",
  gap: "candidate skips the pin comparison when pinSha is null; recorded as predicted red.",
  build: async () => {
    const repo = await makeRepo("pin-unresolved");
    return buildInput({
      effectiveCwd: repo.subdirectory,
      persistedCwd: repo.subdirectory,
      resolvedCwd: repo.subdirectory,
      baseCwd: repo.subdirectory,
      persistedBaseRef: "refs/heads/does-not-exist",
    });
  },
});

defineCase({
  id: "pin.exact-ancestor.refuse",
  group: "pins",
  description:
    "Exact immutable-pin contract: HEAD ahead of the declared pin (pin is an ancestor) must refuse, with no ancestor waiver.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_pin" },
  },
  predictedCandidateVerdict: "accept",
  gap: "candidate accepts an ancestor pin as an allowed branch base; recorded as predicted red for the exact-pin contract.",
  build: async () => {
    const repo = await makeRepo("pin-ancestor");
    const firstSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(repo.root, "README.md"), "second\n", "utf8");
    await fixtureGit(repo.root, ["add", "README.md"]);
    await fixtureGit(repo.root, ["commit", "-m", "second"]);
    return buildInput({
      effectiveCwd: repo.subdirectory,
      persistedCwd: repo.subdirectory,
      resolvedCwd: repo.subdirectory,
      baseCwd: repo.subdirectory,
      repoRef: firstSha,
    });
  },
});

defineCase({
  id: "pin.head-equals.success",
  group: "pins",
  description: "A descendant whose HEAD exactly equals the declared pin must be accepted (candidate).",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "accept" },
  },
  build: async () => {
    const repo = await makeRepo("pin-equal");
    const headSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
    return buildInput({
      effectiveCwd: repo.subdirectory,
      persistedCwd: repo.subdirectory,
      resolvedCwd: repo.subdirectory,
      baseCwd: repo.subdirectory,
      repoRef: headSha,
    });
  },
});

defineCase({
  id: "pin.behind.refuse",
  group: "pins",
  description: "A descendant whose HEAD is behind the declared pin must refuse.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_pin" },
  },
  build: async () => {
    const repo = await makeRepo("pin-behind");
    const firstSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(repo.root, "README.md"), "second\n", "utf8");
    await fixtureGit(repo.root, ["add", "README.md"]);
    await fixtureGit(repo.root, ["commit", "-m", "second"]);
    const secondSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
    await fixtureGit(repo.root, ["reset", "--hard", firstSha]);
    return buildInput({
      effectiveCwd: repo.subdirectory,
      persistedCwd: repo.subdirectory,
      resolvedCwd: repo.subdirectory,
      baseCwd: repo.subdirectory,
      repoRef: secondSha,
    });
  },
});

/* Group E: direct .git bypass / malformed metadata. */
defineCase({
  id: "direct.ordinary-root.wrong-pin.refuse",
  group: "direct-git",
  description:
    "An ordinary repository root carrying direct .git metadata with a wrong pin must not bypass the pin contract.",
  expected: {
    base: { classification: "refuse", reason: "git_metadata_wrong_pin" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_pin" },
  },
  predictedCandidateVerdict: "accept",
  predictedBaseVerdict: "accept",
  gap: "direct .git metadata short-circuits pin checks on both roles; recorded as predicted red.",
  build: async () => {
    const repo = await makeRepo("direct-wrong-pin");
    const headSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(repo.root, "README.md"), "second\n", "utf8");
    await fixtureGit(repo.root, ["add", "README.md"]);
    await fixtureGit(repo.root, ["commit", "-m", "second"]);
    const wrongPinSha = await gitOut(repo.root, ["rev-parse", "HEAD"]);
    await fixtureGit(repo.root, ["reset", "--hard", headSha]);
    return buildInput({
      effectiveCwd: repo.root,
      persistedCwd: repo.root,
      resolvedCwd: repo.root,
      baseCwd: repo.root,
      repoRef: wrongPinSha,
    });
  },
});

defineCase({
  id: "direct.linked-root.wrong-origin.refuse",
  group: "direct-git",
  description:
    "A linked-worktree root carrying direct .git metadata with a mismatched declared remote must not bypass the origin contract.",
  expected: {
    base: { classification: "refuse", reason: "git_metadata_wrong_repository" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  predictedCandidateVerdict: "accept",
  predictedBaseVerdict: "accept",
  gap: "direct .git metadata short-circuits origin checks on both roles; recorded as predicted red.",
  build: async () => {
    const worktree = await makeLinkedWorktree("direct-linked-origin", {
      remoteUrl: "https://github.com/example/actual.git",
    });
    return buildInput({
      effectiveCwd: worktree.worktreePath,
      persistedCwd: worktree.worktreePath,
      resolvedCwd: worktree.worktreePath,
      baseCwd: worktree.worktreePath,
      repoUrl: "https://github.com/example/expected.git",
      repoRef: worktree.headSha,
    });
  },
});

defineCase({
  id: "direct.fake-empty-git-dir.refuse",
  group: "direct-git",
  description:
    "A non-repository directory containing an empty .git DIRECTORY must not be accepted as a git workspace.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "missing_git_metadata" },
  },
  predictedCandidateVerdict: "accept",
  predictedBaseVerdict: "accept",
  gap: "direct .git lstat predicate accepts an empty .git directory on both roles; recorded as predicted red.",
  build: async () => {
    const dir = await fs.mkdtemp(path.join(fixtureRoot, "fake-git-dir-"));
    await fs.mkdir(path.join(dir, ".git"), { recursive: true });
    return buildInput({ effectiveCwd: dir, persistedCwd: dir, resolvedCwd: dir, baseCwd: dir });
  },
});

defineCase({
  id: "direct.malformed-gitdir-file.refuse",
  group: "direct-git",
  description:
    "A non-repository directory containing a malformed .git FILE must not be accepted as a git workspace.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "missing_git_metadata" },
  },
  predictedCandidateVerdict: "accept",
  predictedBaseVerdict: "accept",
  gap: "direct .git file predicate accepts a malformed gitdir pointer on both roles; recorded as predicted red.",
  build: async () => {
    const dir = await fs.mkdtemp(path.join(fixtureRoot, "malformed-gitdir-"));
    await fs.writeFile(path.join(dir, ".git"), "gitdir: /nonexistent/paperclip/frozen\n", "utf8");
    return buildInput({ effectiveCwd: dir, persistedCwd: dir, resolvedCwd: dir, baseCwd: dir });
  },
});

/* ------------------------------------------------------------------------- */
/* Identity guard + suite                                                    */
/* ------------------------------------------------------------------------- */

async function assertFrozenSourceIdentity() {
  if (ROLE !== "base" && ROLE !== "candidate") {
    throw new Error(
      `PC_FROZEN_VALIDATOR_ROLE must be "base" or "candidate"; received ${JSON.stringify(ROLE)}`,
    );
  }
  const pin = PINNED_SOURCES[ROLE as Role];
  if (FROZEN_REVISION && FROZEN_REVISION !== pin.revision) {
    throw new Error(
      `PC_FROZEN_VALIDATOR_REVISION ${FROZEN_REVISION} does not match pinned ${ROLE} revision ${pin.revision}`,
    );
  }
  if (!FORBIDDEN_ROOT) {
    throw new Error(
      "PC_FROZEN_VALIDATOR_FORBIDDEN_ROOT is required so the fixture cannot silently run against the authoring checkout",
    );
  }
  if (!SCRATCH_ROOT_RAW) {
    throw new Error(
      "PC_FROZEN_VALIDATOR_SCRATCH (or PAPERCLIP_RUN_SCRATCH_DIR) is required for run-owned scratch",
    );
  }

  const selfTop = (await readonlyGit(FIXTURE_DIR, ["rev-parse", "--show-toplevel"])).stdout.trim();
  const selfRoot = path.resolve(selfTop);
  const root = path.resolve(FROZEN_ROOT);
  if (selfRoot !== root) {
    throw new Error(
      `fixture is running inside ${selfRoot} but PC_FROZEN_VALIDATOR_ROOT is ${root}; refusing cross-root subject load`,
    );
  }
  const forbidden = path.resolve(FORBIDDEN_ROOT);
  if (isPathSameOrInside(forbidden, root)) {
    throw new Error(
      `refusing to treat the authoring/forbidden checkout ${forbidden} as the frozen ${ROLE} source`,
    );
  }

  const headRevision = (
    await readonlyGit(selfRoot, ["rev-parse", "HEAD"])
  ).stdout.trim();
  if (headRevision !== pin.revision) {
    throw new Error(
      `frozen ${ROLE} HEAD ${headRevision} does not match pinned revision ${pin.revision}`,
    );
  }

  const heartbeatPath = path.join(selfRoot, HEARTBEAT_RELATIVE_PATH);
  const blob = (
    await readonlyGit(selfRoot, ["hash-object", HEARTBEAT_RELATIVE_PATH])
  ).stdout.trim();
  if (blob !== pin.heartbeatBlob) {
    throw new Error(
      `frozen ${ROLE} ${HEARTBEAT_RELATIVE_PATH} blob ${blob} does not match pinned ${pin.heartbeatBlob}`,
    );
  }
  const sha256 = await sha256File(heartbeatPath);
  if (sha256 !== pin.heartbeatSha256) {
    throw new Error(
      `frozen ${ROLE} ${HEARTBEAT_RELATIVE_PATH} SHA256 ${sha256} does not match pinned ${pin.heartbeatSha256}`,
    );
  }

  const realTmp = await fs.realpath(os.tmpdir()).catch(() => os.tmpdir());
  if (!isPathSameOrInside(scratchRoot, realTmp)) {
    throw new Error(
      `os.tmpdir() ${realTmp} is not inside the run-owned scratch root ${scratchRoot}; refusing unbounded fixture writes`,
    );
  }

  console.info(
    `[frozen-validator-independent] bound role=${ROLE} root=${selfRoot} ` +
      `HEAD=${headRevision} heartbeat_blob=${blob} heartbeat_sha256=${sha256}`,
  );
}

frozenDescribe("frozen-validator-independent", () => {
  beforeAll(async () => {
    scratchRoot = path.resolve(SCRATCH_ROOT_RAW);
    await fs.mkdir(scratchRoot, { recursive: true });
    fixtureRoot = await fs.mkdtemp(
      path.join(scratchRoot, `frozen-validator-independent-${ROLE}-`),
    );
    await assertFrozenSourceIdentity();
  }, 60_000);

  afterAll(async () => {
    if (caseRecords.length > 0) {
      const logPath = CASE_LOG_RAW
        ? path.resolve(CASE_LOG_RAW)
        : path.join(scratchRoot, `frozen-validator-independent-${ROLE || "unbound"}-cases.jsonl`);
      const payload = caseRecords.map((record) => JSON.stringify(record)).join("\n") + "\n";
      await fs.writeFile(logPath, payload, "utf8");
      console.info(
        `[frozen-validator-independent] wrote ${caseRecords.length} case records to ${logPath} ` +
          `(git setup calls=${gitCallCount})`,
      );
    }
    if (fixtureRoot) {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 60_000);

  for (const fixtureCase of CASES) {
    it(
      fixtureCase.id,
      async () => {
        const role = ROLE as Role;
        const expected = expectedFor(role, fixtureCase);
        let input: WorkspaceValidationInput;
        try {
          input = await fixtureCase.build();
        } catch (error) {
          recordVerdict(fixtureCase, {
            role,
            id: fixtureCase.id,
            group: fixtureCase.group,
            description: fixtureCase.description,
            input: {},
            expected,
            actual: { classification: "refuse", reason: null, message: null },
            predictedCandidateVerdict: fixtureCase.predictedCandidateVerdict,
            predictedBaseVerdict: fixtureCase.predictedBaseVerdict,
            verdict: "setup_error",
            gap: fixtureCase.gap,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }

        const actual = await classify(input);
        const passed =
          actual.classification === expected.classification &&
          (expected.reason === undefined || actual.reason === expected.reason);

        recordVerdict(fixtureCase, {
          role,
          id: fixtureCase.id,
          group: fixtureCase.group,
          description: fixtureCase.description,
          input: summarizeInput(input),
          expected,
          actual,
          predictedCandidateVerdict: fixtureCase.predictedCandidateVerdict,
          predictedBaseVerdict: fixtureCase.predictedBaseVerdict,
          verdict: passed ? "pass" : "fail",
          gap: fixtureCase.gap,
        });

        expect({ classification: actual.classification, reason: actual.reason }).toEqual(
          expected.reason === undefined
            ? { classification: expected.classification, reason: null }
            : { classification: expected.classification, reason: expected.reason },
        );
      },
      60_000,
    );
  }
});
