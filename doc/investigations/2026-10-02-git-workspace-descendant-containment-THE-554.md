# THE-554 Git workspace validation for genuine repository subdirectory launches

Date: 2026-10-02. Owner: Software & Protocol Engineer. Branch:
`fix/the-554-git-workspace-containment` (base `871532c335bb8c0f501a200201f4e4ac1fc63fb0`).
Workspace: `c2c2e7a1-0e76-45f0-b8e5-9d607b9ac273`
(`.paperclip-source-pins/2026.916.1/installed-source`).

## Root cause (reproduced)

`assertGitSensitiveAdapterWorkspaceValid` in `server/src/services/heartbeat.ts` proved
"is a git workspace" only with `hasGitMetadata`, which does `lstat(cwd/.git)` and never
discovers an ancestor repository. A legitimate launch cwd that is a **subdirectory** of a
real repository therefore failed `workspace_validation_failed` with reason
`missing_git_metadata`.

Reported instance (THE-537 watchdog / THE-538 diagnosis): THE-533 workspace
`4b4d6acb-86ed-4655-82e0-071bee77533a`, cwd
`.../2026.916.1/frozen-verify/server`. Git top-level is the genuine linked-worktree root
`.../frozen-verify` (its `.git` is a FILE at the root, not at `server/`). Run
`07d7e2fb-503e-4f4f-85a8-ed131562ed0e` failed before provider work on this guard.

## Repair (smallest justified)

`server/src/services/heartbeat.ts`:

- `inspectGitLaunchCwd(cwd)` keeps the legacy direct `.git` predicate as the fast path,
  then uses Git's own discovery (`git rev-parse --show-toplevel`) to classify a genuine
  descendant. Ancestor discovery stops at the nearest work tree, so an outer unrelated
  repository is never silently accepted.
- When direct metadata is absent, acceptance now additionally requires:
  1. **Containment** — the launch cwd canonicalizes inside the discovered root.
  2. **Identity** — the discovered root equals the git top-level of the recorded
     persisted/resolved workspace cwd (and providerRef/worktreePath when present). If no
     recorded root can be resolved, the launch is rejected rather than guessed.
  3. **Remote identity (best effort)** — when the workspace declares a remote `repoUrl`,
     the containing checkout's `origin` must normalize to the same repository.
  4. **Expected pin** — a declared `repoRef`/`baseRef` that resolves locally must be
     `HEAD` or an ancestor of `HEAD`.
- Preserved guards (unchanged and still enforced): exact launch cwd
  (`persisted_cwd_mismatch`), git-worktree provider ref
  (`git_worktree_provider_ref_mismatch`), managed branch
  (`git_worktree_branch_mismatch`), persisted/project workspace binding.
- New reasons: `git_metadata_wrong_repository`, `git_metadata_wrong_pin`. A path with no
  containing repository still fails `missing_git_metadata`.

`hasGitMetadata` was removed because it had no remaining callers.

## Criterion map (THE-554 acceptance)

| Acceptance criterion | Evidence |
| --- | --- |
| Reproduce legitimate descendant launch rejection | `heartbeat-workspace-session.test.ts` "accepts a genuine descendant directory of a linked worktree root" fails on the pre-repair guard (no direct `.git`) and passes after. |
| Positive: linked-root | "still accepts the linked worktree root itself with direct .git metadata" (`.git` FILE at root). |
| Positive: valid descendant | "accepts a genuine descendant directory of a linked worktree root". |
| Negative: non-repository | existing "rejects a workspace-linked issue when adapter cwd has no git metadata" → `missing_git_metadata`. |
| Negative: wrong ancestor/root | "rejects a descendant whose containing repository is not the recorded repository" (declared `repoUrl` vs `origin`) → `git_metadata_wrong_repository`. |
| Negative: wrong pin | "rejects a descendant whose HEAD is not at the recorded pin" (`repoRef` ahead of HEAD) → `git_metadata_wrong_pin`. |
| Negative: cwd/provider mismatch | existing `git_worktree_provider_ref_mismatch` test plus "preserves the git worktree provider-ref guard for a descendant launch". |
| Preserve exact launch cwd / persisted / provider / branch guards | no existing guard or reason removed or relaxed; provider/branch/cwd guard tests unchanged and green. |
| No arbitrary ancestor acceptance | identity check requires the discovered root to equal a recorded workspace root; unresolvable recorded roots reject. |

## Executed validation (base revision + change)

```
pnpm exec vitest run server/src/__tests__/heartbeat-workspace-session.test.ts
  -> Test Files 1 passed (1); Tests 161 passed (161)

pnpm exec vitest run server/src/__tests__/heartbeat-project-repositories.test.ts
  -> Test Files 1 passed (1); Tests 13 passed (13)

pnpm --filter @paperclipai/server exec tsc --noEmit
  -> exit 0
```

The pre-repair guard was exercised by the new descendant test (it rejected before the
change, passes after). No paid Actions, launcher/sandbox/auth, install, host activation,
restart, pin promotion or merge were performed. Host-local only; Git commands used the
already-installed `git` with a transient cwd.

## Limits

- Remote identity is best effort: it only rejects when both the declared `repoUrl` and the
  containing `origin` are remote URLs and normalize differently. Local-path workspaces
  with no remote rely on the recorded-root identity and pin checks.
- An unresolvable local `repoRef`/`baseRef` is not treated as a mismatch (cannot verify).
- This change validates launch preconditions only; it does not repair or rebind the THE-533
  workspace `4b4d6acb`, promote a pin, or activate the change. Independent verification
  (THE-533) and activation remain separate Chief gates.

## Rollback

Revert the single source/test/docs commit on the task branch; no data, config, host or
workspace mutation is involved.
