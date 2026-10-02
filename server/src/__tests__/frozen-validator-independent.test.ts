/**
 * Frozen independent validator fixture (THE-567 corrected static publication).
 *
 * This file has NO top-level product import. The subject validator and the
 * default-agent-workspace resolver are loaded only AFTER the host guards pass,
 * through the host loader's Vite SSR surface, from the exact separately pinned
 * candidate or base checkout. The host's own heartbeat is never loaded.
 *
 * Static bytes only. This file proves no candidate acceptance on its own and is
 * not executed by the authoring run or its ordinary suite (the host Vitest
 * config has a single literal include and this file is inert without the fixed
 * frozen environment). Security expectations are the frozen contract and are
 * never relaxed to make a candidate defect pass.
 *
 * Corrections incorporated (see fixture-review revision 7f08a0ca):
 *   1 guard-before-import via loader; 2 distinct host/subject identity;
 *   3 scratch validation before writes; 4 contained output + exact Git argv;
 *   5 separate descendant root refusal and genuine linked-root branch drift
 *   with recorded underlying reasonCode; 6 root/nested/escape cases omit pins
 *   and record observed roots/HEAD; 7 fixed ceilings and supervised lifecycle.
 */

import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getValidatedRoleContext,
  loadBoundSubject,
} from "./frozen-validator-loader.mjs";

const execFile = promisify(execFileCallback);

interface FixtureResolvedWorkspace {
  cwd: string | null;
  source: string;
  projectId: string | null;
  workspaceId: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  workspaceHints: unknown[];
  warnings: string[];
  baseCwdFallback: boolean;
  materializationFailures: unknown[];
}

interface FixtureWorkspaceInput {
  adapterType: string;
  agentId: string;
  issue: {
    id: string;
    identifier: string;
    projectId: string | null;
    projectWorkspaceId: string | null;
  } | null;
  resolvedWorkspace: FixtureResolvedWorkspace;
  executionWorkspace: {
    baseCwd: string | null;
    source: string;
    projectId: string | null;
    workspaceId: string | null;
    repoUrl: string | null;
    repoRef: string | null;
    strategy: "project_primary" | "git_worktree";
    cwd: string | null;
    branchName: string | null;
    worktreePath: string | null;
    warnings: string[];
    created: boolean;
    baseRefSha: string | null;
  };
  persistedExecutionWorkspace: {
    id: string;
    companyId: string;
    projectId: string | null;
    projectWorkspaceId: string | null;
    sourceIssueId: string;
    mode: string;
    strategyType: "project_primary" | "git_worktree";
    name: string;
    status: string;
    cwd: string | null;
    repoUrl: string | null;
    baseRef: string | null;
    branchName: string | null;
    providerType: string;
    providerRef: string | null;
    derivedFromExecutionWorkspaceId: string | null;
    lastUsedAt: Date;
    openedAt: Date;
    closedAt: Date | null;
    cleanupEligibleAt: Date | null;
    cleanupReason: string | null;
    config: unknown;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  executionTarget: { kind: string } | null;
}

type BoundSubject = Awaited<ReturnType<typeof loadBoundSubject>>;

const context = getValidatedRoleContext();
let bound: BoundSubject;
const setupGuardDenials: string[] = [];

/* ------------------------------------------------------------------------- */
/* Strict Git setup: exact token arrays only, under the owned repos root.    */
/* The preload's exact-token policy is the admission point; the fixture never */
/* joins tokens or builds shell strings.                                      */
/* ------------------------------------------------------------------------- */

function assertOwned(cwd: string) {
  const repos = context.dirs.repos;
  const rel = path.relative(repos, path.resolve(cwd));
  if (!(rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)))) {
    throw new Error(`fixture git cwd escapes the owned repos root: ${cwd}`);
  }
}

async function fixtureGit(cwd: string, args: string[]) {
  assertOwned(cwd);
  await execFile("git", args, { cwd });
}

async function gitOut(cwd: string, args: string[]) {
  assertOwned(cwd);
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

async function observe(cwd: string) {
  const result: Record<string, unknown> = { observed: null, head: null };
  try {
    result.observed = await gitOut(cwd, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    setupGuardDenials.push(`observe:toplevel:${asCode(error)}`);
  }
  try {
    result.head = await gitOut(cwd, ["rev-parse", "HEAD"]);
  } catch (error) {
    setupGuardDenials.push(`observe:head:${asCode(error)}`);
  }
  return result;
}

function asCode(error: unknown) {
  return (error as { code?: string } | null)?.code ?? "error";
}

/* ------------------------------------------------------------------------- */
/* Repo factories (all under the owned repos root)                           */
/* ------------------------------------------------------------------------- */

async function makeRepo(prefix: string, options: { remoteUrl?: string } = {}) {
  const root = await fs.mkdtemp(path.join(context.dirs.repos, `${prefix}-`));
  await fixtureGit(root, ["init"]);
  await fixtureGit(root, ["config", "user.email", "fixture@example.com"]);
  await fixtureGit(root, ["config", "user.name", "Frozen-Fixture"]);
  await fs.writeFile(path.join(root, "README.md"), "seed\n", "utf8");
  await fixtureGit(root, ["add", "README.md"]);
  await fixtureGit(root, ["commit", "-m", "seed"]);
  if (options.remoteUrl) await fixtureGit(root, ["remote", "add", "origin", options.remoteUrl]);
  const subdirectory = path.join(root, "server");
  await fs.mkdir(subdirectory, { recursive: true });
  return { root, subdirectory };
}

async function makeLinkedWorktree(prefix: string, options: { branch?: string; remoteUrl?: string } = {}) {
  const main = await makeRepo(`${prefix}-main`, { remoteUrl: options.remoteUrl });
  const worktreeParent = await fs.mkdtemp(path.join(context.dirs.repos, `${prefix}-wt-`));
  const worktreePath = path.join(worktreeParent, "workspace");
  await fixtureGit(main.root, ["worktree", "add", "-b", options.branch ?? "fixture-linked", worktreePath, "HEAD"]);
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
  await fixtureGit(nestedRoot, ["config", "user.name", "Frozen-Fixture"]);
  await fs.writeFile(path.join(nestedRoot, "README.md"), "nested\n", "utf8");
  await fixtureGit(nestedRoot, ["add", "README.md"]);
  await fixtureGit(nestedRoot, ["commit", "-m", "nested"]);
  const nestedServer = path.join(nestedRoot, "server");
  await fs.mkdir(nestedServer, { recursive: true });
  return { outerRoot: outer.root, nestedRoot, nestedServer };
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
  return { root: repo.root, subdirectory: repo.subdirectory, baseSha, aheadSha };
}

/* ------------------------------------------------------------------------- */
/* Input builders                                                           */
/* ------------------------------------------------------------------------- */

function buildResolvedWorkspace(overrides: Partial<FixtureResolvedWorkspace> = {}): FixtureResolvedWorkspace {
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

function buildWorkspaceValidationInput(overrides: Partial<FixtureWorkspaceInput> = {}): FixtureWorkspaceInput {
  return {
    adapterType: "codex_local",
    agentId: "agent-1",
    issue: { id: "issue-1", identifier: "THE-560", projectId: "project-1", projectWorkspaceId: "workspace-1" },
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
  persistedProjectWorkspaceId?: string | null;
}

function buildInput(params: InputParams): FixtureWorkspaceInput {
  const base = buildWorkspaceValidationInput();
  const effective = params.effectiveCwd;
  const providerRef = params.providerRef ?? null;
  return buildWorkspaceValidationInput({
    resolvedWorkspace: buildResolvedWorkspace({
      cwd: params.resolvedCwd ?? effective,
      repoUrl: params.repoUrl ?? null,
      repoRef: params.repoRef ?? null,
    }),
    executionWorkspace: {
      ...base.executionWorkspace,
      strategy: params.strategy ?? "project_primary",
      baseCwd: params.baseCwd ?? effective,
      cwd: effective,
      worktreePath: params.worktreePath ?? null,
      branchName: params.branchName ?? null,
    },
    persistedExecutionWorkspace: {
      ...base.persistedExecutionWorkspace!,
      strategyType: params.persistedStrategy ?? "project_primary",
      cwd: params.persistedCwd ?? effective,
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
/* Classification and records                                               */
/* ------------------------------------------------------------------------- */

type Classification = "accept" | "refuse";
interface Verdict {
  classification: Classification;
  reason: string | null;
  branchReasonCode: string | null;
  message: string | null;
}

async function classify(input: FixtureWorkspaceInput): Promise<Verdict> {
  try {
    await bound.assertGitSensitiveAdapterWorkspaceValid(input as never);
    return { classification: "accept", reason: null, branchReasonCode: null, message: null };
  } catch (error) {
    const shaped = error as {
      message?: string;
      resultJson?: {
        workspaceValidation?: {
          reason?: string;
          managedGitWorktreeBranch?: { reasonCode?: string };
        };
      };
    };
    const validation = shaped?.resultJson?.workspaceValidation;
    return {
      classification: "refuse",
      reason: validation?.reason ?? null,
      branchReasonCode: validation?.managedGitWorktreeBranch?.reasonCode ?? null,
      message: redactString(shaped?.message ?? String(error)),
    };
  }
}

interface RoleExpectation {
  classification: Classification;
  reason?: string;
  branchReasonCode?: string;
}

interface FixtureCase {
  id: string;
  group: string;
  description: string;
  expected: { base: RoleExpectation; candidate: RoleExpectation };
  predictedCandidateVerdict?: Classification;
  predictedBaseVerdict?: Classification;
  gap?: string;
  build: () => Promise<FixtureWorkspaceInput>;
}

interface CaseRecord {
  role: string;
  id: string;
  group: string;
  description: string;
  input: Record<string, unknown>;
  observed: Record<string, unknown>;
  expected: RoleExpectation;
  actual: Verdict;
  failureKind?: FailureKind;
  expectedView?: Record<string, unknown>;
  actualView?: Record<string, unknown>;
  guardDenials?: string[];
  predictedCandidateVerdict?: Classification;
  predictedBaseVerdict?: Classification;
  verdict: "pass" | "fail" | "setup_error";
  gap?: string;
  error?: string;
}

type FailureKind =
  | "classification_mismatch"
  | "unexpected_wrapper_reason"
  | "missing_wrapper_reason"
  | "wrapper_reason_mismatch"
  | "branch_reason_mismatch"
  | null;

/**
 * Contract F: one matcher for both the recorded verdict and the assertion.
 * Wrapper reason is always explicit (accept requires null; refuse requires the
 * explicit reason). branchReasonCode is compared only when the expectation owns
 * the property.
 */
function matchVerdict(actual: Verdict, expected: RoleExpectation) {
  let failureKind: FailureKind = null;
  if (actual.classification !== expected.classification) {
    failureKind = "classification_mismatch";
  } else if (expected.classification === "accept") {
    if (actual.reason !== null) failureKind = "unexpected_wrapper_reason";
  } else if (actual.reason === null) {
    failureKind = "missing_wrapper_reason";
  } else if (actual.reason !== expected.reason) {
    failureKind = "wrapper_reason_mismatch";
  }
  const ownsBranch = Object.prototype.hasOwnProperty.call(expected, "branchReasonCode");
  if (failureKind === null && ownsBranch && actual.branchReasonCode !== (expected.branchReasonCode ?? null)) {
    failureKind = "branch_reason_mismatch";
  }
  return {
    passed: failureKind === null,
    failureKind,
    expectedView: {
      classification: expected.classification,
      reason: expected.reason ?? null,
      branchReasonCode: ownsBranch ? expected.branchReasonCode ?? null : "<omitted>",
    },
    actualView: {
      classification: actual.classification,
      reason: actual.reason,
      branchReasonCode: actual.branchReasonCode,
    },
  };
}

function redactString(value: string): string {
  let output = value;
  const roots = [context.scratch, context.hostRoot, ...Object.values(context.manifest.roles ?? {}).map((role) => role.cwd)];
  for (const root of roots) {
    if (typeof root === "string" && root.length > 0) output = output.split(root).join("<redacted>");
  }
  return output;
}

function redact(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) output[key] = redact(entry);
    return output;
  }
  return value;
}

const caseRecords: CaseRecord[] = [];

function rel(value: string | null | undefined) {
  if (typeof value !== "string") return value ?? null;
  const relative = path.relative(context.scratch, value);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
    ? relative
    : "<outside-scratch>";
}

function summarizeInput(input: FixtureWorkspaceInput): Record<string, unknown> {
  const persisted = input.persistedExecutionWorkspace;
  return {
    effectiveCwd: rel(input.executionWorkspace.cwd),
    strategy: input.executionWorkspace.strategy,
    baseCwd: rel(input.executionWorkspace.baseCwd),
    worktreePath: rel(input.executionWorkspace.worktreePath),
    persistedCwd: rel(persisted?.cwd),
    persistedStrategyType: persisted?.strategyType ?? null,
    persistedProviderRef: rel(persisted?.providerRef),
    persistedBranch: persisted?.branchName ?? null,
    persistedBaseRef: persisted?.baseRef ?? null,
    persistedProjectWorkspaceId: persisted?.projectWorkspaceId ?? null,
    resolvedCwd: rel(input.resolvedWorkspace.cwd),
    resolvedRepoUrl: input.resolvedWorkspace.repoUrl ?? null,
    resolvedRepoRef: input.resolvedWorkspace.repoRef ?? null,
  };
}

function pushRecord(record: CaseRecord) {
  const safe: CaseRecord = {
    ...record,
    description: redactString(record.description),
    input: redact(record.input) as Record<string, unknown>,
    observed: redact(record.observed) as Record<string, unknown>,
    error: record.error ? redactString(record.error) : record.error,
    guardDenials: (record.guardDenials ?? []).map(redactString),
  };
  const row = JSON.stringify(safe);
  if (Buffer.byteLength(row) > context.ceilings.caseLogRowMaxBytes) {
    throw new Error(`case log row exceeds ${context.ceilings.caseLogRowMaxBytes} bytes: ${record.id}`);
  }
  caseRecords.push(safe);
}

/* ------------------------------------------------------------------------- */
/* Case matrix                                                              */
/* ------------------------------------------------------------------------- */

const CASES: FixtureCase[] = [];
function defineCase(fixtureCase: FixtureCase) {
  CASES.push(fixtureCase);
}

defineCase({
  id: "descendant.linked-worktree.success",
  group: "descendant",
  description: "Genuine linked-worktree descendant accepted on candidate; base cannot discover it.",
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
  description: "Genuine ordinary-repo descendant accepted on candidate.",
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
  description: "Genuine linked-worktree root (direct .git FILE) accepted on both roles.",
  expected: { base: { classification: "accept" }, candidate: { classification: "accept" } },
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
  description: "Ordinary repository root (direct .git DIR) accepted on both roles.",
  expected: { base: { classification: "accept" }, candidate: { classification: "accept" } },
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
  description: "Real non-repository directory refused with missing_git_metadata.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "missing_git_metadata" },
  },
  build: async () => {
    const dir = await fs.mkdtemp(path.join(context.dirs.repos, "nonrepo-"));
    return buildInput({ effectiveCwd: dir, persistedCwd: dir, resolvedCwd: dir, baseCwd: dir });
  },
});

defineCase({
  id: "effective.persisted-cwd-mismatch.refuse",
  group: "cwd-guards",
  description: "Effective cwd differing from the persisted cwd refused.",
  expected: {
    base: { classification: "refuse", reason: "persisted_cwd_mismatch" },
    candidate: { classification: "refuse", reason: "persisted_cwd_mismatch" },
  },
  build: async () => {
    const a = await fs.mkdtemp(path.join(context.dirs.repos, "cwd-a-"));
    const b = await fs.mkdtemp(path.join(context.dirs.repos, "cwd-b-"));
    return buildInput({ effectiveCwd: a, persistedCwd: b, resolvedCwd: a, baseCwd: a });
  },
});

defineCase({
  id: "missing.persisted-workspace.refuse",
  group: "cwd-guards",
  description: "Workspace-expecting issue with no persisted workspace refused.",
  expected: {
    base: { classification: "refuse", reason: "missing_persisted_execution_workspace" },
    candidate: { classification: "refuse", reason: "missing_persisted_execution_workspace" },
  },
  build: async () => {
    const dir = await fs.mkdtemp(path.join(context.dirs.repos, "missing-persisted-"));
    return { ...buildInput({ effectiveCwd: dir, resolvedCwd: dir, baseCwd: dir }), persistedExecutionWorkspace: null };
  },
});

defineCase({
  id: "missing.effective-cwd.refuse",
  group: "cwd-guards",
  description: "Workspace-expecting issue with no effective cwd refused.",
  expected: {
    base: { classification: "refuse", reason: "missing_effective_cwd" },
    candidate: { classification: "refuse", reason: "missing_effective_cwd" },
  },
  build: async () => {
    const dir = await fs.mkdtemp(path.join(context.dirs.repos, "missing-effective-"));
    const input = buildInput({ effectiveCwd: null, persistedCwd: dir, resolvedCwd: dir, baseCwd: dir });
    return { ...input, executionWorkspace: { ...input.executionWorkspace, cwd: null } };
  },
});

defineCase({
  id: "missing.persisted-workspace-id.refuse",
  group: "cwd-guards",
  description: "Persisted workspace lacking its project workspace id refused.",
  expected: {
    base: { classification: "refuse", reason: "persisted_workspace_missing_project_workspace_id" },
    candidate: { classification: "refuse", reason: "persisted_workspace_missing_project_workspace_id" },
  },
  build: async () => {
    const dir = await fs.mkdtemp(path.join(context.dirs.repos, "missing-pw-id-"));
    return buildInput({ effectiveCwd: dir, persistedCwd: dir, resolvedCwd: dir, baseCwd: dir, persistedProjectWorkspaceId: null });
  },
});

defineCase({
  id: "project-workspace.mismatch.refuse",
  group: "cwd-guards",
  description: "Persisted workspace bound to another project workspace refused.",
  expected: {
    base: { classification: "refuse", reason: "project_workspace_mismatch" },
    candidate: { classification: "refuse", reason: "project_workspace_mismatch" },
  },
  build: async () => {
    const dir = await fs.mkdtemp(path.join(context.dirs.repos, "pw-mismatch-"));
    return buildInput({ effectiveCwd: dir, persistedCwd: dir, resolvedCwd: dir, baseCwd: dir, persistedProjectWorkspaceId: "workspace-other" });
  },
});

defineCase({
  id: "fallback.agent-home.refuse",
  group: "cwd-guards",
  description: "Workspace-expecting issue resolving to the agent fallback cwd refused.",
  expected: {
    base: { classification: "refuse", reason: "fallback_agent_home_cwd" },
    candidate: { classification: "refuse", reason: "fallback_agent_home_cwd" },
  },
  build: async () => {
    const fallback = bound.resolveDefaultAgentWorkspaceDir("agent-1");
    return buildInput({ effectiveCwd: fallback, persistedCwd: fallback, resolvedCwd: fallback, baseCwd: fallback });
  },
});

defineCase({
  id: "provider-ref.descendant.refuse",
  group: "cwd-guards",
  description: "git_worktree providerRef=root with descendant cwd refused before descendant acceptance.",
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
  id: "branch.descendant-root.refuse",
  group: "cwd-guards",
  description: "Descendant cwd with providerRef/persisted=cwd refused; records the underlying branch wrapper reasonCode.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_worktree_branch_mismatch", branchReasonCode: "not_registered" },
  },
  build: async () => {
    const worktree = await makeLinkedWorktree("branch-descendant", { branch: "THE-567-recorded" });
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

defineCase({
  id: "branch.linked-root-drift.refuse",
  group: "cwd-guards",
  description: "Genuine linked-root branch drift: providerRef=persisted=effective=root with a mismatched checked-out branch.",
  expected: {
    base: { classification: "refuse", reason: "git_worktree_branch_mismatch", branchReasonCode: "branch_mismatch" },
    candidate: { classification: "refuse", reason: "git_worktree_branch_mismatch", branchReasonCode: "branch_mismatch" },
  },
  build: async () => {
    const worktree = await makeLinkedWorktree("branch-drift", { branch: "THE-567-recorded" });
    await fixtureGit(worktree.worktreePath, ["checkout", "-b", "THE-567-actual"]);
    return buildInput({
      effectiveCwd: worktree.worktreePath,
      persistedCwd: worktree.worktreePath,
      resolvedCwd: worktree.worktreePath,
      baseCwd: worktree.worktreePath,
      strategy: "git_worktree",
      persistedStrategy: "git_worktree",
      worktreePath: worktree.worktreePath,
      providerRef: worktree.worktreePath,
      branchName: "THE-567-recorded",
      persistedBranchName: "THE-567-recorded",
    });
  },
});

defineCase({
  id: "authority.root-mismatch.refuse",
  group: "authority",
  description: "Repos A/B, effective=persisted=B/server, resolved/base=A, no pin (neutral remote).",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  predictedCandidateVerdict: "accept",
  gap: "candidate expectedRoots includes the persisted cwd so B self-matches; predicted red.",
  build: async () => {
    const repoA = await makeRepo("authority-a");
    const repoB = await makeRepo("authority-b");
    return buildInput({
      effectiveCwd: repoB.subdirectory,
      persistedCwd: repoB.subdirectory,
      resolvedCwd: repoA.root,
      baseCwd: repoA.root,
    });
  },
});

defineCase({
  id: "origin.mismatch.refuse",
  group: "authority",
  description: "Descendant origin differing from the declared remote refused.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  build: async () => {
    const repo = await makeRepo("origin-mismatch", { remoteUrl: "https://github.com/example/actual.git" });
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
  description: "Descendant declaring a remote but with no origin refused.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  predictedCandidateVerdict: "accept",
  gap: "candidate skips the origin check when origin is absent; predicted red.",
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
  description: "scp origin normalized against declared HTTPS remote accepted on candidate.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "accept" },
  },
  build: async () => {
    const repo = await makeRepo("origin-match", { remoteUrl: "git@github.com:Example/Repo.git" });
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
  description: "Nested repo inside the authoritative outer repo, effective=outer/nested/server, resolved/base=outer, no pin.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  predictedCandidateVerdict: "accept",
  gap: "candidate nearest root nested self-matches the persisted cwd root; predicted red.",
  build: async () => {
    const nested = await makeNestedRepo("nested");
    return buildInput({
      effectiveCwd: nested.nestedServer,
      persistedCwd: nested.nestedServer,
      resolvedCwd: nested.outerRoot,
      baseCwd: nested.outerRoot,
    });
  },
});

defineCase({
  id: "nested.direct-root.refuse",
  group: "authority",
  description: "Nested repo root with its own direct .git must not bypass the outer authority.",
  expected: {
    base: { classification: "refuse", reason: "git_metadata_wrong_repository" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  predictedCandidateVerdict: "accept",
  predictedBaseVerdict: "accept",
  gap: "direct .git metadata short-circuits root/origin/pin checks on both roles; predicted red.",
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
  description: "Symlink inside the outer repo pointing at another repo refused, no pin.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  predictedCandidateVerdict: "accept",
  gap: "candidate canonical target root self-matches the persisted cwd root; predicted red.",
  build: async () => {
    const outer = await makeRepo("symlink-outer");
    const other = await makeRepo("symlink-other");
    const link = path.join(outer.root, "link");
    await fs.symlink(other.subdirectory, link, "dir");
    return buildInput({
      effectiveCwd: link,
      persistedCwd: link,
      resolvedCwd: outer.root,
      baseCwd: outer.root,
    });
  },
});

defineCase({
  id: "symlink.in-root.success",
  group: "authority",
  description: "Symlink staying inside the expected repo accepted on candidate.",
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

defineCase({
  id: "pin.divergent-nonancestor.refuse",
  group: "pins",
  description: "Divergent HEAD and declared pin refused.",
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
  description: "Unresolvable declared pin refused.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_pin" },
  },
  predictedCandidateVerdict: "accept",
  gap: "candidate skips the pin comparison when pinSha is null; predicted red.",
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
  description: "HEAD ahead of an ancestor declared pin refused for the exact-pin contract.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_pin" },
  },
  predictedCandidateVerdict: "accept",
  gap: "candidate accepts an ancestor pin as a branch base; predicted red for the exact-pin contract.",
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
  description: "HEAD equal to the declared pin accepted on candidate.",
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
  description: "HEAD behind the declared pin refused.",
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

defineCase({
  id: "direct.ordinary-root.wrong-pin.refuse",
  group: "direct-git",
  description: "Ordinary root with direct .git and a wrong pin must not bypass the pin contract.",
  expected: {
    base: { classification: "refuse", reason: "git_metadata_wrong_pin" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_pin" },
  },
  predictedCandidateVerdict: "accept",
  predictedBaseVerdict: "accept",
  gap: "direct .git metadata short-circuits pin checks on both roles; predicted red.",
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
  description: "Linked root with direct .git and a mismatched declared remote must not bypass the origin contract.",
  expected: {
    base: { classification: "refuse", reason: "git_metadata_wrong_repository" },
    candidate: { classification: "refuse", reason: "git_metadata_wrong_repository" },
  },
  predictedCandidateVerdict: "accept",
  predictedBaseVerdict: "accept",
  gap: "direct .git metadata short-circuits origin checks on both roles; predicted red.",
  build: async () => {
    const worktree = await makeLinkedWorktree("direct-linked-origin", { remoteUrl: "https://github.com/example/actual.git" });
    return buildInput({
      effectiveCwd: worktree.worktreePath,
      persistedCwd: worktree.worktreePath,
      resolvedCwd: worktree.worktreePath,
      baseCwd: worktree.worktreePath,
      repoUrl: "https://github.com/example/expected.git",
    });
  },
});

defineCase({
  id: "direct.fake-empty-git-dir.refuse",
  group: "direct-git",
  description: "Non-repository directory with an empty .git DIRECTORY must not be accepted.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "missing_git_metadata" },
  },
  predictedCandidateVerdict: "accept",
  predictedBaseVerdict: "accept",
  gap: "direct .git lstat predicate accepts an empty .git directory on both roles; predicted red.",
  build: async () => {
    const dir = await fs.mkdtemp(path.join(context.dirs.repos, "fake-git-dir-"));
    await fs.mkdir(path.join(dir, ".git"), { recursive: true });
    return buildInput({ effectiveCwd: dir, persistedCwd: dir, resolvedCwd: dir, baseCwd: dir });
  },
});

defineCase({
  id: "direct.malformed-gitdir-file.refuse",
  group: "direct-git",
  description: "Non-repository directory with a malformed .git FILE must not be accepted.",
  expected: {
    base: { classification: "refuse", reason: "missing_git_metadata" },
    candidate: { classification: "refuse", reason: "missing_git_metadata" },
  },
  predictedCandidateVerdict: "accept",
  predictedBaseVerdict: "accept",
  gap: "direct .git file predicate accepts a malformed gitdir pointer on both roles; predicted red.",
  build: async () => {
    const dir = await fs.mkdtemp(path.join(context.dirs.repos, "malformed-gitdir-"));
    await fs.writeFile(path.join(dir, ".git"), "gitdir: /nonexistent/paperclip/frozen\n", "utf8");
    return buildInput({ effectiveCwd: dir, persistedCwd: dir, resolvedCwd: dir, baseCwd: dir });
  },
});

/* ------------------------------------------------------------------------- */
/* Suite                                                                    */
/* ------------------------------------------------------------------------- */

for (const fixtureCase of CASES) {
  for (const role of ["base", "candidate"] as const) {
    const expectation = fixtureCase.expected[role];
    if (expectation.classification === "refuse" && typeof expectation.reason !== "string") {
      throw new Error(`fixture authoring invariant: refuse row ${fixtureCase.id}:${role} lacks an explicit reason`);
    }
    if (expectation.classification === "accept" && expectation.reason !== undefined) {
      throw new Error(`fixture authoring invariant: accept row ${fixtureCase.id}:${role} must omit reason`);
    }
  }
}

describe("frozen-validator-independent", () => {
  beforeAll(async () => {
    bound = await loadBoundSubject(context);
  }, context.ceilings.hookTimeoutMs);

  afterAll(async () => {
    const logPath = path.join(context.dirs.output, "cases.jsonl");
    const payload = caseRecords.map((record) => JSON.stringify(record)).join("\n") + "\n";
    if (Buffer.byteLength(payload) > context.ceilings.caseLogMaxBytes) {
      throw new Error("case log exceeds the 4 MiB ceiling");
    }
    if (caseRecords.length !== CASES.length) {
      throw new Error(`case log is incomplete: ${caseRecords.length}/${CASES.length}`);
    }
    await fs.writeFile(logPath, payload, "utf8");
    if (bound?.close) {
      await bound.close().catch(() => {});
    }
  }, context.ceilings.teardownTimeoutMs);

  for (const fixtureCase of CASES) {
    it(
      fixtureCase.id,
      async () => {
        const role = context.role as "base" | "candidate";
        const expected = fixtureCase.expected[role];
        let input: FixtureWorkspaceInput;
        let observed: Record<string, unknown> = {};
        try {
          input = await fixtureCase.build();
          const effective = input.executionWorkspace.cwd;
          if (typeof effective === "string" && effective.length > 0) {
            observed = await observe(effective);
          }
        } catch (error) {
          pushRecord({
            role,
            id: fixtureCase.id,
            group: fixtureCase.group,
            description: fixtureCase.description,
            input: {},
            observed,
            expected,
            actual: { classification: "refuse", reason: null, branchReasonCode: null, message: null },
            guardDenials: [...setupGuardDenials],
            predictedCandidateVerdict: fixtureCase.predictedCandidateVerdict,
            predictedBaseVerdict: fixtureCase.predictedBaseVerdict,
            verdict: "setup_error",
            gap: fixtureCase.gap,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }

        const actual = await classify(input);
        const match = matchVerdict(actual, expected);

        pushRecord({
          role,
          id: fixtureCase.id,
          group: fixtureCase.group,
          description: fixtureCase.description,
          input: summarizeInput(input),
          observed,
          expected,
          actual,
          failureKind: match.failureKind,
          expectedView: match.expectedView,
          actualView: match.actualView,
          guardDenials: [...setupGuardDenials],
          predictedCandidateVerdict: fixtureCase.predictedCandidateVerdict,
          predictedBaseVerdict: fixtureCase.predictedBaseVerdict,
          verdict: match.passed ? "pass" : "fail",
          gap: fixtureCase.gap,
        });

        expect(match.passed, `failureKind=${match.failureKind ?? "none"}`).toBe(true);
      },
      context.ceilings.testTimeoutMs,
    );
  }
});
