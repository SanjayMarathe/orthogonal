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

const WEB_SEARCH_SLUGS = ["perplexity", "parallel"] as const;
const COMPANY_SLUGS = ["company-enrich", "crustdata"] as const;
const SCRAPE_SLUGS = ["scrapegraphai", "olostep"] as const;

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

function planFromTaggedApis(
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

/** Rule-based intent classification — fast path for clear patterns. */
export function classifyIntentRules(
  topicQuery: string,
  taggedApis: string[],
  inheritedTaggedApis: string[] = [],
): IntentPlan | null {
  const sessionTags =
    taggedApis.length > 0 ? taggedApis : inheritedTaggedApis;
  const tagged = planFromTaggedApis(topicQuery, sessionTags);
  if (tagged) return tagged;

  const t = topicQuery.toLowerCase();

  if (
    /\b(popular\s+creator|creators|tiktok|youtube playlist|subreddit|kick clip)\b/.test(
      t,
    ) &&
    !/\b(scrape|homepage|html|fetch url|website content)\b/.test(t)
  ) {
    const hasSpec = hasTaggedRunSpec("scrapecreators", topicQuery);
    return {
      intent: "api_discovery",
      topicQuery,
      catalogSearchPrompt:
        "social media creators tiktok youtube API scrapecreators",
      directApis: [{ slug: "scrapecreators", reason: "social/creator query" }],
      skipCatalogSearch: true,
      skipLlmToolRound: hasSpec,
      confidence: "high",
      source: "rules",
    };
  }

  if (isNewsOrWebIntent(topicQuery)) {
    return {
      intent: "web_search",
      topicQuery,
      catalogSearchPrompt: buildCatalogSearchPrompt("web_search", topicQuery),
      directApis: [{ slug: "perplexity", reason: "news or current-events query" }],
      skipCatalogSearch: true,
      skipLlmToolRound: true,
      confidence: "high",
      source: "rules",
    };
  }

  if (isCompanyResearchIntent(topicQuery, [])) {
    return {
      intent: "company_research",
      topicQuery,
      catalogSearchPrompt: buildCatalogSearchPrompt("company_research", topicQuery),
      directApis: [],
      skipCatalogSearch: false,
      skipLlmToolRound: false,
      confidence: "high",
      source: "rules",
    };
  }

  if (/\b(scrape|website|page content|crawl|extract html|fetch url)\b/.test(t)) {
    return {
      intent: "web_scrape",
      topicQuery,
      catalogSearchPrompt: buildCatalogSearchPrompt("web_scrape", topicQuery),
      directApis: [{ slug: "scrapegraphai", reason: "web scraping query" }],
      skipCatalogSearch: true,
      skipLlmToolRound: true,
      confidence: "medium",
      source: "rules",
    };
  }

  if (
    /\b(email|contact|decision.?maker|vp\b|c-?suite|find people|phone number)\b/.test(
      t,
    )
  ) {
    return {
      intent: "people_search",
      topicQuery,
      catalogSearchPrompt: buildCatalogSearchPrompt("people_search", topicQuery),
      directApis: [{ slug: "crustdata", reason: "people/contacts query" }],
      skipCatalogSearch: false,
      skipLlmToolRound: false,
      confidence: "medium",
      source: "rules",
    };
  }

  if (/\b(what can you do|which api|available apis|capabilities)\b/.test(t)) {
    return {
      intent: "capability",
      topicQuery,
      catalogSearchPrompt: buildCatalogSearchPrompt("capability", topicQuery),
      directApis: [],
      skipCatalogSearch: true,
      skipLlmToolRound: true,
      confidence: "high",
      source: "rules",
    };
  }

  return null;
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

JSON schema:
{
  "intent": "web_search|company_research|web_scrape|people_search|api_discovery|capability",
  "topicQuery": "cleaned user information need",
  "catalogSearchPrompt": "capability keywords for API catalog (never just a brand name)",
  "primaryApi": "perplexity|company-enrich|crustdata|parallel|scrapegraphai|null",
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
  return {
    intent,
    topicQuery,
    catalogSearchPrompt,
    directApis,
    skipCatalogSearch: skipDirect && intent === "web_search",
    skipLlmToolRound: skipDirect && (intent === "web_search" || intent === "web_scrape"),
    confidence: (parsed.confidence as IntentPlan["confidence"]) ?? "medium",
    source: "llm",
  };
}

/** Merge rule plan with LLM when rules are low-confidence or missing. */
export function mergeIntentPlans(
  rules: IntentPlan | null,
  llm: IntentPlan,
): IntentPlan {
  if (!rules) return llm;
  if (rules.confidence === "high") return rules;
  if (llm.confidence === "high" && rules.confidence !== "high") {
    return { ...llm, source: "rules+llm" };
  }
  return rules;
}

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
  const rules = classifyIntentRules(
    topicQuery,
    taggedApis,
    inheritedTaggedApis,
  );
  if (rules?.confidence === "high") return rules;

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
    return (
      rules ?? {
        intent: "api_discovery",
        topicQuery,
        catalogSearchPrompt: buildCatalogSearchPrompt("api_discovery", topicQuery),
        directApis: [],
        skipCatalogSearch: false,
        skipLlmToolRound: false,
        confidence: "low",
        source: "rules",
      }
    );
  }

  const choice = (res.data.choices as Array<Record<string, unknown>>)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const content = (message?.content as string) ?? "";
  const parsed = parseClassifierJson(content);
  if (!parsed) return rules ?? planFromLlmJson({ intent: "api_discovery" }, topicQuery);

  const llmPlan = planFromLlmJson(parsed, topicQuery);
  return mergeIntentPlans(rules, llmPlan);
}

export function intentPlanSummary(plan: IntentPlan): string {
  const apis = plan.directApis.map((a) => a.slug).join(", ") || "catalog search";
  return `${plan.intent} → ${apis}`;
}

export { WEB_SEARCH_SLUGS, COMPANY_SLUGS, SCRAPE_SLUGS };
