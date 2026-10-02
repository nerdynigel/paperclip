# Frozen independent validator fixture — manifest and permission inputs (THE-567)

Static authoring/publication only. This document and the companion fixture
`server/src/__tests__/frozen-validator-independent.test.ts` are a **proposal**;
they prove no executed fixture correctness and no candidate acceptance. Independent
runtime QA is [THE-560](/THE/issues/THE-560) (held); independent certification of
these static bytes is [THE-564](/THE/issues/THE-564).

Source contract: [THE-564 static-contract-partial](/THE/issues/THE-564#document-static-contract-partial)
revision `399f0503-95be-4f26-a2d9-e62644f155c4`, copied into
[THE-567 fixture-design](/THE/issues/THE-567#document-fixture-design).

## Subject

`assertGitSensitiveAdapterWorkspaceValid` in `server/src/services/heartbeat.ts`
of the bound frozen checkout. Roles are run separately:

- `base` — immutable pre-descendant-discovery revision.
- `candidate` — immutable descendant-discovery revision.

The fixture refuses to run unless the bound checkout's top-level, HEAD, heartbeat
Git blob and SHA256 all match the pinned role, and unless a forbidden root (the
authoring checkout) is supplied and does not contain the bound root. It is inert
(`describe.skip`) when no role/root is supplied, so it never silently exercises the
authoring checkout.

## Immutable Git object bindings (independently read)

Git blob IDs are content-addressed; SHA256 is over the blob bytes.

| Path | Base blob / SHA256 | Candidate blob / SHA256 |
| --- | --- | --- |
| `server/src/services/heartbeat.ts` | `76293aca7cc39f2f06e80d17704bd7bdd1ddc794` / `c668a1e69c75e652185b18283294a6e920b33867c7702224b154975f9d89600a` | `47586831b3b90d8d16f2b053eba3177dfcd253a6` / `cbdfeedbcb28e660d4103ddfe585812585325e79202fc24902828699558b2750` |
| `server/src/__tests__/heartbeat-workspace-session.test.ts` | `04faeb834f93a70d2e55beda6a637d6e8cf9b24d` / `6c2f30941dbce9bbe0c78cb0ad340c7476c6ed12a6510d2ca8982543097e3237` | `583f1a455b6f8f7fa15e84603e7f09074320cd9c` / `318365ddde4d0279d34ea0ad0b7e72119eedd2029007521205f2a1c9276ee17e` |
| `server/src/__tests__/heartbeat-project-repositories.test.ts` | (unchanged) `f87ac2b11c4fde0636e2d5a1a4ceb9041b736ebf` / `38ffc64331eb3839b0e55812f0180f386ab2f39548b0fc5dfcbffa7541f30ce1` | `f87ac2b11c4fde0636e2d5a1a4ceb9041b736ebf` / `38ffc64331eb3839b0e55812f0180f386ab2f39548b0fc5dfcbffa7541f30ce1` |
| `package.json` | `69fa2dce143750c9c2c9452d0f77b33c6038968c` / `36f774d59291df67ef5ec9d7562f7d6cdec2063d9375d9e8030cd1bf6e790ffb` | same |
| `server/vitest.config.ts` | `239bce1bc3b00a303f50bc0b07a072ef48624f64` / `dd0f8403f963dbbb0879e56c5820e5458acd94fcc3510ad99006b40258fe9990` | same |
| `vitest.config.ts` | `cceb1767e2ba0bee7209a54fbc2ba81bb44755ef` / `0f8018d2e6963d1013f0148746afed5f87371b89d41bbc9875a80d593746595d` | same |
| `pnpm-lock.yaml` | `c34d669b3be4a4a6711083cc4e6242feed2e3a20` / `d7d96cf0d98cf0946f6195e29ba173b03711a947a1c38f312b67cda56c254c22` | same |
| `pnpm-workspace.yaml` | `3518e9086ffa5f33c6560f921915ce231a8c3183` / `3da641269a022cfa084e1e0dd65a4e3f82eac5359611d08569459cc89def7ebb` | same |

Revisions: base `871532c335bb8c0f501a200201f4e4ac1fc63fb0`,
candidate `29bf67512aabd7b461a30e546c195e28c37f219e`.

Fixture file binding (authored revision):
`server/src/__tests__/frozen-validator-independent.test.ts` blob
`e30a10977d60c50340b1935dcb313f8421151da1`, SHA256
`a7a20b612e13471952a9eb1927472dbf16ab3dae128c934c3682c3bd5cbc5890`.

## Case matrix (input / expected / predicted)

`cand` = candidate, `base` = base. `refuse:<reason>` is the
`workspaceValidation.reason`. Predicted-red rows are the security contract, not a
waiver: a red candidate assertion is an acceptance finding.

| # | Case id | Input shape | base | candidate | predicted candidate |
| --- | --- | --- | --- | --- | --- |
| 1 | `descendant.linked-worktree.success` | linked-worktree `server/` descendant, pin=HEAD | `refuse:missing_git_metadata` | accept | accept |
| 2 | `descendant.ordinary-repo.success` | ordinary repo `server/` descendant, pin=HEAD | `refuse:missing_git_metadata` | accept | accept |
| 3 | `root.linked-worktree.success` | linked-worktree root, direct `.git` FILE | accept | accept | accept |
| 4 | `root.ordinary.success` | ordinary repo root, direct `.git` DIR | accept | accept | accept |
| 5 | `nonrepo.descendant.refuse` | real non-repo dir | `refuse:missing_git_metadata` | `refuse:missing_git_metadata` | refuse |
| 6 | `effective.persisted-cwd-mismatch.refuse` | effective ≠ persisted cwd | `refuse:persisted_cwd_mismatch` | same | refuse |
| 7 | `missing.persisted-workspace.refuse` | null persisted workspace | `refuse:missing_persisted_execution_workspace` | same | refuse |
| 8 | `missing.effective-cwd.refuse` | null effective cwd | `refuse:missing_effective_cwd` | same | refuse |
| 9 | `missing.persisted-workspace-id.refuse` | persisted project workspace id null | `refuse:persisted_workspace_missing_project_workspace_id` | same | refuse |
| 10 | `project-workspace.mismatch.refuse` | persisted bound to other workspace | `refuse:project_workspace_mismatch` | same | refuse |
| 11 | `fallback.agent-home.refuse` | effective = agent fallback | `refuse:fallback_agent_home_cwd` | same | refuse |
| 12 | `provider-ref.descendant.refuse` | git_worktree providerRef=root, cwd=descendant | `refuse:git_worktree_provider_ref_mismatch` | same | refuse |
| 13 | `branch.descendant.refuse` | descendant, providerRef=persisted=cwd, recorded branch ≠ actual | `refuse:missing_git_metadata` | `refuse:git_worktree_branch_mismatch` | refuse |
| 14 | `authority.root-mismatch.refuse` | repos A/B; effective=persisted=B/server, resolved/base=A | `refuse:missing_git_metadata` | `refuse:git_metadata_wrong_repository` | **accept (gap)** |
| 15 | `origin.mismatch.refuse` | descendant origin ≠ declared remote | `refuse:missing_git_metadata` | `refuse:git_metadata_wrong_repository` | refuse |
| 16 | `origin.missing.refuse` | descendant declares remote, repo has no origin | `refuse:missing_git_metadata` | `refuse:git_metadata_wrong_repository` | **accept (gap)** |
| 17 | `origin.match.normalization.success` | origin `git@github.com:Example/Repo.git` = declared HTTPS | `refuse:missing_git_metadata` | accept | accept |
| 18 | `nested.repo.refuse` | effective/persisted=outer/nested/server, resolved/base=outer | `refuse:missing_git_metadata` | `refuse:git_metadata_wrong_repository` | **accept (gap)** |
| 19 | `nested.direct-root.refuse` | effective/persisted=outer/nested root (direct `.git`), resolved/base=outer | `refuse:git_metadata_wrong_repository` | same | **accept (gap, both roles)** |
| 20 | `symlink.escaping.refuse` | `outer/link -> other/server`, resolved/base=outer | `refuse:missing_git_metadata` | `refuse:git_metadata_wrong_repository` | **accept (gap)** |
| 21 | `symlink.in-root.success` | `outer/link -> outer/server`, exact cwd contract | `refuse:missing_git_metadata` | accept | accept |
| 22 | `pin.divergent-nonancestor.refuse` | HEAD/declared pin on divergent branches | `refuse:missing_git_metadata` | `refuse:git_metadata_wrong_pin` | refuse |
| 23 | `pin.unresolved-nonref.refuse` | declared pin does not resolve locally | `refuse:missing_git_metadata` | `refuse:git_metadata_wrong_pin` | **accept (gap)** |
| 24 | `pin.exact-ancestor.refuse` | HEAD ahead of declared pin (pin is ancestor) | `refuse:missing_git_metadata` | `refuse:git_metadata_wrong_pin` | **accept (gap)** |
| 25 | `pin.head-equals.success` | HEAD = declared pin | `refuse:missing_git_metadata` | accept | accept |
| 26 | `pin.behind.refuse` | HEAD behind declared pin | `refuse:missing_git_metadata` | `refuse:git_metadata_wrong_pin` | refuse |
| 27 | `direct.ordinary-root.wrong-pin.refuse` | ordinary root, wrong pin | `refuse:git_metadata_wrong_pin` | same | **accept (gap, both roles)** |
| 28 | `direct.linked-root.wrong-origin.refuse` | linked root, declared remote ≠ origin | `refuse:git_metadata_wrong_repository` | same | **accept (gap, both roles)** |
| 29 | `direct.fake-empty-git-dir.refuse` | non-repo dir with empty `.git/` DIR | `refuse:missing_git_metadata` | same | **accept (gap, both roles)** |
| 30 | `direct.malformed-gitdir-file.refuse` | non-repo dir with malformed `.git` FILE | `refuse:missing_git_metadata` | same | **accept (gap, both roles)** |

Grouped residuals from the source contract: candidate self-match on the persisted
cwd root (14/18/20), missing/unresolved origin and pin skips (16/23), ancestor
pin waiver (24), and the direct-`.git` fast path skipping root/origin/pin checks
(19/27/28/29/30). These are recorded as explicit red assertions.

## Proposed runner argv (complete, separate candidate/base)

Runtime closure is Reliability-owned. The fixture binds by relative import to
`../services/heartbeat.ts`, so it must run from a checkout at the pinned revision
that contains this exact fixture file (for example a temporary full checkout or
read-only worktree of the pinned revision; the frozen ROOT `ce40ac7f` itself stays
immutable). `TMPDIR` must resolve under the run-owned scratch so `os.tmpdir()`
and every generated repo/linked worktree stay inside it.

The following are placeholders whose required bindings are the revision, heartbeat
blob and SHA256 above; the exact scratch path is a run-owned input, not certified
here.

Candidate:

```
PC_FROZEN_VALIDATOR_ROLE=candidate \
PC_FROZEN_VALIDATOR_ROOT="$CANDIDATE_CHECKOUT" \
PC_FROZEN_VALIDATOR_REVISION=29bf67512aabd7b461a30e546c195e28c37f219e \
PC_FROZEN_VALIDATOR_FORBIDDEN_ROOT="$AUTHORING_CHECKOUT" \
PC_FROZEN_VALIDATOR_SCRATCH="$PAPERCLIP_RUN_SCRATCH_DIR" \
PC_FROZEN_VALIDATOR_CASE_LOG="$PAPERCLIP_RUN_SCRATCH_DIR/frozen-validator-independent-candidate-cases.jsonl" \
TMPDIR="$PAPERCLIP_RUN_SCRATCH_DIR" \
/home/nigel/.local/bin/mem-bounded 4G --estimate 600 --reserve 180 --run-budget 1800 \
  --max-duration 600 --product-sha 29bf67512aabd7b461a30e546c195e28c37f219e \
  --cases the-560-validator-frozen-independent-candidate -- \
  pnpm exec vitest run server/src/__tests__/frozen-validator-independent.test.ts
```

Base (same shape): `PC_FROZEN_VALIDATOR_ROLE=base`,
`PC_FROZEN_VALIDATOR_ROOT="$BASE_CHECKOUT"`,
`PC_FROZEN_VALIDATOR_REVISION=871532c335bb8c0f501a200201f4e4ac1fc63fb0`,
`--product-sha 871532c335bb8c0f501a200201f4e4ac1fc63fb0`,
`--cases the-560-validator-frozen-independent-base`, and a base case-log path.

Each invocation emits one JSON-lines record per case:
`{role,id,group,description,input,expected,actual,predictedCandidateVerdict,predictedBaseVerdict,verdict,gap,error?}`.

## Local Git subprocess allowance and ceilings

The fixture's own setup Git is confined to the run-owned scratch and an allowlist:
`init, config, add, commit, worktree, branch, checkout, switch, reset, rev-parse,
merge-base, remote, hash-object, symbolic-ref, status`. Network/mutation commands
(`fetch,push,clone,remote add/remove` against real remotes) are not permitted.
Ceilings (env-overridable): `PC_FROZEN_VALIDATOR_GIT_MAX_CALLS` default 600,
`PC_FROZEN_VALIDATOR_GIT_TIMEOUT_MS` default 15000, `PC_FROZEN_VALIDATOR_GIT_MAX_BUFFER`
default 1048576, and a 60000 ms per-test timeout. The subject's own internal Git
reads are part of the candidate/base under test and are bounded by that timeout,
not by the fixture wrapper.

## Run-owned disk scratch / output / cleanup

- Scratch root: `PC_FROZEN_VALIDATOR_SCRATCH` (fallback `PAPERCLIP_RUN_SCRATCH_DIR`),
  must contain `os.tmpdir()`.
- Fixture root: `<scratch>/frozen-validator-independent-<role>-<random>`.
- All generated repos, linked worktrees and symlink targets live under the fixture
  root.
- Case log is written (sanitized: paths relativized to the scratch root) to
  `PC_FROZEN_VALIDATOR_CASE_LOG` or `<scratch>/frozen-validator-independent-<role>-cases.jsonl`
  before cleanup.
- `afterAll` recursively removes only the fixture root; the case log is preserved.

## Permission inputs (future execution; not granted here)

- Runtime QA issue [THE-560](/THE/issues/THE-560) `f527dbee-1917-4e61-b9c8-500a8597521b`,
  agent `089a4259-cb74-4ea9-8f3f-c33555f7c841`, exact registered workspace/canonical cwd.
- Helper v5 SHA256 `ff3b13be8506d82f24834eaae9e347a2f2884a56398fcf29864a0ff488e87f54`;
  max 4G; `--estimate 600 --reserve 180 --run-budget 1800 --max-duration 600`;
  minimum 780 s before and after shared `heavy.lock`/`fd9` acquisition; no overrides
  or raw fallback.
- No wildcard shell payloads, extra test paths, interpolated refs, alternate
  executables, install, or network.

## Design limits

- Static bytes only. Not executed here; no candidate acceptance is asserted.
- The candidate/base module load, dependency closure, helper budget and exact argv
  tokens remain Reliability-owned and are not certified by this document.
- The run-owned scratch root must not itself be inside a Git repository, otherwise
  the `nonrepo.descendant.refuse` fixture would discover an enclosing repository
  and no longer represent a real non-repository directory.
- Case 13 (`branch.descendant.refuse`) passes the descendant cwd as the worktree
  path, so the branch guard's `inspectManagedGitWorktreeBranch` cannot confirm a
  worktree root and reports `git_worktree_branch_mismatch`; the refusal reason is
  correct but the underlying reasonCode is `wrong_repository_root`, not
  `branch_mismatch`. Recorded honestly.
- Matching-origin case 17 is local-only (no network); normalization is the
  scheme/userinfo/`.git`/case normalization in the subject.

## Rollback

Revert the task branch commit / delete the two added files. No product source,
policy, infrastructure or candidate byte is modified.
