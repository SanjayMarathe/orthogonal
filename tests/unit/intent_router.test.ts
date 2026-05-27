import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogSearchPrompt,
  intentPlanSummary,
  planFromTaggedApis,
} from "../../supabase/functions/_shared/intentRouter.ts";
import {
  isFollowUpAffirmation,
  resolveEffectiveUserQuery,
} from "../../supabase/functions/_shared/conversationContext.ts";
import type { ChatMessage } from "../../supabase/functions/_shared/types.ts";

test("planFromTaggedApis routes @perplexity to Perplexity", () => {
  const plan = planFromTaggedApis("Stripe product launches", ["perplexity"]);
  assert.ok(plan);
  assert.equal(plan?.intent, "web_search");
  assert.equal(plan?.directApis[0]?.slug, "perplexity");
  assert.equal(plan?.skipCatalogSearch, true);
});

test("planFromTaggedApis routes @scrapecreators to Scrape Creators", () => {
  const plan = planFromTaggedApis("popular creators", ["scrapecreators"]);
  assert.ok(plan);
  assert.equal(plan?.directApis[0]?.slug, "scrapecreators");
  assert.equal(plan?.skipCatalogSearch, true);
});

test("buildCatalogSearchPrompt avoids entity names for web search", () => {
  const prompt = buildCatalogSearchPrompt(
    "web_search",
    "OpenAI enterprise product line news",
  );
  assert.match(prompt, /web search|perplexity|news/i);
  assert.doesNotMatch(prompt, /openai/i);
});

test("intentPlanSummary is readable", () => {
  const plan = planFromTaggedApis("Stripe news", ["perplexity"]);
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
