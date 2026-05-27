import type { ChatMessage } from "./types.ts";
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

Default: general chat does NOT need tools — set skipCatalogSearch and skipLlmToolRound to true.

Set skipCatalogSearch and skipLlmToolRound to false ONLY when the user clearly wants live external data: company enrichment, news/current events, web scrape, contacts/decision makers, or which API to use for a data task.

Company names in the question (OpenAI, Stripe) are topics — NOT API slugs. News about OpenAI → intent web_search, primaryApi perplexity, skipCatalogSearch false.
If Active API from prior turn is set, keep that slug for follow-ups on the same API.

JSON:
{
  "intent": "web_search|company_research|web_scrape|people_search|api_discovery|capability",
  "topicQuery": "string",
  "catalogSearchPrompt": "capability keywords for catalog search, never bare brand name",
  "primaryApi": "perplexity|company-enrich|crustdata|parallel|scrapegraphai|scrapecreators|null",
  "skipCatalogSearch": true,
  "skipLlmToolRound": true
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

/** Merge rule plan with LLM when rules are low-confidence or missing. */
/**
 * Classify intent before any tool calls.
 * Rules handle clear cases; LLM resolves ambiguous queries.
 */
export async function classifyQueryIntent(
  model: string,
  messages: ChatMessage[],
  topicQuery: string,
  taggedApis: string[],
  inheritedTaggedApis: string[] = [],
): Promise<IntentPlan> {
  const sessionTags =
    taggedApis.length > 0 ? taggedApis : inheritedTaggedApis;
  const taggedPlan = planFromTaggedApis(topicQuery, sessionTags);
  if (taggedPlan) return taggedPlan;

  const recent = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-4)
    .map((m) => `${m.role}: ${m.content ?? ""}`)
    .join("\n");

  const res = await llmChat(
    INTENT_CLASSIFIER_MODEL,
    [
      { role: "system", content: INTENT_CLASSIFIER_SYSTEM },
      {
        role: "user",
        content:
          `Recent conversation:\n${recent}\n\n` +
          `Query to classify: ${topicQuery}\n` +
          `Tagged APIs (current message): ${taggedApis.length ? taggedApis.join(", ") : "none"}\n` +
          `Active API from prior turn: ${inheritedTaggedApis.length ? inheritedTaggedApis.join(", ") : "none"}`,
      },
    ],
    undefined,
    { toolChoice: "none", maxTokens: 200 },
  );

  if (!res.ok) {
    return {
      intent: "api_discovery",
      topicQuery,
      catalogSearchPrompt: buildCatalogSearchPrompt("api_discovery", topicQuery),
      directApis: [],
      skipCatalogSearch: true,
      skipLlmToolRound: true,
      confidence: "low",
      source: "rules",
    };
  }

  const choice = (res.data.choices as Array<Record<string, unknown>>)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const content = (message?.content as string) ?? "";
  const parsed = parseClassifierJson(content);
  if (!parsed) {
    return {
      intent: "api_discovery",
      topicQuery,
      catalogSearchPrompt: buildCatalogSearchPrompt("api_discovery", topicQuery),
      directApis: [],
      skipCatalogSearch: true,
      skipLlmToolRound: true,
      confidence: "low",
      source: "rules",
    };
  }

  return planFromLlmJson(parsed, topicQuery);
}

export function intentPlanSummary(plan: IntentPlan): string {
  const apis = plan.directApis.map((a) => a.slug).join(", ") || "catalog search";
  return `${plan.intent} → ${apis}`;
}

