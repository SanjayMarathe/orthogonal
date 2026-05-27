#!/usr/bin/env node
/** @deprecated Use TEST_E2E=1 npm run test:e2e:suite */
import { spawnSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, "../tests/e2e/chat-suite.test.mjs");
const run = spawnSync("node", [target, "--run"], { stdio: "inherit" });
process.exit(run.status ?? 1);
