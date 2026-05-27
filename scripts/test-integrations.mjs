#!/usr/bin/env node
/** @deprecated Use TEST_CATALOG=1 node tests/integration/catalog-smoke.mjs */
import { spawnSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, "../tests/integration/catalog-smoke.mjs");
const run = spawnSync("node", [target], { stdio: "inherit" });
process.exit(run.status ?? 1);
