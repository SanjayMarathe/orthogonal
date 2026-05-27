import type { ChatMessage } from "./types.ts";
import type { EpisodeState } from "./episodeContext.ts";
import { detectEpisodeBoundary, toTurnPlan } from "./episodeContext.ts";
import { isFollowUpAffirmation } from "./conversationContext.ts";
import { isCompanyResearchIntent, hasTaggedRunSpec } from "./taggedApiRun.ts";
import { isNewsOrWebIntent } from "./conversationContext.ts";
import { llmChat } from "./llm.ts";

export type QueryIntent =
  | "web_search"
  | "company_research"
  | "web_scrape"
  | "people_search"
  | "api_discovery"
  | "capability";

export type IntentPlan = {
  intent: QueryIntent;
  /** User's actual information need — passed to API bodies (Perplexity query, etc.). */
  topicQuery: string;
  /** Capability-focused prompt for orthogonal_search — never bare entity names. */
  catalogSearchPrompt: string;
  /** Slugs to invoke directly without LLM tool planning. */
  directApis: Array<{ slug: string; reason: string }>;
  skipCatalogSearch: boolean;
  skipLlmToolRound: boolean;
  confidence: "high" | "medium" | "low";
  source: "rules" | "llm" | "rules+llm";
};

export type { TurnPlan } from "./episodeContext.ts";

const NON_COMPANY_TAGS = new Set([
  "perplexity",
  "parallel",
  "scrapegraphai",
  "scrapecreators",
  "notte",
  "openfunnel",
  "context-dev",
]);

const COMPANY_TAGS = new Set([
  "company-enrich",
  "crustdata",
  "apollo",
  "contactout",
  "aviato",
  "nyne",
  "openmart",
]);

/** Entity names that collide with API catalog slugs when used as search prompts. */
const CATALOG_AMBIGUOUS_ENTITIES =
  /\b(openai|anthropic|stripe|shopify|google|microsoft|meta|amazon|twilio|sendgrid|notion|slack)\b/i;

/** Fast Groq model for intent-only calls (no tools). */
export const INTENT_CLASSIFIER_MODEL = "groq:llama-3.1-8b-instant";

export function intentPlanNeedsTools(plan: IntentPlan): boolean {
  return plan.directApis.length > 0 || !plan.skipCatalogSearch;
}

/**
 * Build a capability-focused catalog search prompt.
 * Never pass "OpenAI enterprise news" — semantic search returns the OpenAI API slug.
 */
export function buildCatalogSearchPrompt(
  intent: QueryIntent,
  _topicQuery: string,
): string {
  switch (intent) {
    case "web_search":
      return "real-time web search news current events API perplexity parallel";
    case "company_research":
      return "company enrichment workforce headcount leadership funding API";
    case "web_scrape":
      return "web scraping website page content extraction crawl API";
    case "people_search":
      return "people contacts decision makers email finder B2B API";
    case "capability":
      return "API capabilities list endpoints orthogonal platform";
    default:
      return "data API integration search enrichment web";
  }
}

export function planFromTaggedApis(
  topicQuery: string,
  taggedApis: string[],
): IntentPlan | null {
  if (taggedApis.length === 0) return null;
  const slug = taggedApis[0].toLowerCase();
  const hasSpec = hasTaggedRunSpec(slug, topicQuery);

  if (NON_COMPANY_TAGS.has(slug)) {
    const intent: QueryIntent =
      slug === "perplexity" || slug === "parallel" ? "web_search" : "api_discovery";
    return {
      intent,
      topicQuery,
      catalogSearchPrompt: buildCatalogSearchPrompt(intent, topicQuery),
      directApis: [{ slug, reason: "user tagged API handle" }],
      skipCatalogSearch: true,
      skipLlmToolRound: hasSpec,
      confidence: "high",
      source: "rules",
    };
  }

  if (COMPANY_TAGS.has(slug)) {
    return {
      intent: "company_research",
      topicQuery,
      catalogSearchPrompt: buildCatalogSearchPrompt("company_research", topicQuery),
      directApis: [],
      skipCatalogSearch: true,
      skipLlmToolRound: false,
      confidence: "high",
      source: "rules",
    };
  }

  return {
    intent: "api_discovery",
    topicQuery,
    catalogSearchPrompt: buildCatalogSearchPrompt("api_discovery", topicQuery),
    directApis: [{ slug, reason: "user tagged API handle" }],
    skipCatalogSearch: true,
    skipLlmToolRound: false,
    confidence: "high",
    source: "rules",
  };
}

const INTENT_CLASSIFIER_SYSTEM = `You decide whether the user's message needs Orthogonal API tools. Output ONLY valid JSON (no markdown).

Default: general chat does NOT need tools — set skipCatalogSearch and skipLlmToolRound to true, continueEpisode to false.

Set skipCatalogSearch and skipLlmToolRound to false ONLY when the user clearly wants live external data: company enrichment, news/current events, web scrape, contacts/decision makers, or which API to use for a data task.

Set continueEpisode to true ONLY when the user is clearly continuing the same task as the prior episode summary (follow-up on same company, same API, "find VP Product", "yes do that"). Casual messages, greetings, unrelated questions, or "test message" → continueEpisode false.

Company names in the question (OpenAI, Stripe) are topics — NOT API slugs. News about OpenAI → intent web_search, primaryApi perplexity, skipCatalogSearch false.

Do NOT assume tools are needed just because a prior episode exists. Classify the CURRENT message.

JSON:
{
  "intent": "web_search|company_research|web_scrape|people_search|api_discovery|capability",
  "topicQuery": "string",
  "catalogSearchPrompt": "capability keywords for catalog search, never bare brand name",
  "primaryApi": "perplexity|company-enrich|crustdata|parallel|scrapegraphai|scrapecreators|null",
  "skipCatalogSearch": true,
  "skipLlmToolRound": true,
  "continueEpisode": false
}`;

function parseClassifierJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function planFromLlmJson(
  parsed: Record<string, unknown>,
  fallbackTopic: string,
): IntentPlan {
  const intent = String(parsed.intent ?? "api_discovery") as QueryIntent;
  const topicQuery = String(parsed.topicQuery ?? fallbackTopic).trim() || fallbackTopic;
  let catalogSearchPrompt = String(
    parsed.catalogSearchPrompt ?? buildCatalogSearchPrompt(intent, topicQuery),
  ).trim();
  if (CATALOG_AMBIGUOUS_ENTITIES.test(catalogSearchPrompt) && catalogSearchPrompt.split(/\s+/).length <= 4) {
    catalogSearchPrompt = buildCatalogSearchPrompt(intent, topicQuery);
  }

  const primaryApi = parsed.primaryApi
    ? String(parsed.primaryApi).toLowerCase()
    : null;
  const directApis: IntentPlan["directApis"] = [];

  if (primaryApi && primaryApi !== "null") {
    directApis.push({ slug: primaryApi, reason: "LLM intent classifier" });
  } else if (intent === "web_search") {
    directApis.push({ slug: "perplexity", reason: "web_search default" });
  }

  const explicitSkipCatalogSearch =
    typeof parsed.skipCatalogSearch === "boolean"
      ? parsed.skipCatalogSearch
      : undefined;
  const explicitSkipLlmToolRound =
    typeof parsed.skipLlmToolRound === "boolean"
      ? parsed.skipLlmToolRound
      : undefined;
  const skipCatalogSearch = explicitSkipCatalogSearch ?? true;
  const skipLlmToolRound = explicitSkipLlmToolRound ?? skipCatalogSearch;
  return {
    intent,
    topicQuery,
    catalogSearchPrompt,
    directApis,
    skipCatalogSearch,
    skipLlmToolRound,
    confidence: (parsed.confidence as IntentPlan["confidence"]) ?? "medium",
    source: "llm",
  };
}

function parseContinueEpisode(parsed: Record<string, unknown>): boolean {
  return parsed.continueEpisode === true;
}

/**
 * Classify intent before any tool calls.
 * Rules handle clear cases; LLM resolves ambiguous queries.
 */
export async function classifyQueryIntent(
  _model: string,
  messages: ChatMessage[],
  topicQuery: string,
  taggedApis: string[],
  priorEpisode: EpisodeState | null = null,
  opts?: {
    userMessage?: string;
    episodeBoundary?: boolean;
    followUpAffirmation?: boolean;
  },
): Promise<import("./episodeContext.ts").TurnPlan> {
  const userMessage = opts?.userMessage ?? topicQuery;
  const episodeBoundary =
    opts?.episodeBoundary ??
    detectEpisodeBoundary(userMessage, topicQuery, priorEpisode, taggedApis);
  const followUpAffirmation = opts?.followUpAffirmation ?? false;

  if (taggedApis.length > 0) {
    const taggedPlan = planFromTaggedApis(topicQuery, taggedApis);
    if (taggedPlan) {
      return toTurnPlan(taggedPlan, {
        continueEpisode: true,
        episodeBoundary: false,
      });
    }
  }

  if (episodeBoundary) {
    const casualPlan: IntentPlan = {
      intent: "api_discovery",
      topicQuery,
      catalogSearchPrompt: buildCatalogSearchPrompt("api_discovery", topicQuery),
      directApis: [],
      skipCatalogSearch: true,
      skipLlmToolRound: true,
      confidence: "high",
      source: "rules",
    };
    return toTurnPlan(casualPlan, {
      continueEpisode: false,
      episodeBoundary: true,
    });
  }

  if (
    followUpAffirmation &&
    priorEpisode &&
    (priorEpisode.toolFacts || priorEpisode.catalogSearchResult || priorEpisode.activeSlug)
  ) {
    const intent = (priorEpisode.intent ?? "api_discovery") as QueryIntent;
    const plan: IntentPlan = {
      intent,
      topicQuery,
      catalogSearchPrompt:
        priorEpisode.catalogSearchPrompt ??
        buildCatalogSearchPrompt(intent, topicQuery),
      directApis: priorEpisode.activeSlug
        ? [{ slug: priorEpisode.activeSlug, reason: "affirmation follow-up" }]
        : [],
      skipCatalogSearch: !priorEpisode.catalogSearchResult,
      skipLlmToolRound: false,
      confidence: "high",
      source: "rules",
    };
    return toTurnPlan(plan, {
      continueEpisode: true,
      episodeBoundary: false,
    });
  }

  const recent = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-4)
    .map((m) => `${m.role}: ${m.content ?? ""}`)
    .join("\n");

  const episodeBlock = priorEpisode?.summary
    ? `Prior episode summary (context only — do not auto-continue unless user asks):\n${priorEpisode.summary.slice(0, 500)}\n`
    : "";

  const res = await llmChat(
    INTENT_CLASSIFIER_MODEL,
    [
      { role: "system", content: INTENT_CLASSIFIER_SYSTEM },
      {
        role: "user",
        content:
          `${episodeBlock}` +
          `Recent conversation:\n${recent}\n\n` +
          `Query to classify: ${topicQuery}\n` +
          `Tagged APIs (current message): ${taggedApis.length ? taggedApis.join(", ") : "none"}`,
      },
    ],
    undefined,
    { toolChoice: "none", maxTokens: 220 },
  );

  const fallbackPlan = (): import("./episodeContext.ts").TurnPlan => {
    const needsTools =
      isCompanyResearchIntent(topicQuery, taggedApis) ||
      isNewsOrWebIntent(topicQuery);
    const intent: QueryIntent = isNewsOrWebIntent(topicQuery)
      ? "web_search"
      : isCompanyResearchIntent(topicQuery, taggedApis)
        ? "company_research"
        : "api_discovery";
    return toTurnPlan(
      {
        intent,
        topicQuery,
        catalogSearchPrompt: buildCatalogSearchPrompt(intent, topicQuery),
        directApis: needsTools && intent === "web_search"
          ? [{ slug: "perplexity", reason: "web_search fallback" }]
          : [],
        skipCatalogSearch: !needsTools,
        skipLlmToolRound: !needsTools,
        confidence: "low",
        source: "rules",
      },
      { continueEpisode: false, episodeBoundary: false },
    );
  };

  if (!res.ok) return fallbackPlan();

  const choice = (res.data.choices as Array<Record<string, unknown>>)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const content = (message?.content as string) ?? "";
  const parsed = parseClassifierJson(content);
  if (!parsed) return fallbackPlan();

  const plan = planFromLlmJson(parsed, topicQuery);
  let continueEpisode = parseContinueEpisode(parsed);

  if (episodeBoundary) continueEpisode = false;
  if (!intentPlanNeedsTools(plan)) continueEpisode = false;

  return toTurnPlan(plan, { continueEpisode, episodeBoundary });
}

export function intentPlanSummary(plan: IntentPlan): string {
  const apis = plan.directApis.map((a) => a.slug).join(", ") || "catalog search";
  return `${plan.intent} → ${apis}`;
}
