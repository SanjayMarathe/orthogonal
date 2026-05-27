const ORTHOGONAL_BASE = "https://api.orthogonal.com/v1";
const TIMEOUT_MS = 30_000;
/** Cap per API run so the edge function can still synthesize within Supabase's ~150s limit. */
const API_RUN_TIMEOUT_MS = 35_000;
const LLM_TIMEOUT_MS = 120_000;
const MAX_429_RETRIES = 5;

function getApiKey(): string {
  const key = Deno.env.get("ORTHOGONAL_API_KEY");
  if (!key) throw new Error("ORTHOGONAL_API_KEY is not configured");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const sec = Number.parseInt(header, 10);
    if (!Number.isNaN(sec) && sec > 0) return sec * 1000;
  }
  return Math.min(30_000, 1500 * 2 ** attempt);
}

async function orthogonalFetch(
  path: string,
  body: Record<string, unknown>,
  attempt = 0,
  timeoutMs = TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${ORTHOGONAL_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 429 && attempt < MAX_429_RETRIES) {
    await sleep(retryDelayMs(response, attempt));
    return orthogonalFetch(path, body, attempt + 1, timeoutMs);
  }

  const rawText = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = {
      error: "Invalid JSON response from Orthogonal",
      status: response.status,
      bodyPreview: rawText.slice(0, 300),
    };
  }

  return { ok: response.ok, status: response.status, data };
}

async function orthogonalGet(
  path: string,
  attempt = 0,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${ORTHOGONAL_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.status === 429 && attempt < MAX_429_RETRIES) {
    await sleep(retryDelayMs(response, attempt));
    return orthogonalGet(path, attempt + 1);
  }

  const rawText = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = {
      error: "Invalid JSON response from Orthogonal",
      status: response.status,
      bodyPreview: rawText.slice(0, 300),
    };
  }

  return { ok: response.ok, status: response.status, data };
}

export async function orthogonalListEndpoints(
  limit = 100,
  offset = 0,
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const result = await orthogonalGet(
    `/list-endpoints?limit=${limit}&offset=${offset}`,
  );
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      data: result.data,
      error: formatOrthogonalError(result.status, result.data),
    };
  }
  return { ok: true, status: result.status, data: result.data };
}

export async function orthogonalSearch(
  prompt: string,
  limit = 10,
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const result = await orthogonalFetch("/search", { prompt, limit });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      data: result.data,
      error: formatOrthogonalError(result.status, result.data),
    };
  }
  return { ok: true, status: result.status, data: result.data };
}

export async function orthogonalGetDetails(
  api: string,
  path: string,
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const result = await orthogonalFetch("/details", { api, path });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      data: result.data,
      error: formatOrthogonalError(result.status, result.data),
    };
  }
  return { ok: true, status: result.status, data: result.data };
}

export function normalizeQueryParams(
  query?: Record<string, unknown>,
): Record<string, string> | undefined {
  if (!query) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object") {
      out[key] = JSON.stringify(value);
    } else {
      out[key] = String(value);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export async function orthogonalRun(
  api: string,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<{
  ok: boolean;
  status: number;
  data: unknown;
  priceCents?: number;
  requestId?: string;
  error?: string;
}> {
  const payload: Record<string, unknown> = { api, path };
  if (body) payload.body = body;
  const normalizedQuery = normalizeQueryParams(query);
  if (normalizedQuery) payload.query = normalizedQuery;

  const result = await orthogonalFetch("/run", payload, 0, API_RUN_TIMEOUT_MS);
  const priceCents = result.data.priceCents as number | undefined;
  const requestId = result.data.requestId as string | undefined;

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      data: result.data,
      priceCents,
      requestId,
      error: formatOrthogonalError(result.status, result.data),
    };
  }
  return {
    ok: true,
    status: result.status,
    data: result.data,
    priceCents,
    requestId,
  };
}

export async function basetenChat(
  messages: unknown[],
  tools?: unknown[],
  model = "moonshotai/Kimi-K2.5",
  options?: { toolChoice?: "auto" | "none"; maxTokens?: number },
): Promise<{
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
}> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.7,
    max_tokens: options?.maxTokens ?? 4096,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = options?.toolChoice ?? "auto";
  }

  const result = await orthogonalRun("baseten", "/v1/chat/completions", body);

  if (!result.ok) {
    return {
      ok: false,
      data: (result.data as Record<string, unknown>) ?? {},
      error: result.error,
    };
  }

  const wrapper = result.data as Record<string, unknown>;
  const inner = (wrapper.data ?? wrapper) as Record<string, unknown>;
  return { ok: true, data: inner };
}

function formatOrthogonalError(
  status: number,
  data: Record<string, unknown>,
): string {
  const message = (data.message ?? data.error ?? "Unknown error") as string;
  if (status === 401) {
    return `Orthogonal API key is invalid or inactive (${message}). Create a new live key at https://orthogonal.com/dashboard/settings/api-keys and run: supabase secrets set ORTHOGONAL_API_KEY=orth_live_... && supabase functions deploy chat`;
  }
  if (status === 402) {
    return "Insufficient credits. Add balance at https://orthogonal.com/dashboard/balance";
  }
  if (status === 428) {
    return `Integration not connected. Connect at https://orthogonal.com/dashboard/integrations — ${message}`;
  }
  if (status === 404) {
    return `API or endpoint not found: ${message}. Try orthogonal_search to find the correct api/path.`;
  }
  if (status === 429) {
    return `Rate limited by Orthogonal or an upstream API. Wait a minute and try again, or ask a narrower question (fewer tool calls). (${message})`;
  }
  if (status >= 500) {
    return `Upstream API error (${status}): ${message}`;
  }
  return message;
}

export function truncatePreview(value: unknown, max = 500): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

/** Cap tool payloads sent back to the LLM so large API responses don't break chat completions. */
export function truncateToolContentForModel(content: string, max = 14000): string {
  if (content.length <= max) return content;
  return (
    content.slice(0, max) +
    `\n…[truncated ${content.length - max} chars for model context]`
  );
}

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "orthogonal_search",
      description:
        "Search Orthogonal's API catalog using natural language. Call at most once per user request.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Natural language description of what API you need",
          },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "orthogonal_get_details",
      description:
        "Get full parameter information for one API endpoint. Call once for your chosen API before orthogonal_use.",
      parameters: {
        type: "object",
        properties: {
          api: { type: "string", description: "API slug from search results" },
          path: { type: "string", description: "Endpoint path from search results" },
        },
        required: ["api", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "orthogonal_use",
      description:
        "Execute an API call through Orthogonal. Returns real data from the underlying provider.",
      parameters: {
        type: "object",
        properties: {
          api: { type: "string", description: "API slug" },
          path: { type: "string", description: "Endpoint path" },
          body: {
            type: "object",
            description: "Request body parameters",
          },
          query: {
            type: "object",
            description: "Query string parameters",
          },
        },
        required: ["api", "path"],
      },
    },
  },
];

export function toolStartLabel(
  tool: string,
  args: Record<string, unknown>,
): string {
  switch (tool) {
    case "orthogonal_search":
      return "Searching the API catalog…";
    case "orthogonal_get_details":
      return "Fetching endpoint details…";
    case "orthogonal_use":
      return `Calling ${args.api ?? "api"}${args.path ?? ""}…`;
    default:
      return `Running ${tool}…`;
  }
}

export function toolDoneLabel(
  tool: string,
  args: Record<string, unknown>,
): string {
  switch (tool) {
    case "orthogonal_search":
      return "Searched the API catalog";
    case "orthogonal_get_details":
      return `Ran get_details on ${args.api ?? "api"}`;
    case "orthogonal_use":
      return `Ran ${args.api ?? "api"} ${args.path ?? ""}`;
    default:
      return `Ran ${tool}`;
  }
}
