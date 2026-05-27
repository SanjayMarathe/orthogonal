import type { CatalogIntegration } from "./integrations.ts";
import { extractTaggedSlugs } from "./integrations.ts";
import { isCompanyResearchIntent } from "./taggedApiRun.ts";
import { isNewsOrWebIntent } from "./conversationContext.ts";
import { llmChat } from "./llm.ts";
import type { ChatMessage } from "./types.ts";
import type { PriorToolContext } from "./conversationContext.ts";

export type SessionEndpoint = {
  path: string;
  method: string;
  description: string;
};

export type ApiSessionState = {
  activeSlug: string;
  endpoints: SessionEndpoint[];
  lastEndpoint?: SessionEndpoint;
};

const COMPANY_SESSION_SLUGS = new Set([
  "company-enrich",
  "crustdata",
  "apollo",
  "contactout",
  "aviato",
  "nyne",
  "openmart",
]);

export function sessionFromIntegration(
  slug: string,
  integration: CatalogIntegration,
): ApiSessionState {
  return {
    activeSlug: slug.toLowerCase(),
    endpoints: integration.endpoints.map((e) => ({
      path: e.path,
      method: e.method,
      description: e.description,
    })),
  };
}

/** Parse capability markdown (`GET \`/path\` — desc`) from assistant messages. */
export function parseEndpointsFromAssistant(content: string): SessionEndpoint[] {
  const endpoints: SessionEndpoint[] = [];
  const re =
    /^\s*-\s*\*\*(GET|POST|PUT|PATCH|DELETE)\s+`([^`]+)`\*\*\s*[—–-]\s*(.+)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    endpoints.push({
      method: m[1].toUpperCase(),
      path: m[2].trim(),
      description: m[3].trim(),
    });
  }
  return endpoints;
}

export function extractSlugFromAssistantCapability(content: string): string | null {
  const backtick = content.match(/`@([a-z0-9_-]+)`/i);
  if (backtick) return backtick[1].toLowerCase();
  const heading = content.match(/^##\s+.+\(`@([a-z0-9_-]+)`\)/im);
  if (heading) return heading[1].toLowerCase();
  return null;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Score how well a follow-up query matches a catalog endpoint. */
export function scoreEndpointMatch(
  query: string,
  endpoint: SessionEndpoint,
): number {
  const qTokens = tokenize(query);
  const haystack =
    `${endpoint.path} ${endpoint.description} ${endpoint.method}`.toLowerCase();
  const pathLower = endpoint.path.toLowerCase();
  let score = 0;

  for (const token of qTokens) {
    if (haystack.includes(token)) score += 2;
    if (pathLower.includes(token)) score += 4;
  }

  const q = query.toLowerCase();
  const desc = endpoint.description.toLowerCase();

  if (/\bpopular\b/.test(q) && /\bpopular\b/.test(haystack)) score += 12;
  if (/\bcreator/.test(q) && /\bcreator/.test(haystack)) score += 10;
  if (/\btiktok\b/.test(q) && /\btiktok\b/.test(pathLower)) score += 10;
  if (/\byoutube\b/.test(q) && /\byoutube\b/.test(pathLower)) score += 10;
  if (/\breddit\b/.test(q) && /\breddit\b/.test(pathLower)) score += 10;
  if (/\bplaylist\b/.test(q) && /\bplaylist\b/.test(pathLower)) score += 10;
  if (/\bsubreddit\b/.test(q) && /\bsubreddit\b/.test(pathLower)) score += 10;
  if (/\bfilter/.test(q) && /\bfilter/.test(desc)) score += 10;
  if (/\baccount\b/.test(q) && /\baccount\b/.test(haystack)) score += 6;
  if (/\bmodel/.test(q) && /\bmodel/.test(haystack)) score += 8;
  if (/\benrich/.test(q) && /\benrich/.test(haystack)) score += 6;
  if (/\bsearch\b/.test(q) && /\bsearch\b/.test(haystack)) score += 4;

  return score;
}

export function matchFollowUpToEndpoint(
  query: string,
  endpoints: SessionEndpoint[],
): SessionEndpoint | null {
  if (endpoints.length === 0) return null;

  const ranked = endpoints
    .map((ep) => ({ ep, score: scoreEndpointMatch(query, ep) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 4) return null;
  if (ranked.length > 1 && ranked[1].score === best.score) {
    return null;
  }
  return best.ep;
}

/** User explicitly switched API or topic — stop inheriting session. */
export function isTopicSwitch(query: string, activeSlug: string): boolean {
  const tags = extractTaggedSlugs(query);
  if (tags.length > 0 && tags[0] !== activeSlug.toLowerCase()) return true;

  const slug = activeSlug.toLowerCase();
  if (isNewsOrWebIntent(query) && slug !== "perplexity" && slug !== "parallel") {
    if (!/\b(tiktok|youtube|reddit|kick|creator|playlist|subreddit)\b/i.test(query)) {
      return true;
    }
  }
  if (isCompanyResearchIntent(query, []) && !COMPANY_SESSION_SLUGS.has(slug)) {
    return true;
  }
  return false;
}

export function resolveApiSession(
  messages: ChatMessage[],
  prior: PriorToolContext | null,
): ApiSessionState | null {
  if (prior?.activeSlug && prior.endpoints?.length) {
    return {
      activeSlug: prior.activeSlug,
      endpoints: prior.endpoints,
      lastEndpoint: prior.lastEndpoint,
    };
  }

  const recentAssistants = messages
    .filter((m) => m.role === "assistant" && m.content?.trim())
    .slice(-3);

  for (let i = recentAssistants.length - 1; i >= 0; i--) {
    const content = recentAssistants[i].content!;
    const endpoints = parseEndpointsFromAssistant(content);
    const slug = extractSlugFromAssistantCapability(content);
    if (slug && endpoints.length > 0) {
      return { activeSlug: slug, endpoints };
    }
  }

  if (prior?.activeSlug) {
    return {
      activeSlug: prior.activeSlug,
      endpoints: prior.endpoints ?? [],
      lastEndpoint: prior.lastEndpoint,
    };
  }

  return null;
}

type ParamDef = {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
};

function fillParamHeuristic(
  name: string,
  _type: string | undefined,
  description: string | undefined,
  userQuery: string,
): string | null {
  const n = name.toLowerCase();
  const text = `${userQuery} ${description ?? ""}`.toLowerCase();

  const email = userQuery.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (n.includes("email") && email) return email[0];

  const domain = userQuery.match(/\b([a-z0-9-]+\.(?:com|io|co|so|ai|org|net))\b/i);
  if ((n.includes("domain") || n === "company_domain") && domain) {
    return domain[1].toLowerCase();
  }

  const url = userQuery.match(/https?:\/\/[^\s)]+/);
  if ((n.includes("url") || n === "website") && url) return url[0];

  if (n === "q" || n === "query" || n === "search") {
    const stripped = userQuery.replace(/@\w+/g, "").trim();
    if (stripped.length > 3) return stripped.slice(0, 200);
  }

  if (n === "company" || n === "company_name") {
    const m = userQuery.match(
      /\b(?:for|at|on)\s+([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)?)/,
    );
    if (m) return m[1];
  }

  if (n === "page" && /\bfirst page\b/i.test(text)) return "1";

  return null;
}

/** Build orthogonal_use args from get_details JSON + user query (no LLM). */
export function inferUseArgsFromDetails(
  detailsContent: string,
  userQuery: string,
): {
  api: string;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
} | null {
  try {
    const data = JSON.parse(detailsContent) as {
      api?: { slug?: string };
      endpoint?: {
        path?: string;
        method?: string;
        queryParams?: ParamDef[];
        bodyParams?: ParamDef[];
      };
    };

    const api = data.api?.slug;
    const ep = data.endpoint;
    if (!api || !ep?.path) return null;

    const method = (ep.method ?? "GET").toUpperCase();
    const query: Record<string, string> = {};
    const body: Record<string, unknown> = {};

    for (const p of ep.queryParams ?? []) {
      const val = fillParamHeuristic(
        p.name,
        p.type,
        p.description,
        userQuery,
      );
      if (val != null) query[p.name] = val;
      else if (p.required) return null;
    }

    for (const p of ep.bodyParams ?? []) {
      const val = fillParamHeuristic(
        p.name,
        p.type,
        p.description,
        userQuery,
      );
      if (val != null) body[p.name] = val;
      else if (p.required) return null;
    }

    const out: {
      api: string;
      path: string;
      body?: Record<string, unknown>;
      query?: Record<string, string>;
    } = { api, path: ep.path };

    if (method === "GET" || Object.keys(query).length > 0) {
      out.query = query;
    }
    if (Object.keys(body).length > 0) {
      out.body = body;
    }
    if (method === "POST" && Object.keys(body).length === 0 && !out.query) {
      const q = userQuery.replace(/@\w+/g, "").trim();
      if (q.length > 2) out.body = { query: q, q };
    }

    return out;
  } catch {
    return null;
  }
}

export async function planUseArgsWithLlm(
  model: string,
  detailsContent: string,
  userQuery: string,
): Promise<{
  api: string;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
} | null> {
  const res = await llmChat(
    model,
    [
      {
        role: "system",
        content:
          "Given an API endpoint schema (get_details JSON) and a user request, output ONLY JSON for orthogonal_use: " +
          '{"api":"slug","path":"/path","query":{},"body":{}}. ' +
          "Use string values in query. Include only params the user needs. No markdown.",
      },
      {
        role: "user",
        content: `User request: ${userQuery}\n\nEndpoint schema:\n${detailsContent.slice(0, 6000)}`,
      },
    ],
    undefined,
    { toolChoice: "none", maxTokens: 400 },
  );

  if (!res.ok) return null;
  const choice = (res.data.choices as Array<Record<string, unknown>>)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const raw = (message?.content as string) ?? "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    if (!parsed.api || !parsed.path) return null;
    return {
      api: String(parsed.api),
      path: String(parsed.path),
      body: parsed.body as Record<string, unknown> | undefined,
      query: parsed.query as Record<string, string> | undefined,
    };
  } catch {
    return null;
  }
}

export function sessionContextInjection(session: ApiSessionState): string {
  const lines = session.endpoints.slice(0, 8).map(
    (e) => `- ${e.method} ${e.path} — ${e.description}`,
  );
  return (
    `[Active API session: @${session.activeSlug}]\n` +
    "Endpoints from the prior capability card:\n" +
    lines.join("\n") +
    "\nPick the best matching endpoint for the follow-up; do not call orthogonal_search."
  );
}
