import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleEpisodeInjection,
  buildEpisodeAfterTurn,
  detectEpisodeBoundary,
  episodeFromMetadata,
  shouldInheritTaggedApis,
  toTurnPlan,
} from "../../supabase/functions/_shared/episodeContext.ts";
import { planFromTaggedApis } from "../../supabase/functions/_shared/intentRouter.ts";

const priorEpisode = {
  id: "ep_1",
  summary: "User researched Apple executive contacts via crustdata",
  intent: "company_research" as const,
  entity: "apple.com",
  activeSlug: "crustdata",
  turnIndex: 1,
  toolFacts: "- Headcount: 150000",
};

test("detectEpisodeBoundary on test message after research", () => {
  assert.equal(
    detectEpisodeBoundary("test message", "test message", priorEpisode, []),
    true,
  );
});

test("detectEpisodeBoundary allows company follow-up on same entity", () => {
  assert.equal(
    detectEpisodeBoundary(
      "find their VP Product contact",
      "find their VP Product contact",
      priorEpisode,
      [],
    ),
    false,
  );
});

test("assembleEpisodeInjection only when continueEpisode", () => {
  assert.equal(
    assembleEpisodeInjection(priorEpisode, false, "test message"),
    null,
  );
  const inj = assembleEpisodeInjection(
    priorEpisode,
    true,
    "find VP Product",
  );
  assert.match(inj ?? "", /Episode context/);
  assert.match(inj ?? "", /apple\.com|Apple/i);
  assert.doesNotMatch(inj ?? "", /Continue using this slug unless/);
});

test("shouldInheritTaggedApis false after episode boundary plan", () => {
  const plan = toTurnPlan(
    planFromTaggedApis("test", []) ?? {
      intent: "api_discovery",
      topicQuery: "test",
      catalogSearchPrompt: "data API",
      directApis: [],
      skipCatalogSearch: true,
      skipLlmToolRound: true,
      confidence: "high",
      source: "rules",
    },
    { continueEpisode: false, episodeBoundary: true },
  );
  assert.equal(shouldInheritTaggedApis(plan, priorEpisode, []), false);
});

test("shouldInheritTaggedApis true when continuing episode", () => {
  const plan = toTurnPlan(
    {
      intent: "company_research",
      topicQuery: "find VP Product",
      catalogSearchPrompt: "company enrichment",
      directApis: [],
      skipCatalogSearch: false,
      skipLlmToolRound: false,
      confidence: "high",
      source: "rules",
    },
    { continueEpisode: true, episodeBoundary: false },
  );
  assert.equal(shouldInheritTaggedApis(plan, priorEpisode, []), true);
});

test("episodeFromMetadata reads legacy toolContext", () => {
  const ep = episodeFromMetadata({
    toolContext: {
      activeSlug: "crustdata",
      effectiveQuery: "research Apple exec contacts",
    },
  });
  assert.ok(ep);
  assert.equal(ep?.activeSlug, "crustdata");
});

test("buildEpisodeAfterTurn compacts tool facts without catalog blob in slim export", () => {
  const ep = buildEpisodeAfterTurn({
    priorEpisode: null,
    intent: "company_research",
    effectiveQuery: "research monday.com headcount",
    activeSlug: "company-enrich",
    toolSteps: [
      {
        id: "t1",
        tool: "orthogonal_use",
        label: "Workforce",
        status: "done",
        resultPreview: JSON.stringify({
          success: true,
          data: { domain: "monday.com", observed_employee_count: 2000 },
        }),
      },
    ],
    catalogSearchResult: '{"apis":[]}',
    continueEpisode: false,
  });
  assert.match(ep.summary, /monday/i);
  assert.ok(ep.toolFacts?.includes("monday") || ep.toolFacts?.includes("2000"));
});
