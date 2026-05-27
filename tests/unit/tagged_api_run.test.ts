import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCompanyResearchIntent,
  stripTaggedHandles,
  taggedApiRunSpec,
} from "../../supabase/functions/_shared/taggedApiRun.ts";

test("stripTaggedHandles removes @tags", () => {
  assert.equal(
    stripTaggedHandles("@perplexity What happened with Stripe?"),
    "What happened with Stripe?",
  );
});

test("isCompanyResearchIntent false for @perplexity product launch question", () => {
  assert.equal(
    isCompanyResearchIntent(
      "@perplexity What happened with Stripe's latest product launches this quarter? Cite sources.",
      ["perplexity"],
    ),
    false,
  );
});

test("isCompanyResearchIntent true for Shopify ICP", () => {
  assert.equal(
    isCompanyResearchIntent(
      "Is Shopify a good ICP for a payments API startup? Use headcount, industry, and leadership data.",
      [],
    ),
    true,
  );
});

test("taggedApiRunSpec returns perplexity search", () => {
  const spec = taggedApiRunSpec(
    "perplexity",
    "@perplexity Stripe product launches this quarter",
  );
  assert.equal(spec?.api, "perplexity");
  assert.equal(spec?.path, "/search");
  assert.ok(spec?.body?.query);
});

test("taggedApiRunSpec returns scrapecreators popular creators", () => {
  const spec = taggedApiRunSpec(
    "scrapecreators",
    "what are the popular creators?",
  );
  assert.equal(spec?.api, "scrapecreators");
  assert.equal(spec?.path, "/v1/tiktok/creators/popular");
});
