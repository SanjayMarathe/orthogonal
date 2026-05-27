/**
 * E2E chat tests: every @slug — capability intro + live execute prompt.
 *
 * Usage:
 *   TEST_E2E_APIS=1 node tests/e2e/chat-api-matrix.test.mjs --run
 *   TEST_API_SLUG=perplexity TEST_E2E_APIS=1 node tests/e2e/chat-api-matrix.test.mjs --run
 *   TEST_E2E_PHASE=capability TEST_E2E_APIS=1 node tests/e2e/chat-api-matrix.test.mjs --run
 *
 * Phases:
 *   capability — @slug what can you do? (fast, no LLM tool loop)
 *   execute    — tagged live-data prompt
 *   all        — both (default)
 */

import { loadTestEnv, requireEnv } from "../lib/env.mjs";
import {
  createTestAccessToken,
  runChatStream,
} from "../lib/chat-client.mjs";
import {
  API_TEST_MATRIX,
  filterMatrix,
  slugInContent,
} from "../lib/api-test-matrix.mjs";

const force =
  process.env.TEST_E2E_APIS === "1" || process.argv.includes("--run");

if (!force) {
  console.log(
    "Skipping API matrix E2E (set TEST_E2E_APIS=1 or pass --run). " +
      "55 APIs × 2 phases can take 30–90 min and uses live credits.",
  );
  process.exit(0);
}

const env = loadTestEnv();
requireEnv(env, ["supabaseUrl"]);

const slugFilter = process.env.TEST_API_SLUG?.toLowerCase();
const phase = process.env.TEST_E2E_PHASE ?? "all";
const matrix = slugFilter ? filterMatrix({ slug: slugFilter }) : API_TEST_MATRIX;
const staggerMs = Number(process.env.TEST_E2E_STAGGER_MS ?? 4000);
const timeoutMs = Number(process.env.TEST_E2E_TIMEOUT_MS ?? 180_000);

if (slugFilter && matrix.length === 0) {
  console.error(`Unknown TEST_API_SLUG: ${slugFilter}`);
  process.exit(1);
}

/** @type {Array<{ slug: string, phase: string, prompt: string, minLen: number, mustMatch?: RegExp, expectToolUse?: boolean }>} */
const cases = [];

for (const api of matrix) {
  if (phase === "all" || phase === "capability") {
    cases.push({
      slug: api.slug,
      phase: "capability",
      prompt: api.capabilityPrompt,
      minLen: 40,
      mustMatch: new RegExp(api.slug.replace(/-/g, "[- ]?"), "i"),
    });
  }
  if ((phase === "all" || phase === "execute") && api.chatPrompt) {
    cases.push({
      slug: api.slug,
      phase: "execute",
      prompt: api.chatPrompt,
      minLen: api.chatMinLen ?? 60,
      mustMatch: api.chatMustMatch,
      expectToolUse: api.expectToolUse ?? false,
    });
  }
}

console.log("Creating test user…");
const token = await createTestAccessToken(
  env.supabaseUrl,
);
console.log(`Running ${cases.length} chat cases (${matrix.length} APIs, phase=${phase})…\n`);

const results = [];

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  if (i > 0) await new Promise((r) => setTimeout(r, staggerMs));

  console.log("=".repeat(72));
  console.log(`[${i + 1}/${cases.length}] ${c.slug} (${c.phase})`);
  console.log(`Prompt: ${c.prompt.slice(0, 100)}${c.prompt.length > 100 ? "…" : ""}`);

  try {
    const result = await runChatStream({
      supabaseUrl: env.supabaseUrl,
      accessToken: token,
      message: c.prompt,
      model: env.defaultModel,
      timeoutMs,
    });

    const toolUses = result.toolSteps.filter((s) => s.type === "done");
    const slugToolOk = toolUses.some(
      (s) =>
        s.success !== false &&
        (s.label?.toLowerCase().includes(c.slug) ||
          s.tool?.toLowerCase().includes("orthogonal")),
    );

    const contentOk =
      result.content.length >= c.minLen &&
      (!c.mustMatch || c.mustMatch.test(result.content)) &&
      (c.phase === "capability"
        ? slugInContent(c.slug, result.content) || c.mustMatch.test(result.content)
        : true);

    const toolOk = !c.expectToolUse || slugToolOk;
    const pass = contentOk && toolOk && !result.hasInvalidJson;

    console.log(
      `\n>>> ${pass ? "PASS" : "FAIL"} (${(result.elapsedMs / 1000).toFixed(1)}s, ${result.content.length} chars, tools=${toolUses.length})`,
    );
    if (!pass) {
      console.log("Preview:", result.content.slice(0, 400));
      if (!toolOk) console.log("  (expected successful tool use for slug)");
    }

    results.push({
      slug: c.slug,
      phase: c.phase,
      pass,
      elapsed: result.elapsedMs,
      len: result.content.length,
    });
  } catch (err) {
    console.error("ERROR:", err.message);
    results.push({
      slug: c.slug,
      phase: c.phase,
      pass: false,
      error: err.message,
    });
  }
}

console.log("\n" + "=".repeat(72));
console.log("API MATRIX E2E SUMMARY");
console.log("=".repeat(72));

const bySlug = new Map();
for (const r of results) {
  if (!bySlug.has(r.slug)) bySlug.set(r.slug, {});
  bySlug.get(r.slug)[r.phase] = r.pass ? "PASS" : "FAIL";
}

for (const api of matrix) {
  const s = bySlug.get(api.slug) ?? {};
  const cap = s.capability ?? "—";
  const exe = s.execute ?? "—";
  console.log(`${api.slug.padEnd(20)} capability=${cap}  execute=${exe}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nTotal: ${results.length - failed.length}/${results.length} passed`);

process.exit(failed.length ? 1 : 0);
