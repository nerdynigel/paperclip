# Frozen independent validator fixture — runtime-compat corrections + disposable Q probe (THE-567 → THE-574)

Static authoring/publication only. This document and the host modules are a
**proposal**. They prove no executed fixture correctness and no candidate
acceptance. Independent certification is [THE-564](/THE/issues/THE-564); runtime QA is
[THE-560](/THE/issues/THE-560).

This revision (THE-574 F‴) is the SOURCE-ONLY runtime-compatibility correction and
disposable Q probe implementation accepted against the THE-573 packet, with the
Q source corrected against the independent [THE-575 adverse
checkpoints](/THE/issues/THE-575#document-independent-adverse-checkpoint-c0a7d4a8)
(`c0a7d4a8cbdd95088c7fa84ca9948d7c93c55613`) and
[d92e672a](/THE/issues/THE-575#document-independent-adverse-checkpoint-d92e672a)
(`d92e672a2437bf906912629282288f3d6ce2b493`) plus the [Chief correction
handoff](/THE/issues/THE-574#document-chief-q-correction-handoff). The current Q′
revision additionally implements the Chief-accepted, remotely published
[THE-581 correction contract RC-1..RC-4](/THE/issues/THE-581#document-q-correction-contract-f038eae8)
(Homelab PR28 `ff72966…`). It supersedes
the V4-residual host bytes at `0cd724f789ce48d495e8b22e5a9b413b6b942ecf`
(M `2aafd0a369f527326b7f19adb9eb03b4b8b6a8457c8e7aa467c0b2f38dfc8195`). The
corrected host commit is `F‴`; the corrected manifest SHA256 is
`M‴ = d2ccdee9b1a31c64ee6361140c5e7c2e0f86f7b82ebe2755579640c7a05715d0` (unchanged
from F′, since the runtime-compat host bytes are untouched by the Q correction).
F‴/Q full commit SHAs and paths are published in the THE-574 thread and PR3 head
readback; this document is carried by the task branch head `F‴`.

It implements the V4 corrective contract
([corrective-contract-v1](/THE/issues/THE-571#document-corrective-contract-v1),
revision `7bfcbc18-766d-4691-a0c5-79d231f3dcdb`, management-accepted
[chief-contract-review-v4](/THE/issues/THE-571#document-chief-contract-review-v4))
plus the accepted runtime-closure packet
([packet](/THE/issues/THE-573#document-artifact-review-c5000d63-4436-4a03-8490-d3f7a2dfc2d7),
revision `d4551ff3-9e7f-40eb-921e-0812a03aa078`).

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

## Host files (corrected bytes at F‴)

| File | Git blob | SHA256 |
| --- | --- | --- |
| `frozen-validator-loader.mjs` | `40f0941e16b90a237c0cdf1e4da5d5f587ac85d5` | `c04757cac48813915108d439cfeb8fbff1207c9e8a373ae20cab77d9636d064f` |
| `frozen-validator-bootstrap.mjs` | `84df18464f25f8191c75d25249c423af4515f29b` | `172da41bc30d9b5cb68e29802aff110f5ef30997ae1571eee3d5e3290dbcc12f` |
| `frozen-validator-preload.mjs` | `ee3e15af09ba3b659cbd7ca286442ce4c55332a7` | `dcc9fd51ef409327f3c4b6b50eeedd04429993b5d7665b8ac41e12573b9320be` |
| `frozen-validator.vitest.config.mjs` | `f0b176f6ab4eea8a5bf1c988a8719eded8ae9acd` | `a5bed0ced096c814502a046e43bee7d288d3918f56cb250b88ff784a7960f554` |
| `frozen-validator-independent.test.ts` | `d1613c555d09e57115bf2363d123b14f5886da29` | `b89c4034ee8be5350df4287fb4e9362071cb6f04092be1102e25a51ef9417a02` |
| `frozen-validator.manifest.json` | `b65ca44f0b566e53d9ca9215abb4ce2588da785d` | `d2ccdee9b1a31c64ee6361140c5e7c2e0f86f7b82ebe2755579640c7a05715d0` |

## Runtime-compatibility corrections (THE-574, acceptance 1)

Source refs are the exact installed bytes in this H tree; all are read-only,
non-evaluating inspections.

| # | Correction | Source anchor | Exact host line |
| --- | --- | --- | --- |
| C1 | FORCE_TTY empty under pipe/no-TTY is the only admissible value; `true`/any other value and all unknown keys are refused | Vitest 4.1.11 `dist/chunks/cli-api.CnMVyzaz.js` `resolveOptions` (`FORCE_TTY: isatty(1) ? "true" : ""`) | preload `WORKER_ENV_ALLOW`/`WORKER_ENV_ALLOWED_VALUE` and `assertWorkerEnv` value guard (preload 111-146/287-301) |
| C2 | Closed worker env: rebuilt from a sanitized base, `FORCE_TTY=""` preserved, framework values pinned, no inherited-env widening | Vitest `resolveOptions` env merge | preload `sanitizedWorkerBase` (`FORCE_TTY:""`) and `endowWorker` (preload 310-342) |
| C3 | Supported native config-loader forwarding for the plain `.mjs`: Vitest CLI `configLoader` -> Vite inline `configLoader`; Vite `nativeImportConfigFile` imports with `import()` and writes no `node_modules/.vite-temp` in H | Vitest `dist/chunks/cac.uFydS1Z4.js` (`configLoader`), `cli-api` `createVitest` (`configLoader: options.configLoader`); Vite 8.2.2 `dist/node/chunks/node.js` `loadConfigFromFile`/`nativeImportConfigFile` (36958-37007) | bootstrap child argv `--configLoader native` (bootstrap 121-137) |
| C4 | Explicit ordered SSR worker conditions `[node, production]` (no Vite default inference); production retained because bootstrap pins `NODE_ENV=production` (Vite `isProduction` at node.js 36707) | Vitest `resolveConditions` (`ssr.resolve.conditions` for Vite >= 6, in order) | config `ssr.resolve.conditions` (config 22-35) |

Preserved unchanged: mandatory preload, exact worker argv/path/hash
(`CERTIFIED_WORKER_EXECARGV`), run/role receipts, IPC ledger/count/seq, R1-R8,
contracts A-F, the 31-case matrix, 11 candidate/5 base predicted-red assertions
and refusal-before-child (`PARENT_DEATH_UNPROVED`, exit 7). `parentDeathProof`
stays `null`.

## Disposable Q probe (THE-574, acceptance 2)

Separate pinned probe source under
`server/src/__tests__/frozen-validator-probe/`. Built-ins only; no product,
Git, DB, provider or network. This is not installable authority or a runtime
PASS.

| Q file | Git blob | SHA256 |
| --- | --- | --- |
| `probe-observer.mjs` | `f8de97ba09a242e96c79b0c97829728d06095d9e` | `c111f82a66c9f4ac493ef47e7923a440e3c6ff100f35d54ac6c1c05c1f4f81a4` |
| `probe-surrogate-supervisor.mjs` | `b2a30883f1cf9e9486273d43de269eb232b5c406` | `77331c89f2257a28cd01d5d731939cc61a1f8e5022dd7d2a2279048f99810025` |
| `probe-surrogate-child.mjs` | `ac6fcaf3e7255cc89a2c402a746aadb5f4c1c93d` | `030da657ac187fca83983a11a12cb506b47f562300327adc840ba2686b4ff331` |
| `probe-worker-smoke.test.mjs` | `22b6a9896ce4cfd787978652dda29fe986a674a3` | `02cd77dd79ac46090920ae9249f87ac5b6637ef183e127f76c2bb527df26cd6d` |
| `probe-worker-smoke.vitest.config.mjs` | `016bda6c17f377156069fe1eeba925b63ce1837a` | `21560612f38e6fdda80fe6800395068f48871e5389be2d8ea0bf8d832c8f299a` |
| `probe-preload.mjs` | `1b553c70c31a83da2f2bbb7c715b2c2bfe81c53f` | `72c9cf6dd05b81a97fdfe74a703dc71f208b63fad71025e76f7d0082d7c1f812` |

Q entry token = `probe-observer.mjs`; mode operand is `normal-close`,
`bootstrap-kill` or `worker-smoke`. It enforces: max 4 disposable Node
processes; hard 10s; self-expiry 3s (defense-in-depth, never parent-death
proof); observation at 750ms before self-expiry with `TERM`/`KILL` 500ms;
awaited <=2s reap/stdio close; output <=1MiB, row <=64KiB, owned disk scratch
<=4MiB; owned PID/starttime/PGID/scope plus metadata-only `/proc` reads. Unknown
ownership, timeout, missing-ready or residual state fails closed. Observer
rescue is recorded separately and is never positive containment. No live
process is killed. `normal-close` is positive terminal cleanup only; the
`bootstrap-kill` mode kills only its own disposable supervisor and distinguishes
self-expiry, rescue and residual, always reporting `containment: "unproved"`.

## F″ corrections against the THE-575 adverse rows

Every row is a static source change; no Q execution.

| Adverse row | F″ correction (path line) |
| --- | --- |
| hard/setup finish exits without owned-graph cleanup | single `finalize()` runs on every post-spawn path: optional owned-group kill, one absolute bounded terminal wait, evidence-before-cleanup; observer exit no longer scores terminal (`probe-observer.mjs` 344-410) |
| survivors require live leader; no ancestry/current-PGID binding | `remember()` binds PID/starttime/current PGID/expected parent; `liveOwned()` discovers group membership from `/proc` by PGID with a min-starttime scope; `signalPidOnly()` rechecks starttime+PGID; unknown/stale ownership is failure (`probe-observer.mjs` 170-265) |
| terminal close / child exit cancels escalation | terminal requires zero live owned (including discovered members) AND stdio closed; supervisor awaits group gone and escalates on child exit (`probe-observer.mjs` 312-336, `probe-surrogate-supervisor.mjs` 150-214) |
| limits not enforced | `record()` uses UTF-8 byte length (row <=64KiB, aggregate incl. supervisor channels <=1MiB); `accountChannel()`; `measureTreeBytes()` enforces <=4MiB owned scratch; `liveOwned()` enforces max4 (`probe-observer.mjs` 74-102, 207-234, 274-309) |
| cumulative reap intervals | one absolute `deadlineAt` per phase (`observer373-384` fixed): normal-close = start+2s; bootstrap-kill = killAt+3s+2s; finalize = min(hardDeadline, now+2s) (`probe-observer.mjs` 312-336) |
| smoke lifecycle/compat | `probe-preload.mjs` verifies pinned forks-worker SHA256, exact execArgv, execPath/cwd/stdio/serialization/env; relays request/response; observer requires ordered `start/started/run/testfileFinished` (+ optional `stop/stopped`) and fails on missing/unexpected/out-of-order (`probe-observer.mjs` 539-580, `probe-preload.mjs` 44-170) |

## F‴ corrections against the d92e672a adverse rows

Every row is a static control-flow change to `probe-observer.mjs`; no Q
execution.

| d92e672a adverse row | F‴ correction |
| --- | --- |
| `pendingFailure` poisons `liveOwned`, so ceiling failures skip owned kill and reap | failure is now a non-gating `failure` record (`noteFailure`); `liveOwned()` never throws and never consults failure; `finalize()` always runs `killOwnedGroups()` when requested; no fabricated terminal success (exit 3 on any failure) |
| `owned.size` ceiling excludes the observer | `totalProcessCount() = owned.size + 1`; ceiling is `> maxProcesses` (max4 total); `PROCESS_CEILING` noted but enumeration still returns all owned for cleanup |
| `killOwnedGroups` signals saved PGIDs without renewed validation | `groupHasVerifiedMember(pgid)` re-reads `/proc` at signal time and requires a live member with matching recorded PID/starttime/current PGID or owned ancestry under the min-starttime scope; otherwise the signal is refused and recorded |
| extra 250ms + a fresh finalize `<=2s` window | `awaitTerminal` has no sub-window; `finalize` uses one shared `deadlineAt` (`min(hardDeadline, phase deadline)`), so no cumulative interval |
| scratch ceiling detected only after writing | `writeEvidence()` budgets `current + payload` against 4MiB before writing; on overflow it writes only a bounded truncation marker and never exceeds the cap |
| final doc `...extra` can overwrite measured terminal | authoritative measured fields (`terminal`, `liveOwned`, `rescueUsed`, `unknownOwnership`, `totalProcesses`, `failureCode`, limits, byte counts) are placed after `...extra` |

Residual (UNPROVED, documented): a metadata-only `/proc` revalidation immediately
before `kill(-pgid)` cannot eliminate a PID/PGID-reuse race between the check and
the signal; no pidfd is available to this probe. This is a static limitation, not
a runtime proof.

## Q′ corrections against the accepted THE-581 contract (RC-1..RC-4)

This revision implements the Chief-reviewed, remotely published
[q-correction-contract-f038eae8](/THE/issues/THE-581#document-q-correction-contract-f038eae8)
(Homelab PR28, full pushed SHA `ff72966413f55850e8ce7660da2e7ef9160e896f`). Q
changes only; host F/M bytes are unchanged. The new source commit that carries
Q′ is reported with its full SHA in the THE-574 thread and PR3 readback.

| Contract | Correction | Path |
| --- | --- | --- |
| RC-1 supervisor terminal ≤2 s incl. 500 ms | one absolute `D = proofStart + 2000`; `SIGKILL` at `min(proofStart+500, D)`; poll sleeps never past `D`; at `D` returns the measured verdict with no post-deadline await; no signal without full member verification | `probe-surrogate-supervisor.mjs` `terminalProof` |
| RC-2 reserved bounded cleanup inside hard 10 s | hard trigger at `t0+8000` reserves the 10 s tail; `rescueAndReap()` used by every failure/residual path; single `finalize` clamp `min(deadlineAt ?? now+2000, now+2000, hardDeadlineAt)`; normal-close single 2 s, bootstrap-kill kill before the last 2 s; pipe closure from `close`, not `destroyed` | `probe-observer.mjs` `rescueAndReap`/`finalize`/`awaitTerminal` |
| RC-3 numeric fail-closed ownership | numeric `starttime` parsing; `/proc` read errors latch `unknownVisibility` (never "no members"); adoption only by recorded PID+starttime+PGID or fresh ancestry; reuse detection; group signal only when every visible member verifies; signal revalidation immediately before each kill | `probe-observer.mjs` `procStat`/`visibleMembers`/`groupFullyVerified`/`killOwnedGroups`; `probe-surrogate-supervisor.mjs` `visibleMembers`/`groupFullyVerified` |
| RC-4 canonical unique scratch and ≤4 MiB every write | canonical/realpath/ownership/mode checks; exclusive non-recursive `mkdir`; `markerReserveBytes` reserved and re-checked; `O_CREAT\|O_EXCL\|O_WRONLY\|O_NOFOLLOW` evidence writes; symlink inside `probe/` is a layout failure; HOME/TMPDIR measurable | `probe-observer.mjs` scratch setup/`measureTreeBytes`/`writeEvidence`/`writeFileNoFollow` |

Path coverage: normal close and bootstrap-only death (self-expiry vs rescue),
setup/negative limits, output/row/process/scratch ceilings, open pipes, deadline
races and separately-labelled observer rescue are mapped in the contract §3 and
implemented here. `terminalSuccess` requires `!failure`, `!unknownOwnership`,
`!unknownVisibility`, `!scratchLayoutFailure`, measured scratch ≤4 MiB, evidence
written and exit 0; rescue is never positive containment.

Documented remainder (UNPROVED, not a waiver): RC-3 check-to-signal atomicity is
not race-free with Node built-ins (no pidfd/cgroup); adversarial child growth
beyond 4 MiB is detectable but not preventable with built-ins — success requires
the measured cap, so no above-cap success is reported.

## Criterion-to-line map (THE-574, acceptance 3)

| Acceptance | Implemented at |
| --- | --- |
| FORCE_TTY empty, reject other/unknown | preload `WORKER_ENV_ALLOW`, `WORKER_ENV_ALLOWED_VALUE`, `assertWorkerEnv` |
| Closed worker env | preload `sanitizedWorkerBase`, `endowWorker` |
| Native config-loader pin | bootstrap `--configLoader native`; config docs |
| Ordered SSR `[node,production]` | config `ssr.resolve.conditions` |
| No `.vite-temp`/fallback widening | `nativeImportConfigFile` route only; loader `resolveViteEntry` root-link/ancestor refusal unchanged |
| Q observer/normal-close/bootstrap-kill | `probe-observer.mjs` `runSupervisorProbe`/`awaitTerminal`/`finalize`, `probe-surrogate-supervisor.mjs` |
| Q worker-smoke fixture/config/lifecycle | `probe-worker-smoke.test.mjs`, `probe-worker-smoke.vitest.config.mjs`, `probe-preload.mjs`, observer `validateLifecycle` |
| Ownership/PID/starttime/PGID/scope binding | observer `remember`/`liveOwned`/`signalPidOnly`/`killOwnedGroups`; supervisor `groupMembers`/`signalGroup` |
| Negative/setup/rescue paths fail closed | observer `finalize` (killOwned), `ProbeFail`/`pendingFailure`, `safeRecord` |
| Limits (10s/4proc/1MiB/64KiB/4MiB) | observer `LIMITS`, `record`, `accountChannel`, `measureTreeBytes`, `liveOwned` |
| rescue never positive | observer rescue rows + `terminalWithoutRescue`/`terminalProofOk`; outcomes `*-rescue` |
| parentDeathProof:null intact | manifest `containment.parentDeathProof`; bootstrap exit 7; Q `parentDeathProof: null` |

## Closure differences from F=0cd724f7

- `frozen-validator-bootstrap.mjs`: added `--configLoader native` to the exact
  main Vitest child argv (sha `172da41b...`).
- `frozen-validator-preload.mjs`: added the single admissible `FORCE_TTY=""`
  key/value and closed-base `FORCE_TTY:""` (sha `dcc9fd51...`).
- `frozen-validator.vitest.config.mjs`: added explicit `ssr.resolve.conditions`
  `[node, production]` (sha `a5bed0ce...`).
- `frozen-validator.manifest.json`: updated the three host blob/SHA pins
  (M″ `d2ccdee9...`).
- New `frozen-validator-probe/` Q sources (six files above).
- Unchanged: `frozen-validator-loader.mjs`, `frozen-validator-independent.test.ts`,
  and every C/B role pin.

### F″ vs F′ (`c0a7d4a8`)

Changed Q only (host/M″ unchanged): `probe-observer.mjs`, `probe-preload.mjs`,
`probe-surrogate-supervisor.mjs`. Unchanged Q: `probe-surrogate-child.mjs`,
`probe-worker-smoke.test.mjs`, `probe-worker-smoke.vitest.config.mjs`.

### F‴ vs F″ (`d92e672a`)

Changed Q only (host/M‴ unchanged): `probe-observer.mjs`
(`d211ed737ea34083d75b0155d902bbfa962afa02` /
`4929a79ff9efb6b98fa9680d667c98e7d471125ec7b479f8baadf602324f58f1`). All other Q
and host bytes unchanged.

### Q′ vs F‴ (`f038eae8`) — THE-581 RC-1..RC-4

Changed Q only (host/M unchanged): `probe-observer.mjs`
(`f8de97ba09a242e96c79b0c97829728d06095d9e` /
`c111f82a66c9f4ac493ef47e7923a440e3c6ff100f35d54ac6c1c05c1f4f81a4`) and
`probe-surrogate-supervisor.mjs`
(`b2a30883f1cf9e9486273d43de269eb232b5c406` /
`77331c89f2257a28cd01d5d731939cc61a1f8e5022dd7d2a2279048f99810025`). Unchanged Q:
`probe-preload.mjs`, `probe-surrogate-child.mjs`, `probe-worker-smoke.test.mjs`,
`probe-worker-smoke.vitest.config.mjs`. F/M host pins and M `d2ccdee9…` unchanged.



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

F‴ = corrected host commit; M‴ = `d2ccdee9b1a31c64ee6361140c5e7c2e0f86f7b82ebe2755579640c7a05715d0`;
N = certified Node path. All are pending Verification binding.

```text
/home/nigel/.local/bin/mem-bounded 4G --estimate 600 --reserve 180 --run-budget 1800 --max-duration 600 --product-sha 29bf67512aabd7b461a30e546c195e28c37f219e --cases the-560-validator-independent-candidate -- <N> <H>/server/src/__tests__/frozen-validator-bootstrap.mjs --role candidate --host-sha <F‴> --manifest-sha256 <M‴> --node <N>

/home/nigel/.local/bin/mem-bounded 4G --estimate 600 --reserve 180 --run-budget 1800 --max-duration 600 --product-sha 871532c335bb8c0f501a200201f4e4ac1fc63fb0 --cases the-560-validator-independent-base -- <N> <H>/server/src/__tests__/frozen-validator-bootstrap.mjs --role base --host-sha <F‴> --manifest-sha256 <M‴> --node <N>
```

Child argv (unchanged plus the native config-loader pin): `<N> --import
<H>/server/src/__tests__/frozen-validator-preload.mjs
<H>/node_modules/vitest/vitest.mjs run --configLoader native --config
<H>/server/src/__tests__/frozen-validator.vitest.config.mjs --pool=forks
--maxWorkers=1 --no-file-parallelism
<H>/server/src/__tests__/frozen-validator-independent.test.ts`.

Q probe argv (one canonical Q path/full commit + SHA256; replace `<Q>` before any
matcher/application; three serialized invocations, no shell chain; cwd H):

```text
/home/nigel/.local/bin/mem-bounded 4G --estimate 600 --reserve 180 --run-budget 1800 --max-duration 600 --product-sha 0cd724f789ce48d495e8b22e5a9b413b6b942ecf --cases the-573-probe-normal-close -- <N> <Q> normal-close
/home/nigel/.local/bin/mem-bounded 4G --estimate 600 --reserve 180 --run-budget 1800 --max-duration 600 --product-sha 0cd724f789ce48d495e8b22e5a9b413b6b942ecf --cases the-573-probe-bootstrap-kill -- <N> <Q> bootstrap-kill
/home/nigel/.local/bin/mem-bounded 4G --estimate 600 --reserve 180 --run-budget 1800 --max-duration 600 --product-sha 0cd724f789ce48d495e8b22e5a9b413b6b942ecf --cases the-573-probe-worker-smoke -- <N> <Q> worker-smoke
```

All v5 helper hash/max4G/identity/admission`600/180/1800/600`/min780s/shared
`heavy.lock` serialization rules are unchanged. No schema accepts invented proof
or permission, and no native load/export branch is widened.

## Honest limits

- Not executed. No fixture, module, native, helper, Q payload, Vitest, Vite,
  build or product load. All Q/F bytes are static and unproved at runtime.
- F‴, M‴ and Q are published; N and the detached parent-death containment remain
  explicitly held prerequisites. `parentDeathProof` stays `null`; the fixture
  refuses before any child (exit 7) and Q always reports containment
  `unproved`. The Q containment observations are expected negative with the
  current topology and are never a runtime PASS.
- Framework/native/IPC runtime compatibility remains UNPROVED: the Vitest
  `--experimental-import-meta-resolve`/`--require`/`--conditions`/IPC composition,
  Vite effective config and `module-sync`/external import behavior, resolved
  config conditions and worker option compatibility were read from source, not
  executed.
- Native ABI/linker/thread/bootstrap-containment gaps remain open: rolldown and
  lightningcss platform binaries, the rust `ldd`/`process.report` selection and
  `/tmp/rolldown-1.2.5` WASI fallback (excluded, not granted), optional
  non-host platform packages and fsevents, and Node's lower-level fork
  expansion/IPC descriptor/thread effects. Effective Verification authority for
  the exact commands is still a Board-only read-back, not supplied here.
- Full third-party/native/conditional export and workspace dependency closure
  remains owned by [THE-563](/THE/issues/THE-563); this design does not certify it.
- The ledger traces are illustrative static arithmetic, not measured Git totals.
- [THE-559](/THE/issues/THE-559)/[THE-560](/THE/issues/THE-560) and the original
  repair/activation/merge remain held. Independent recertification is a separate
  Chief-direct successor.

## Rollback

Revert the task branch commit or delete the added host files. No product source,
frozen candidate/base byte, policy, infrastructure or installed dependency is
modified. C/B remain immutable.
