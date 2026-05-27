import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildContextInjection,
  isFollowUpAffirmation,
  isNewsOrWebIntent,
  resolveEffectiveUserQuery,
  resolveInheritedTaggedApis,
  shouldInheritApiContext,
} from "../../supabase/functions/_shared/conversationContext.ts";
import type { ChatMessage } from "../../supabase/functions/_shared/types.ts";

test("isFollowUpAffirmation detects yeah do that", () => {
  assert.equal(isFollowUpAffirmation("yeah do that"), true);
  assert.equal(isFollowUpAffirmation("yes, go ahead"), true);
  assert.equal(isFollowUpAffirmation("What is OpenAI enterprise news?"), false);
});

test("resolveEffectiveUserQuery expands yeah do that to prior user question", () => {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: "What is the latest news on OpenAI's enterprise product line?",
    },
    {
      role: "assistant",
      content:
        "No results yet. I can suggest searching for OpenAI's enterprise product line.",
    },
    { role: "user", content: "yeah do that" },
  ];
  const resolved = resolveEffectiveUserQuery(messages, "yeah do that");
  assert.match(resolved, /OpenAI.*enterprise product line/i);
});

test("isNewsOrWebIntent matches news questions", () => {
  assert.equal(
    isNewsOrWebIntent(
      "What is the latest news on OpenAI's enterprise product line?",
    ),
    true,
  );
  assert.equal(isNewsOrWebIntent("Shopify headcount and ICP"), false);
});

test("buildContextInjection includes prior catalog results when continuing episode", () => {
  const injection = buildContextInjection(
    {
      effectiveQuery: "OpenAI enterprise news",
      catalogSearchPrompt: "OpenAI enterprise news",
      catalogSearchResult: '{"apis":[{"slug":"perplexity"}]}',
    },
    "OpenAI enterprise news",
    true,
  );
  assert.match(injection ?? "", /Prior catalog search results/);
  assert.match(injection ?? "", /perplexity/);
});

test("buildContextInjection skipped when not continuing episode", () => {
  const injection = buildContextInjection(
    {
      activeSlug: "crustdata",
      catalogSearchResult: '{"apis":[]}',
    },
    "test message",
    false,
  );
  assert.equal(injection, null);
});

test("resolveInheritedTaggedApis reads @tag from prior user message", () => {
  const messages = [
    { role: "user", content: "@scrapecreators what can you do?" },
    {
      role: "assistant",
      content: "## Scrape Creators (`@scrapecreators`)\n\n5 endpoints",
    },
    { role: "user", content: "what are the popular creators?" },
  ];
  const inherited = resolveInheritedTaggedApis(messages, null, []);
  assert.deepEqual(inherited, ["scrapecreators"]);
});

test("shouldInheritApiContext requires continueEpisode", () => {
  assert.equal(
    shouldInheritApiContext("what are the popular creators?", ["scrapecreators"], true),
    true,
  );
  assert.equal(
    shouldInheritApiContext("what are the popular creators?", ["scrapecreators"], false),
    false,
  );
  assert.equal(
    shouldInheritApiContext("test message", ["crustdata"], false),
    false,
  );
});
