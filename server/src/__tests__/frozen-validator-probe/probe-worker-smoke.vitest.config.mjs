/**
 * Frozen-validator Q probe — worker-smoke Vitest config (THE-574).
 *
 * SOURCE-ONLY PROPOSAL. Explicitly reviewed derivative of the F plain .mjs
 * config: one literal Q fixture, no projects/setup/coverage/watch, one fork,
 * closed env, explicit ordered SSR [node, production], native config-loader
 * forwarding supplied on argv. Built-ins only; no product import.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_ROOT = path.resolve(HERE, "../../../..");
const TEST_FILE = path.join(HERE, "probe-worker-smoke.test.mjs");
const PRELOAD = path.join(HERE, "probe-preload.mjs");

export default {
  root: HOST_ROOT,
  ssr: {
    resolve: {
      conditions: ["node", "production"],
    },
  },
  test: {
    include: [TEST_FILE],
    projects: false,
    setupFiles: [],
    environment: "node",
    isolate: true,
    pool: "forks",
    execArgv: ["--import", PRELOAD],
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
    coverage: { enabled: false },
  },
};
