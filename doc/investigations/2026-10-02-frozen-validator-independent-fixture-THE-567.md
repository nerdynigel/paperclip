# Frozen independent validator fixture — corrective v4 static publication (THE-567)

Static authoring/publication only. This document and the host modules are a
**proposal**. They prove no executed fixture correctness and no candidate
acceptance. Independent certification is [THE-564](/THE/issues/THE-564); runtime QA is
[THE-560](/THE/issues/THE-560).

This revision implements the accepted corrective contract v4
([corrective-contract-v1](/THE/issues/THE-571#document-corrective-contract-v1),
revision `7bfcbc18-766d-4691-a0c5-79d231f3dcdb`, management-accepted
[chief-contract-review-v4](/THE/issues/THE-571#document-chief-contract-review-v4))
against the V2 review plus mandatory clarification
([review-input-v2](/THE/issues/THE-567#document-review-input-v2), revisions
`4cdeb6fb-a5ab-438a-ade6-a83453cb78dd` and `de73ebbf-5e54-46dc-a803-607bb735f701`).
It supersedes `ee8f5711746976d13ff6e5d600acae02bc607440` / M
`c94a2bd04571d151c59ffaf36cdbd090b339a6f8fead03420d353ee6efba363d`.

## Contracts implemented

- **A — create/attach lifecycle + source pins.** `getValidatedRoleContext()` is a
  per-process memo; `buildValidatedRoleContext()` runs once. Bootstrap is `create`
  (exclusive `mkdir`, atomic `role-receipt.json`); preload/fixture are `attach`
  (receipt must match role/H/F/M/roleCwd/revision/workspaceId/scratch/UID, nonce, and
  a live bootstrap ancestor PID). Guard (`A.2`) validates canonical role cwd,
  `rev-parse HEAD`, `status --porcelain --untracked-files=no`, per-file blob+SHA256,
  H/C/B + scratch/tmp disjointness, and Node identity before any write/Vite/import.
  `server/src/services/workspace-runtime.ts` (blob `e96f793bacc0ac64643b25ea09e80171d7e6b1a1`
  on both roles) is now in both role file maps. Layout is
  `roleDir/work/{repos,cache,home,tmp}` (disposable) and `roleDir/evidence` (durable).
- **B — exact token policy.** `matchGitTemplate`/`planGitLaunch` match element-wise
  against typed read/setup tables (no joined strings, no joined regex). Forbidden
  scope flags are impossible by construction. Setup/subject Git cwd is canonical
  under `work/repos`; `worktree add` targets are validated inside it.
- **C — compatible child surface.** `normalize -> admit -> launch`; refusal returns
  a rejected Promise with no `.child`/`.kill` and no spawn; success attaches both to
  the real `ChildProcess`; `util.promisify.custom` yields `{stdout, stderr}`;
  `execFileSync`/`spawn`/`spawnSync`/`fork` shapes preserved; `exec`/`execSync` refused.
- **D — permanent-grant ledger.** `remaining/spent` with Rule A launch debit, Rule B
  `A_child = remaining - 1` transfer before spawn (endowment via
  `PC_FROZEN_VALIDATOR_GIT_ALLOCATION`), sync-spawn-failure return, async-error and
  terminal retire-zero. Bootstrap P0 -> Vitest main -> worker monotonic accounting
  with `(instanceId, seq)` dedupe and `cp.on("message")` relays; no `process.on("message")`
  report path.
- **E — closure/supervision/evidence.** Vitest-closure canonical Vite 8.2.2
  resolution (rejects Vite 6.4.3, root-link, ancestor, global, non-`.pnpm` realpaths);
  closure-audit plugin writing `module-audit.jsonl`; `ssr.noExternal: true`; separate
  child `exit` vs stdio `close` with 2000 ms deadline; group reap from `exit`;
  durable `evidence/` written before `work` cleanup; log-write failure exits 5,
  cleanup failure exits 6; `supervisor.json.parentDeathContainment = "unproved"`.
- **F — matcher/time/redaction.** One `matchVerdict` drives both the recorded row and
  the assertion (accept requires null wrapper reason; refuse requires the explicit
  reason; omitted `branchReasonCode` is un-compared). Case 13 records
  `not_registered`; case 14 records `branch_mismatch`. No `60000` literals; recursive
  path redaction; `observe()` guard denials recorded; case-log completeness checked.

## V4 corrections (this revision)

Implements the six V4 findings against published `c6b62743`:
- V4-1: the linked-worktree operand is an exact absolute `SLOT.ABS_TARGET` at argv index 4; `planGitLaunch`
  validates the launched operand's canonical parent under `work/repos`, its nonexistence and symbol
  containment (no `args[5]`, no `REL`, no shell split).
- V4-2: the bootstrap refuses before any child (`PARENT_DEATH_UNPROVED`, exit 7) while
  `containment.parentDeathProof` is unproved.
- V4-3: the reaper is a promise awaited after `close`; `terminalOk` guards success; durable evidence is
  written before any `work` cleanup, and a failed evidence write exits 5 without deleting the work tree.
- V4-4: the tracked-tree `status` read is counted; reports carry `type`+`token`; the bootstrap keeps a
  per-instance monotonic map and aggregate, bound to the exact report token.
- V4-5: fork admits only the realpath+hash `dist/workers/forks.js` with a token-allowlisted worker
  execArgv that must include the pinned preload; spawn/spawnSync are Git-only; `tinypool` is refused.
- V4-6: closure prefixes are the exact Vitest/Vite package dirs (no `dirname` widening); the 17+5
  registered worker files are hash-verified; the module audit is bounded and fails on overflow instead
  of truncating to success.

## Residual corrections (this revision)

Implements the three independent residuals at `cf5a4ebc`:
- R1 terminal-before-cleanup: the awaited group-reap and stdio-close proof is evaluated before any
  disposable cleanup; a nonterminal proof (`exit 7`) or failed evidence write (`exit 5`) preserves the
  work tree and evidence; `supervisor.terminalProofOk` records the proof.
- R2 exact worker graph: `assertWorkerExecArgv` requires exact ordered equality with the certified
  token array (no permutation/repetition/subset); `assertWorkerOptions` pins cwd=H, inherited cwd=H,
  shell=false, detached=false, execPath=N, serialization=advanced, stdio=pipe; `assertWorkerEnv`
  allowlists the caller env; the endowed env is rebuilt from a sanitized base.
- R3 Git shell refusal: `assertNoShell` refuses `shell:true` on the execFile, execFileSync, spawn and
  spawnSync paths before any child starts.

## Host files (current bytes)

| File | Git blob | SHA256 |
| --- | --- | --- |
| `frozen-validator-loader.mjs` | `40f0941e16b90a237c0cdf1e4da5d5f587ac85d5` | `c04757cac48813915108d439cfeb8fbff1207c9e8a373ae20cab77d9636d064f` |
| `frozen-validator-bootstrap.mjs` | `816be7a13ab230c0b35de8694091ad6a4cd7210f` | `605173e368f42a97b45aa6ef67b021804d89f1f3402527c820528759b9659272` |
| `frozen-validator-preload.mjs` | `ef1605c4b3ebe585cad113dc854920502773f60c` | `17879e8f6e42a39649d23f03f48a2fd45db85269996ecc27a66165395fe7c591` |
| `frozen-validator.vitest.config.mjs` | `a4f422c8842b691dc15084b8cfa53e1a0d925279` | `a6016305163db24a74c8e7d1af2e979f46525b8a352f6143c682953fa6bcd26e` |
| `frozen-validator-independent.test.ts` | `d1613c555d09e57115bf2363d123b14f5886da29` | `b89c4034ee8be5350df4287fb4e9362071cb6f04092be1102e25a51ef9417a02` |
| `frozen-validator.manifest.json` | (M source) | `2aafd0a369f527326b7f19adb9eb03b4b8b6a8457c8e7aa467c0b2f38dfc8195` |

## Toolchain closure (installed, not committed)

- Node `/home/nigel/.nvm/versions/node/v24.21.0/bin/node`, v24.21.0, SHA256
  `7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c`.
- Vitest 4.1.11 package.json SHA256
  `a28126d97bcaf567da5bed69443b7f3bcd9a7a8c38c8b66e554686b6bb2c10e0`, `vitest.mjs`
  SHA256 `39db22f579acf5639bbb17a261408debbde03f4692c0c439e77e7f13aeba74d6`.
- Vite 8.2.2 package.json SHA256
  `4e41dd20c7a12e7e70915b235c0bf5b5158ec6709c1390804128af0867d6d6d9`,
  `dist/node/index.js` SHA256
  `c7ea52906f843318d7971209ce62bd24bab60590275e8f415c5564fa35cb82dc`, resolved
  only from the Vitest closure under `<H>/node_modules/.pnpm`.
- pnpm 9.15.4 identity per the Reliability HCB input; the fixture does not invoke pnpm.

## Case matrix retained

31 rows: 30 prior cases plus `branch.linked-root-drift.refuse`; 11 candidate
predicted-red and 5 base predicted-red security assertions. Base direct-`.git` red
rows remain security findings, not all-green requirements. Paired base root-positive,
base descendant `missing_git_metadata`, and candidate descendant success preserved.

## Token templates (not execution permission)

F = corrected host commit; M = manifest SHA256 (above); N = certified Node path.
All are pending Verification binding.

```text
/home/nigel/.local/bin/mem-bounded 4G --estimate 600 --reserve 180 --run-budget 1800 --max-duration 600 --product-sha 29bf67512aabd7b461a30e546c195e28c37f219e --cases the-560-validator-independent-candidate -- <N> <H>/server/src/__tests__/frozen-validator-bootstrap.mjs --role candidate --host-sha <F> --manifest-sha256 <M> --node <N>

/home/nigel/.local/bin/mem-bounded 4G --estimate 600 --reserve 180 --run-budget 1800 --max-duration 600 --product-sha 871532c335bb8c0f501a200201f4e4ac1fc63fb0 --cases the-560-validator-independent-base -- <N> <H>/server/src/__tests__/frozen-validator-bootstrap.mjs --role base --host-sha <F> --manifest-sha256 <M> --node <N>
```

Child argv: `<N> --import <H>/server/src/__tests__/frozen-validator-preload.mjs
<H>/node_modules/vitest/vitest.mjs run --config
<H>/server/src/__tests__/frozen-validator.vitest.config.mjs --pool=forks
--maxWorkers=1 --no-file-parallelism
<H>/server/src/__tests__/frozen-validator-independent.test.ts`.

## Honest limits

- Not executed. No fixture, Vitest, Vite, helper, install, build or product load.
- F and M prime are published; N and the detached parent-death containment remain
  explicitly held prerequisites. `parentDeathContainment` is `unproved` and the
  runtime supervision gate fails closed.
- Full third-party/native/conditional export and workspace dependency closure
  remains owned by [THE-563](/THE/issues/THE-563); this design does not certify it.
- The ledger traces are illustrative static arithmetic, not measured Git totals.

## Rollback

Revert the task branch commit or delete the added host files. No product source,
frozen candidate/base byte, policy, infrastructure or installed dependency is
modified. C/B remain immutable.
