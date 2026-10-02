/**
 * Frozen validator Vitest config (THE-567 corrected static publication).
 *
 * Plain .mjs object export. No projects, no app setup files, one literal
 * fixture include, single forked worker. The worker execArgv carries only the
 * pinned preload so every worker repeats the guards before product load.
 *
 * Proposed static interface; the pinned Vitest 4.1.11 option shapes are
 * asserted statically, not executed here.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_ROOT = path.resolve(HERE, "../../..");
const PRELOAD = path.join(HERE, "frozen-validator-preload.mjs");
const TEST_FILE = path.join(HERE, "frozen-validator-independent.test.ts");

export default {
  root: HOST_ROOT,
  test: {
    include: [TEST_FILE],
    projects: false,
    setupFiles: [],
    environment: "node",
    isolate: true,
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--import", PRELOAD],
        minWorkers: undefined,
      },
    },
    maxWorkers: 1,
    minWorkers: undefined,
    maxConcurrency: 1,
    fileParallelism: false,
    watch: false,
    sequence: { concurrent: false, hooks: "list" },
    testTimeout: 15000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
    coverage: { enabled: false },
  },
};
