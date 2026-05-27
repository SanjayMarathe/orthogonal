/**
 * Batch E2E chat prompts against deployed Supabase + Groq.
 * Usage: node tests/e2e/chat-suite.test.mjs
 * Set TEST_E2E=1 or pass --run to force; skipped by default in npm test.
 */

import { loadTestEnv, requireEnv } from "../lib/env.mjs";
import {
  getAnonymousAccessToken,
  runChatStream,
} from "../lib/chat-client.mjs";

const force =
  process.env.TEST_E2E === "1" || process.argv.includes("--run");

if (!force) {
  console.log(
    "Skipping E2E suite (set TEST_E2E=1 or pass --run). Each case calls live LLM + APIs.",
  );
  process.exit(0);
}

const env = loadTestEnv();
requireEnv(env, ["supabaseUrl", "supabaseAnonKey"]);

const CASES = [
  {
    name: "Amazon C-suite (agent loop)",
    prompt: "Who is on the C-suite of Amazon? What are their contacts?",
    minLen: 200,
    mustMatch: /amazon|vice president|cto|chief/i,
  },
  {
    name: "Stripe C-suite + email ask",
    prompt:
      "Who is on the C-suite of Stripe? Find their emails and draft a partnership outreach email.",
    minLen: 150,
    mustMatch: /stripe|ceo|cfo|chief|collison|draft/i,
  },
  {
    name: "Notion sales research",
    prompt:
      "Research Notion as a sales target: headcount, funding, and key decision makers.",
    minLen: 120,
    mustMatch: /notion|headcount|funding|employee|decision|revenue/i,
    forbid: /Invalid JSON|"success":\s*true,\s*"data":\s*\{/i,
  },
  {
    name: "Multi-step company research",
    prompt:
      "Compare the headcount and recent funding of OpenAI vs Anthropic using real API data.",
    minLen: 100,
    mustMatch: /openai|anthropic|headcount|funding|employee/i,
  },
  {
    name: "Tagged API @crustdata",
    prompt:
      "@crustdata List the CEO and CFO of Microsoft with any contact info available.",
    minLen: 100,
    mustMatch: /microsoft|ceo|cfo|chief/i,
  },
];

console.log("Signing in anonymously…");
const token = await getAnonymousAccessToken(
  env.supabaseUrl,
  env.supabaseAnonKey,
);

const results = [];

for (const c of CASES) {
  console.log("\n" + "=".repeat(72));
  console.log("TEST:", c.name);
  console.log("=".repeat(72));

  // Stagger to reduce edge cold-start / rate limits
  await new Promise((r) => setTimeout(r, 5000));

  try {
    const result = await runChatStream({
      supabaseUrl: env.supabaseUrl,
      accessToken: token,
      message: c.prompt,
      model: env.defaultModel,
      timeoutMs: 180_000,
    });

    const contentOk =
      result.content.length >= c.minLen && c.mustMatch.test(result.content);
    const forbidOk = !c.forbid || !c.forbid.test(result.content);
    const pass = contentOk && forbidOk && !result.hasInvalidJson;

    console.log("\n=== Response preview ===");
    console.log(result.content.slice(0, 800));
    console.log(
      `\n>>> ${pass ? "PASS" : "FAIL"} (${(result.elapsedMs / 1000).toFixed(1)}s, ${result.content.length} chars, tools=${result.toolSteps.filter((s) => s.type === "done").length})\n`,
    );

    results.push({
      name: c.name,
      pass,
      elapsed: result.elapsedMs,
      len: result.content.length,
    });
  } catch (err) {
    console.error("ERROR:", err.message);
    results.push({ name: c.name, pass: false, error: err.message });
  }
}

console.log("\n" + "=".repeat(72));
console.log("SUMMARY");
console.log("=".repeat(72));
for (const r of results) {
  console.log(
    `${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.len != null ? ` (${r.len} chars)` : ""}${r.error ? ` — ${r.error}` : ""}`,
  );
}

process.exit(results.every((r) => r.pass) ? 0 : 1);
