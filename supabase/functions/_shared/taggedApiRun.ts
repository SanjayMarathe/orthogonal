/** Tags that should NOT trigger company-enrich / crustdata auto-fetch. */
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

export function stripTaggedHandles(text: string): string {
  return text.replace(/@\w+/g, " ").replace(/\s+/g, " ").trim();
}

/** True when we should auto-fetch workforce / crustdata (not web search). */
export function isCompanyResearchIntent(
  userMessage: string,
  taggedApis: string[],
): boolean {
  const tags = taggedApis.map((t) => t.toLowerCase());
  if (tags.some((t) => NON_COMPANY_TAGS.has(t))) return false;
  if (tags.some((t) => COMPANY_TAGS.has(t))) return true;

  const t = userMessage.toLowerCase();
  if (
    /\b(launch|launches|product launch|this quarter|cite sources|web search|scrape|website|audience|news|stock|earnings)\b/
      .test(t)
  ) {
    return false;
  }
  return /\b(icp|headcount|employee|workforce|leadership|decision.?maker|c-?suite|funding|enrich|similar companies|sales target|industry|executive|ceo|cfo|contact|vp\b|outbound)\b/
    .test(t);
}

export type TaggedRunSpec = {
  api: string;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
};

/** True when taggedApiRunSpec can invoke this slug without LLM tool planning. */
export function hasTaggedRunSpec(slug: string, userMessage: string): boolean {
  return taggedApiRunSpec(slug, userMessage) !== null;
}

/** Deterministic orthogonal_use for common @tag prompts (no LLM planning loop). */
export function taggedApiRunSpec(
  slug: string,
  userMessage: string,
): TaggedRunSpec | null {
  const query = stripTaggedHandles(userMessage);
  if (!query) return null;

  switch (slug.toLowerCase()) {
    case "perplexity":
      return {
        api: "perplexity",
        path: "/search",
        body: { query, max_results: 8 },
      };
    case "parallel":
      return {
        api: "parallel",
        path: "/search",
        body: { query },
      };
    case "scrapecreators": {
      const q = query.toLowerCase();
      if (/youtube|playlist/.test(q)) {
        return {
          api: "scrapecreators",
          path: "/v1/youtube/playlist",
          query: { playlist_id: "PLrAXtmRdnEQy6nuLMH8kN" },
        };
      }
      if (/reddit|subreddit/.test(q)) {
        return {
          api: "scrapecreators",
          path: "/v1/reddit/subreddit",
          query: { subreddit: "technology", sort: "hot" },
        };
      }
      if (/kick|clip/.test(q)) {
        return {
          api: "scrapecreators",
          path: "/v1/kick/clip",
          query: { clip: "clip" },
        };
      }
      if (/threads|thread post/.test(q)) {
        return {
          api: "scrapecreators",
          path: "/v1/threads/post",
          query: { url: "https://www.threads.net" },
        };
      }
      // "popular creators", "what are the creators", etc.
      if (/creator|popular|tiktok/.test(q)) {
        return {
          api: "scrapecreators",
          path: "/v1/tiktok/creators/popular",
          query: {},
        };
      }
      return null;
    }
    default:
      return null;
  }
}
