# Frozen independent validator fixture — corrected static publication (THE-567)

Static authoring/publication only. This document and the host modules described
below are a **proposal**. They prove no executed fixture correctness and no
candidate acceptance. Independent certification of these static bytes is
[THE-564](/THE/issues/THE-564); runtime QA is [THE-560](/THE/issues/THE-560).

This revision supersedes the prior publication at
`ce5d101809f7d9546eebe0ae2a6a04b532b807b1` (fixture blob
`e30a10977d60c50340b1935dcb313f8421151da1`, evidence blob
`f27a4401f483784a8a093b16e18dd24bd0e250cc`). It implements the corrections in
fixture-review revision `7f08a0ca-1101-4e43-ab0d-0a24154d3e6b` against the
Reliability interface [isolated-import-design](/THE/issues/THE-565#document-isolated-import-design)
revision `0f054523-3cef-4caa-b840-4d1e36ead7a7`.

## Three independent identities

Prefix `P=/home/nigel/projects/homelab/.paperclip-source-pins/2026.916.1`.

| Role | `projectWorkspaceId` | cwd | Required HEAD |
| --- | --- | --- | --- |
| host H | `81f2e6d8-cbd7-4ee9-9fb3-d18f6c6587ec` | `P/validator-fixture-authoring` | corrected publication F (unknown until commit) |
| candidate C | `ce40ac7f-561a-46f2-9062-9cf298522cc3` | `P/validator-frozen-verify` | `29bf67512aabd7b461a30e546c195e28c37f219e` |
| base B | `068e96a3-13b3-45ef-b06f-be01f4c33487` | `P/validator-frozen-base` | `871532c335bb8c0f501a200201f4e4ac1fc63fb0` |

C and B are frozen and immutable. The fixture must not test H as if it were C.
No overlay/copy into C/B, no NODE_PATH bridge, no installed-source borrowing.

## Host files added/corrected (all in H)

| File | Git blob | SHA256 |
| --- | --- | --- |
| `server/src/__tests__/frozen-validator-loader.mjs` | `c880165dae72dea4a131ee7db9f896db33aaa7ac` | `2d964fe76f3b3d4e2b8dcdb01ae72d650e2037d2422b925efdddfaee39593d45` |
| `server/src/__tests__/frozen-validator-bootstrap.mjs` | `2624a1516f46b63a484d64cdf6f7887340481f2b` | `5c1d6e8ca6687272f10e981a7d6c10d6e76f2aaea90396f5428bf34d536f9de2` |
| `server/src/__tests__/frozen-validator-preload.mjs` | `422f2ed719d224f13236e453b6eb1816d8d78ba9` | `2c77a8fac2726c834712048263d9636f9f2889e8d182579bbd0f6d750423649f` |
| `server/src/__tests__/frozen-validator.vitest.config.mjs` | `4135df57bdd73227c2c78fc0928c1682238ee0de` | `4254d9dd9b007d966406fb43d8f66540d63c7ec646085c484293930e4fbdbeda` |
| `server/src/__tests__/frozen-validator-independent.test.ts` | `57dca01a29301de981feaa42ffc2c6cb2437f0a7` | `b6f695779ca4ee1fbba9a7ab340152618ff52d9f2b780df05f2a6d984c872d8b` |
| `server/src/__tests__/frozen-validator.manifest.json` | `0819a11ad73605b289aba483b99844146d4adf9a` | `c94a2bd04571d151c59ffaf36cdbd090b339a6f8fead03420d353ee6efba363d` |

The manifest does not hash itself recursively and does not claim its own commit.
Verification pins it externally as M and pins the host commit as F.

## Role/closure bindings in the manifest

Candidate and base each list `workspaceId`, `cwd`, `revision`, and per-file
`blob`+`sha256` for `server/src/services/heartbeat.ts`, `server/src/home-paths.ts`,
`server/package.json`, `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`,
`server/vitest.config.ts`, and `packages/paperclip-runner/src/index.ts`. Heartbeat:
C `47586831…`/`cbdfeedb…`, B `76293aca…`/`c668a1e6…`. Home-paths is shared:
`4ec29915…`/`1b36cc65…`. Pinned toolchain: Node 24.21.0, pnpm 9.15.4, Vitest
4.1.11, Vite 8.2.2.

## Guard order (before any mkdir/mkdtemp or product/Vitest/Vite import)

1. Role is exactly `candidate` or `base`. Fixed env `PC_FROZEN_VALIDATOR_ROLE`,
   `PC_FROZEN_VALIDATOR_HOST_SHA`, `PC_FROZEN_VALIDATOR_MANIFEST_SHA256` must
   equal certified inputs. No arbitrary ROOT/CASE_LOG/scratch/env-ceiling override.
2. H top-level equals the containing host, H HEAD equals F, manifest SHA256 equals
   M, and every pinned host file matches its Git blob and SHA256 (checked via the
   bounded counted Git read path).
3. Nonempty absolute injected `PAPERCLIP_RUN_SCRATCH_DIR` and `TMPDIR`: canonical
   existing real directories, owned by the executing UID, not symlink aliases, not
   inside an enclosing Git repository, and disjoint from H/C/B in both directions.
4. Owned role dirs `scratch/frozen-validator/<role>/{repos,cache,output,home}`;
   case log fixed at `output/cases.jsonl`. Unknown role or empty scratch refuses.
5. Refuse foreign `NODE_PATH`/`NODE_OPTIONS`, observability endpoints and DSNs.
6. Only then create owned role directories, and only then load the subject.

The worker preload repeats guards 1–5 in the fork before any product load.
The subject is loaded via the host loader's fresh Vite SSR instance
(`configFile=false`, `envFile=false`, `appType=custom`, `middlewareMode=true`,
`hmr=false`, `ws=false`, `watch=null`, owned `cacheDir`), with the exact
`/^@paperclipai\/paperclip-runner$/` alias, an own-built `/live` alias,
`ssr.noExternal=/^@paperclipai\//`, and a closure-audit plugin that refuses
host/ancestor module targets. `ssrLoadModule` is called only for the absolute
selected-subject `server/src/services/heartbeat.ts` and `server/src/home-paths.ts`
with `{fixStacktrace:false}`; the server closes in `finally`. The host's own
heartbeat is never imported.

## Corrections applied

1. No top-level product import; loader-bound subject after guards. `describe.skip`
   fallback removed.
2. Distinct H/C/B identity; no host=subject HEAD, overlay or borrowing; separate
   fully expanded candidate/base templates below.
3. Canonical injected scratch validation before any mutation or load; empty refuses.
4. Fixed contained output; exact Git argv templates and forbidden scope flags;
   setup cwd must stay under the owned repos root.
5. Kept the descendant refusal case; added a genuine linked-root branch drift case
   (`providerRef=persisted=effective=root`) asserting the wrapper reason plus the
   underlying `branch_mismatch` reasonCode, recorded in the case log.
6. Root A/B, nested and escaping-symlink rows omit the pin and use neutral remotes;
   they record observed top-level/HEAD. Pin security tests stay separate.
7. Fixed aggregate Git ceiling 600 including guard/setup/subject reads, 15000 ms
   and 1 MiB per call, role stdio 8 MiB, case log 4 MiB, row 64 KiB, supervised
   child tree with IPC Git accounting and hermetic Git env. No env overrides.

## Case matrix retained

30 prior cases plus the added linked-root branch-drift case (31 total): genuine
ordinary/linked roots and descendants; paired B root-positive / B descendant
`missing_git_metadata` / C descendant success; non-repo; persisted/effective/
provider/workspace-binding and branch refusals; authoritative A/B; matching/
missing/mismatched origin; nested/direct nested; inside/escaping symlinks;
divergent/unresolved/ancestor/exact/behind pins; ordinary+linked direct-`.git`
bypass and fake empty/malformed `.git`. Eleven C predicted-red assertions and the
inherited B direct-`.git` reds remain explicit security findings, not waivers.

## Token templates (not execution permission)

Both run from H. F = corrected host commit; M = manifest SHA256; N = certified
Node absolute path. All are pending Verification/publication inputs and must not
be guessed.

```text
/home/nigel/.local/bin/mem-bounded 4G --estimate 600 --reserve 180 --run-budget 1800 --max-duration 600 --product-sha 29bf67512aabd7b461a30e546c195e28c37f219e --cases the-560-validator-independent-candidate -- <N> <H>/server/src/__tests__/frozen-validator-bootstrap.mjs --role candidate --host-sha <F> --manifest-sha256 <M> --node <N>

/home/nigel/.local/bin/mem-bounded 4G --estimate 600 --reserve 180 --run-budget 1800 --max-duration 600 --product-sha 871532c335bb8c0f501a200201f4e4ac1fc63fb0 --cases the-560-validator-independent-base -- <N> <H>/server/src/__tests__/frozen-validator-bootstrap.mjs --role base --host-sha <F> --manifest-sha256 <M> --node <N>
```

Child argv: `<N> --import <H>/server/src/__tests__/frozen-validator-preload.mjs
<H>/node_modules/vitest/vitest.mjs run --config
<H>/server/src/__tests__/frozen-validator.vitest.config.mjs --pool=forks
--maxWorkers=1 --no-file-parallelism
<H>/server/src/__tests__/frozen-validator-independent.test.ts`.
Pinned Vitest 4.1.11 exposes no `minWorkers`.

## Unresolved inputs and honest limits

- Not executed. No fixture, Vitest, Vite, helper, install, build or product load.
- F, M and N are not yet published/certified; the templates are not literal.
- H has no proved installed dependency closure (Vite/Vitest/db/shared/adapter-utils/
  runner/native). Full third-party, native and conditional-export resolution and
  the host bootstrap/preload/loader graphs remain UNPROVED. Reliability owns the
  bounded host/base dependency preparation after corrected pins.
- Case 13 (`branch.descendant-root.refuse`) reports the wrapper
  `git_worktree_branch_mismatch` with an underlying `wrong_repository_root`, recorded
  honestly; the new drift case proves the true `branch_mismatch` path.
- The run-owned scratch must not itself be inside a Git repository.

## Rollback

Revert the task branch commit or delete the added host files. No product source,
policy, infrastructure, frozen candidate/base byte or installed dependency is
modified. C/B remain immutable.
