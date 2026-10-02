/**
 * Frozen validator Vitest config (THE-567, corrective contract v4).
 *
 * Plain .mjs. Root is H, one literal fixture include, no projects, no app setup
 * files, single forked worker. Timeouts derive from the manifest ceilings.
 * STATIC / UNEXECUTED.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(HERE, "frozen-validator.manifest.json");
const PRELOAD = path.join(HERE, "frozen-validator-preload.mjs");
const TEST_FILE = path.join(HERE, "frozen-validator-independent.test.ts");

const ceilings = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")).ceilings;

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
    testTimeout: ceilings.testTimeoutMs,
    hookTimeout: ceilings.hookTimeoutMs,
    teardownTimeout: ceilings.teardownTimeoutMs,
    coverage: { enabled: false },
  },
};
