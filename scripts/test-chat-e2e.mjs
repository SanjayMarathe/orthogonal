#!/usr/bin/env node
/** @deprecated Use tests/e2e/chat-single.test.mjs or npm run test:e2e */
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, "../tests/e2e/chat-single.test.mjs");
const args = [target, ...process.argv.slice(2)];
const run = spawnSync("node", args, { stdio: "inherit" });
process.exit(run.status ?? 1);
