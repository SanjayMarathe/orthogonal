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

const INTENT_CLASSIFIER_SYSTEM = `You classify user queries for an API routing layer. Output ONLY valid JSON (no markdown fences).

Intents:
- web_search: news, latest updates, product launches, current events, "what happened", cite sources
- company_research: headcount, ICP, workforce, leadership, funding, company profile, enrichment
- web_scrape: scrape website, extract page content, crawl URLs
- people_search: find contacts, emails, decision makers, executives
- api_discovery: find which API to use, general data lookup
- capability: what APIs are available, what can you do

CRITICAL: A company name in the question (OpenAI, Stripe, Shopify) does NOT mean use that company's API slug.
Example: "latest news on OpenAI enterprise" → web_search with primaryApi "perplexity", NOT "openai".
If Active API from prior turn is set (e.g. scrapecreators), continue with that slug for follow-ups like "popular creators".
"popular creators" / TikTok / YouTube → primaryApi "scrapecreators", NOT "scrapegraphai".
If the query is casual (e.g. "test message") or general conversation, set skipCatalogSearch and skipLlmToolRound to true so the agent answers directly without tooling.
If the query clearly wants data, set skipCatalogSearch to false and provide a catalogSearchPrompt that guides tooling.

JSON schema:
{
  "intent": "web_search|company_research|web_scrape|people_search|api_discovery|capability",
  "topicQuery": "cleaned user information need",
  "catalogSearchPrompt": "capability keywords for API catalog (never just a brand name)",
  "primaryApi": "perplexity|company-enrich|crustdata|parallel|scrapegraphai|null",
  "skipCatalogSearch": true|false,
  "skipLlmToolRound": true|false,
  "confidence": "high|medium|low"
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

  const skipDirect = directApis.length > 0;
  const explicitSkipCatalogSearch =
    typeof parsed.skipCatalogSearch === "boolean"
      ? parsed.skipCatalogSearch
      : undefined;
  const explicitSkipLlmToolRound =
    typeof parsed.skipLlmToolRound === "boolean"
      ? parsed.skipLlmToolRound
      : undefined;
  const skipCatalogSearch =
    explicitSkipCatalogSearch ?? (skipDirect && intent === "web_search");
  const skipLlmToolRound =
    explicitSkipLlmToolRound ??
    (skipDirect && (intent === "web_search" || intent === "web_scrape"));
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
    model,
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
    { toolChoice: "none", maxTokens: 300 },
  );

  if (!res.ok) {
    return {
      intent: "api_discovery",
      topicQuery,
      catalogSearchPrompt: buildCatalogSearchPrompt("api_discovery", topicQuery),
      directApis: [],
      skipCatalogSearch: false,
      skipLlmToolRound: false,
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
      skipCatalogSearch: false,
      skipLlmToolRound: false,
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

