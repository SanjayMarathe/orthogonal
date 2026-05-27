#!/usr/bin/env node
/**
 * Unified test runner for the Orthogonal platform.
 *
 * Default (npm test): unit + integration + frontend build
 * TEST_E2E=1 npm test — also runs live chat E2E suite
 * TEST_CATALOG=1 npm test — full catalog get_details smoke (slow)
 */

import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function run(name, cmd, args, opts = {}) {
  console.log(`\n${"=".repeat(72)}\n▶ ${name}\n${"=".repeat(72)}`);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (result.status !== 0) {
    console.error(`\n✗ ${name} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
  console.log(`✓ ${name}`);
}

// 1. Unit tests (edge shared modules + frontend lib)
run("Unit tests", "node", [
  "--experimental-strip-types",
  "--test",
  "tests/unit/*.test.ts",
  "tests/unit/*.test.mjs",
]);

// 3. Integration tests (live Supabase + Orthogonal when env present)
run("Integration tests", "node", ["--test", "tests/integration/*.test.mjs"]);

// 4. Frontend production build
run("Frontend build", "npm", ["run", "build", "--prefix", "frontend"]);

if (process.env.TEST_CATALOG === "1") {
  run("Catalog smoke (all APIs)", "node", [
    "tests/integration/catalog-smoke.mjs",
  ]);
}

if (process.env.TEST_E2E === "1") {
  run("E2E chat suite", "node", ["tests/e2e/chat-suite.test.mjs", "--run"]);
}

if (process.env.TEST_E2E_APIS === "1") {
  run("E2E API matrix (all @slug prompts)", "node", [
    "tests/e2e/chat-api-matrix.test.mjs",
    "--run",
  ]);
}

if (process.env.TEST_API_MATRIX === "1") {
  run("API matrix integration (details + run)", "node", [
    "--test",
    "tests/integration/api-matrix.test.mjs",
  ]);
}

console.log("\n" + "=".repeat(72));
console.log("All selected tests passed.");
if (process.env.TEST_E2E !== "1") {
  console.log("Tip: TEST_E2E=1 npm test — run live LLM chat E2E suite");
}
if (process.env.TEST_CATALOG !== "1") {
  console.log("Tip: TEST_CATALOG=1 npm test — smoke every catalog API slug");
}
if (process.env.TEST_API_MATRIX !== "1") {
  console.log(
    "Tip: TEST_API_MATRIX=1 npm test — get_details + /run for all 55 APIs",
  );
}
if (process.env.TEST_E2E_APIS !== "1") {
  console.log(
    "Tip: TEST_E2E_APIS=1 npm test — E2E chat for every @slug (slow, uses credits)",
  );
}
console.log("=".repeat(72));
