import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogSearchPrompt,
  classifyIntentRules,
  intentPlanSummary,
} from "../../supabase/functions/_shared/intentRouter.ts";
import {
  isFollowUpAffirmation,
  resolveEffectiveUserQuery,
} from "../../supabase/functions/_shared/conversationContext.ts";
import type { ChatMessage } from "../../supabase/functions/_shared/types.ts";

test("classifyIntentRules routes OpenAI enterprise news to perplexity", () => {
  const plan = classifyIntentRules(
    "What is the latest news on OpenAI's enterprise product line?",
    [],
  );
  assert.ok(plan);
  assert.equal(plan!.intent, "web_search");
  assert.equal(plan!.directApis[0]?.slug, "perplexity");
  assert.equal(plan!.skipLlmToolRound, true);
  assert.doesNotMatch(plan!.catalogSearchPrompt, /openai/i);
});

test("buildCatalogSearchPrompt avoids entity names for web search", () => {
  const prompt = buildCatalogSearchPrompt(
    "web_search",
    "OpenAI enterprise product line news",
  );
  assert.match(prompt, /web search|perplexity|news/i);
  assert.doesNotMatch(prompt, /openai/i);
});

test("classifyIntentRules routes Shopify ICP to company_research", () => {
  const plan = classifyIntentRules(
    "Is Shopify a good ICP? Use headcount and leadership data.",
    [],
  );
  assert.ok(plan);
  assert.equal(plan!.intent, "company_research");
});

test("classifyIntentRules honors @perplexity tag", () => {
  const plan = classifyIntentRules("@perplexity Stripe launches this quarter", [
    "perplexity",
  ]);
  assert.ok(plan);
  assert.equal(plan!.directApis[0]?.slug, "perplexity");
  assert.equal(plan!.skipCatalogSearch, true);
});

test("classifyIntentRules routes popular creators to scrapecreators", () => {
  const plan = classifyIntentRules("what are the popular creators?", [], [
    "scrapecreators",
  ]);
  assert.ok(plan);
  assert.equal(plan!.directApis[0]?.slug, "scrapecreators");
  assert.notEqual(plan!.directApis[0]?.slug, "scrapegraphai");
});

test("classifyIntentRules routes popular creators without tag to scrapecreators", () => {
  const plan = classifyIntentRules("what are the popular creators?", []);
  assert.ok(plan);
  assert.equal(plan!.directApis[0]?.slug, "scrapecreators");
});

test("intentPlanSummary is readable", () => {
  const plan = classifyIntentRules("latest news on Stripe", []);
  assert.match(intentPlanSummary(plan!), /web_search.*perplexity/);
});

test("isFollowUpAffirmation detects pasted assistant text ending with do this", () => {
  const msg =
    "However, I can suggest searching for OpenAI on Orthogonal's search platform. do this";
  assert.equal(isFollowUpAffirmation(msg), true);
});

test("resolveEffectiveUserQuery ignores pasted assistant boilerplate", () => {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: "What is the latest news on OpenAI's enterprise product line?",
    },
    {
      role: "assistant",
      content: "No results. Try searching on Orthogonal.",
    },
    {
      role: "user",
      content:
        "However, I can suggest searching for OpenAI on Orthogonal's search platform. do this",
    },
  ];
  const resolved = resolveEffectiveUserQuery(
    messages,
    messages[2].content!,
  );
  assert.match(resolved, /OpenAI.*enterprise product line/i);
  assert.doesNotMatch(resolved, /Orthogonal's search platform/i);
});
