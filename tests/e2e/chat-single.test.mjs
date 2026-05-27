import { loadTestEnv, requireEnv } from "../lib/env.mjs";
import {
  createTestAccessToken,
  runChatStream,
} from "../lib/chat-client.mjs";

const env = loadTestEnv();
requireEnv(env, ["supabaseUrl"]);

const message =
  process.argv[2] ??
  "Who is on the C-suite of Stripe? Find their emails and draft a partnership outreach email.";
const model = process.argv[3] ?? env.defaultModel;

console.log("Creating test user…");
const token = await createTestAccessToken(
  env.supabaseUrl,
);

console.log(`Sending chat (model=${model})…\n`);
const result = await runChatStream({
  supabaseUrl: env.supabaseUrl,
  accessToken: token,
  message,
  model,
});

console.log("=== Tool steps ===");
for (const s of result.toolSteps) {
  const failed = s.success === false ? " (failed)" : "";
  console.log(`  [${s.type}] ${s.label ?? s.tool}${failed}`);
}

console.log("\n=== Assistant response (first 2000 chars) ===");
console.log(result.content.slice(0, 2000));
if (result.content.length > 2000) {
  console.log(`\n… (${result.content.length} total chars)`);
}

console.log("\n=== Result ===");
console.log("Elapsed:", (result.elapsedMs / 1000).toFixed(1) + "s");
console.log(
  "Invalid JSON error:",
  result.hasInvalidJson ? "YES — FAIL" : "NO — OK",
);
console.log("Response length:", result.content.length);

const pass =
  !result.hasInvalidJson &&
  result.content.length >= 100 &&
  /stripe|ceo|cfo|cto|chief|collison|president/i.test(result.content);

process.exit(pass ? 0 : 1);
