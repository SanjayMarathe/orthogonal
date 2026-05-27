import {
  buildFailureSummary,
  extractSlugsFromSearchJson,
  isApiSlugAllowed,
  rejectUnknownApi,
} from "./apiGuard.ts";
import {
  countCrustdataDecisionMakers,
  crustdataRetryQuery,
} from "./crustdataHelpers.ts";
import { companyNameFromDomain } from "./crustdataHelpers.ts";
import { formatLeadershipFallback, extractCompanyDomain } from "./leadership.ts";
import { llmChat, llmChatStream, llmChatStreamWithTools } from "./llm.ts";
import {
  formatToolResultsFallback,
  synthesizeFromToolResults,
} from "./synthesize.ts";
import { isCapabilityQuestion } from "./integrations.ts";
import {
  isCompanyResearchIntent,
  stripTaggedHandles,
  taggedApiRunSpec,
} from "./taggedApiRun.ts";
import { tryTaggedApiIntroAnswer } from "./taggedApiIntro.ts";
import {
  buildContextInjection,
  buildToolContextSnapshot,
  isFollowUpAffirmation,
  resolveEffectiveUserQuery,
  resolveInheritedTaggedApis,
  shouldInheritApiContext,
  type PriorToolContext,
} from "./conversationContext.ts";
import {
  inferUseArgsFromDetails,
  isTopicSwitch,
  matchFollowUpToEndpoint,
  planUseArgsWithLlm,
  resolveApiSession,
  sessionContextInjection,
  type ApiSessionState,
} from "./apiSession.ts";
import {
  classifyQueryIntent,
  intentPlanNeedsTools,
  intentPlanSummary,
  type IntentPlan,
} from "./intentRouter.ts";
import {
  orthogonalGetDetails,
  orthogonalRun,
  orthogonalSearch,
  toolDoneLabel,
  toolStartLabel,
  TOOL_DEFINITIONS,
  truncatePreview,
  truncateToolContentForModel,
} from "./orthogonal.ts";
import type { ChatMessage, SseEvent, ToolStep } from "./types.ts";

const SYSTEM_PROMPT = `You are an AI assistant with access to Orthogonal's unified API platform for real API data.

CRITICAL:
- Only use API slugs from orthogonal_search results or trusted slugs: crustdata, company-enrich, contactout, nyne, aviato, openfunnel, apollo.
- NEVER call crunchbase, zoominfo, or clearbit — they are not on Orthogonal.
- Call orthogonal_get_details before orthogonal_use; pass query params as strings (from get_details schema).
- If all tools fail, say so — never invent company data, funding, or people.

Workflow:
1. Intent is classified before tools (news → @perplexity web search; company data → company-enrich/crustdata). Do NOT call the OpenAI/Stripe/etc. API slug when the user asks about that company in the news.
2. orthogonal_search uses capability keywords (e.g. "web search news API"), NOT bare company names — those match the wrong API slug.
3. For company research (profile, headcount, funding, executives): use company-enrich GET /companies/enrich?domain=..., GET /companies/workforce?domain=..., POST /companies/similar, and crustdata GET /screener/company with company_domain or company_name and fields=decision_makers,company_name.
4. For VP+ / C-suite contacts: crustdata GET /screener/company — prefer company_name over company_domain (domain can match wrong subsidiaries). Use fields including decision_makers.
5. After tools return, your final reply must be readable markdown — not raw JSON.

Before every tool call, write 1–3 sentences in plain natural language explaining what you are about to do and why. Never use arrow prefixes or robotic status lines like "→ Searching…".

Only mention email/SMS sending if the user explicitly asked to send a message.

Slash commands: /clear, /compress.`;

const CHAT_SYSTEM_PROMPT = `You are a helpful assistant. Answer clearly and concisely. This app can call external data APIs when the user asks for live data; for normal chat, just reply. Slash commands: /clear, /compress.`;

/** Supabase edge wall clock ~150s — stop calling tools early so synthesis always runs. */
const EDGE_BUDGET_MS = 138_000;
const MAX_TOOL_STEPS_BEFORE_SYNTH = 3;

const SENSITIVE_RESULT_KEYS = new Set([
  "apikey",
  "apiKey",
  "authorization",
  "access_token",
  "refresh_token",
  "token",
  "secret",
  "password",
]);

function redactSecretsInJsonString(raw: string): string {
  // Redact common secret fields even when they appear inside a nested JSON string.
  return raw
    .replace(
      /("?(?:apiKey|apikey|authorization|access_token|refresh_token|token|secret|password)"?\s*:\s*")([^"]+)(")/gi,
      '$1[REDACTED]$3',
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
}

function redactSecretsDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecretsDeep);
  if (!value || typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_RESULT_KEYS.has(k) || SENSITIVE_RESULT_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactSecretsDeep(v);
    }
  }
  return out;
}

function sanitizeToolResultJson(raw: string): string {
  const preRedacted = redactSecretsInJsonString(raw);
  try {
    const parsed = JSON.parse(preRedacted) as unknown;
    return JSON.stringify(redactSecretsDeep(parsed));
  } catch {
    return preRedacted;
  }
}

export type ToolCache = {
  details: Map<string, string>;
  search: Map<string, string>;
  searchCalls: number;
  allowedSlugs: Set<string>;
  searchBlockedNotified: boolean;
  lastSearchStepId?: string;
};

function refreshAllowedSlugs(cache: ToolCache): void {
  for (const raw of cache.search.values()) {
    for (const slug of extractSlugsFromSearchJson(raw)) {
      cache.allowedSlugs.add(slug);
    }
  }
}

function isToolFailureMessage(text: string): boolean {
  return (
    text.includes("tool call validation failed") ||
    text.includes("Failed to call a function")
  );
}

function slugAllowed(api: string, cache?: ToolCache): boolean {
  if (!cache) return isApiSlugAllowed(api, new Set(), 0);
  return isApiSlugAllowed(api, cache.allowedSlugs, cache.searchCalls);
}

function rejectApi(api: string, cache?: ToolCache): string {
  return rejectUnknownApi(api, cache?.allowedSlugs ?? new Set());
}

export type EmitFn = (event: SseEvent) => void;

async function answerDirectly(
  model: string,
  messages: ChatMessage[],
  emit: EmitFn,
): Promise<{ assistantContent: string; contentStreamed: boolean }> {
  emit({ type: "thinking", label: "Generating your answer…" });
  let assistantContent = "";
  const streamRes = await llmChatStream(
    model,
    [{ role: "system", content: CHAT_SYSTEM_PROMPT }, ...messages],
    (token) => {
      assistantContent += token;
      emit({ type: "token", content: token });
    },
    { toolChoice: "none", maxTokens: 2048 },
  );
  const content = (streamRes.content || assistantContent).trim();
  if (!content) {
    return {
      assistantContent: "I couldn't generate a response.",
      contentStreamed: false,
    };
  }
  if (!streamRes.ok && !assistantContent) {
    streamTokens(content, emit);
  }
  return { assistantContent: content, contentStreamed: Boolean(assistantContent) };
}

function coerceToolArgs(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return { ...args };
}

function appendAgentReasoning(emit: EmitFn, text: string) {
  if (!text) return;
  emit({ type: "reasoning_delta", placement: "agent", content: text });
}

function appendStepReasoning(emit: EmitFn, stepId: string, text: string) {
  if (!text) return;
  emit({ type: "reasoning_delta", stepId, content: text });
}

function appendAfterToolsReasoning(emit: EmitFn, text: string) {
  if (!text) return;
  emit({ type: "reasoning_delta", placement: "after_tools", content: text });
}

function hasSuccessfulApiRun(toolSteps: ToolStep[]): boolean {
  return toolSteps.some(
    (s) => s.status === "done" && s.tool === "orthogonal_use",
  );
}

/** Fetch live company data when the LLM only ran search/get_details. */
async function ensureLiveDataFetched(
  userMessage: string,
  workingMessages: ChatMessage[],
  toolSteps: ToolStep[],
  emitLive: EmitFn,
  cache: ToolCache,
  taggedApis: string[] = [],
): Promise<void> {
  if (!isCompanyResearchIntent(userMessage, taggedApis)) return;
  if (hasSuccessfulApiRun(toolSteps)) return;

  const domain =
    extractCompanyDomain(userMessage) ??
    userMessage.match(/\b([a-z0-9-]+\.(?:com|io|co|so|ai))\b/i)?.[1]
      ?.toLowerCase() ??
    null;
  if (!domain) return;

  const companyName = companyNameFromDomain(domain);
  appendAgentReasoning(
    emitLive,
    `Pulling live headcount and leadership data for ${companyName ?? domain}.\n`,
  );

  const fetches: Array<{
    api: string;
    path: string;
    query: Record<string, string>;
  }> = [
    {
      api: "company-enrich",
      path: "/companies/workforce",
      query: { domain },
    },
    {
      api: "company-enrich",
      path: "/companies/enrich",
      query: { domain },
    },
    {
      api: "crustdata",
      path: "/screener/company",
      query: {
        // Use domain-first for better matching on unknown/ambiguous company names.
        // crustdataRetryQuery can still retry with a derived company_name if decision_makers is empty.
        company_domain: domain,
        fields: "decision_makers,company_name,headcount",
      },
    },
  ];

  for (const spec of fetches) {
    const id = `live_${spec.api}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const { content, step } = await executeTool(
      "orthogonal_use",
      spec,
      emitLive,
      id,
      cache,
    );
    if (step) toolSteps.push(step);
    workingMessages.push({ role: "tool", tool_call_id: id, content });
  }
}

async function finalizeAnswer(
  workingMessages: ChatMessage[],
  toolSteps: ToolStep[],
  userMessage: string,
  model: string,
  emitLive: EmitFn,
  timeLeftMs: () => number,
): Promise<{ content: string; streamed: boolean }> {
  const deterministic =
    formatToolResultsFallback(workingMessages) ??
    formatLeadershipFallback(workingMessages);

  if (timeLeftMs() < 35_000) {
    if (deterministic) return { content: deterministic, streamed: false };
    if (toolSteps.length > 0) {
      return {
        content: buildFailureSummary(
          toolSteps.map((s) => ({
            label: s.label,
            status: s.status === "error" ? "error" : "done",
          })),
        ),
        streamed: false,
      };
    }
  }

  const synthesized = await synthesizeFromToolResults(
    workingMessages,
    model,
    emitLive,
  );
  if (synthesized.content.trim()) return synthesized;

  if (deterministic) return { content: deterministic, streamed: false };

  return {
    content:
      `I searched Orthogonal's API catalog for your question about "${userMessage.slice(0, 80)}" ` +
      "but couldn't retrieve enough live data to answer confidently. " +
      "Try `@company-enrich` or `@crustdata` with a specific domain (e.g. shopify.com).",
    streamed: false,
  };
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  emit: EmitFn,
  stepId: string,
  cache?: ToolCache,
): Promise<{ content: string; step: ToolStep | null }> {
  if (
    name === "orthogonal_search" &&
    cache &&
    cache.searchCalls >= 1
  ) {
    const prompt = String(args.prompt ?? "");
    const cacheKey = `${prompt}:5`;
    if (!cache.search.has(cacheKey)) {
      if (!cache.searchBlockedNotified) {
        cache.searchBlockedNotified = true;
        const note =
          "I already searched the API catalog this turn, so I'll use those results for the next calls.\n";
        if (cache.lastSearchStepId) {
          appendStepReasoning(emit, cache.lastSearchStepId, note);
        } else {
          appendAfterToolsReasoning(emit, note);
        }
      }
      const prior = cache.search.values().next().value ?? "{}";
      const resultContent = JSON.stringify({
        error:
          "orthogonal_search already ran this turn. Use the prior search results and call orthogonal_get_details then orthogonal_use. Do not search again.",
        priorSearchPreview: truncatePreview(prior, 800),
      });
      return { content: truncateToolContentForModel(resultContent), step: null };
    }
  }

  const startLabel = toolStartLabel(name, args);
  emit({
    type: "tool_start",
    id: stepId,
    tool: name,
    label: startLabel,
    args,
  });

  const start = Date.now();
  let resultContent: string;
  let success = true;
  let resultPreview = "";
  let meta: ToolStep["meta"] = {};

  try {
    if (name === "orthogonal_search") {
      const prompt = String(args.prompt ?? "");
      const limit = 5;
      const cacheKey = `${prompt}:${limit}`;
      if (cache?.search.has(cacheKey)) {
        resultContent = cache.search.get(cacheKey)!;
        resultContent = sanitizeToolResultJson(resultContent);
        resultPreview = truncatePreview(resultContent);
        if (cache.searchCalls === 0) cache.searchCalls = 1;
      } else {
        const res = await orthogonalSearch(prompt, limit);
        success = res.ok;
        resultContent = res.ok
          ? JSON.stringify(res.data)
          : JSON.stringify({ error: res.error, data: res.data });
        resultContent = sanitizeToolResultJson(resultContent);
        resultPreview = truncatePreview(resultContent);
        if (res.ok) {
          cache?.search.set(cacheKey, resultContent);
          if (cache) {
            cache.searchCalls += 1;
            cache.lastSearchStepId = stepId;
            refreshAllowedSlugs(cache);
          }
        }
      }
    } else if (name === "orthogonal_get_details") {
      const api = String(args.api ?? "");
      const path = String(args.path ?? "");
      if (!slugAllowed(api, cache)) {
        success = false;
        resultContent = rejectApi(api, cache);
        resultPreview = truncatePreview(resultContent);
      } else {
        const cacheKey = `${api}:${path}`;
        if (cache?.details.has(cacheKey)) {
          resultContent = cache.details.get(cacheKey)!;
          resultContent = sanitizeToolResultJson(resultContent);
          resultPreview = truncatePreview(resultContent);
        } else {
          const res = await orthogonalGetDetails(api, path);
          success = res.ok;
          resultContent = res.ok
            ? JSON.stringify(res.data)
            : JSON.stringify({ error: res.error, data: res.data });
          resultContent = sanitizeToolResultJson(resultContent);
          resultPreview = truncatePreview(resultContent);
          if (res.ok) cache?.details.set(cacheKey, resultContent);
        }
      }
    } else if (name === "orthogonal_use") {
      const api = String(args.api ?? "");
      const path = String(args.path ?? "");
      if (!slugAllowed(api, cache)) {
        success = false;
        resultContent = rejectApi(api, cache);
        resultPreview = truncatePreview(resultContent);
      } else {
        const body = args.body as Record<string, unknown> | undefined;
        const query = args.query as Record<string, unknown> | undefined;
        let res = await orthogonalRun(api, path, body, query);
        if (
          api === "crustdata" &&
          path === "/screener/company" &&
          query &&
          (!res.ok || countCrustdataDecisionMakers(res.data) === 0)
        ) {
          const retryQuery = crustdataRetryQuery(query);
          if (retryQuery) {
            appendAgentReasoning(
              emit,
              "The domain lookup didn't return decision makers, so I'll retry using the company name instead.\n",
            );
            const retry = await orthogonalRun(api, path, body, retryQuery);
            if (
              retry.ok &&
              (!res.ok ||
                countCrustdataDecisionMakers(retry.data) >
                  countCrustdataDecisionMakers(res.data))
            ) {
              res = retry;
            }
          }
        }
        success = res.ok;
        meta = {
          requestId: res.requestId,
          priceCents: res.priceCents,
          durationMs: Date.now() - start,
        };
        resultContent = res.ok
          ? JSON.stringify(res.data)
          : JSON.stringify({ error: res.error, data: res.data });
        resultContent = sanitizeToolResultJson(resultContent);
        resultPreview = truncatePreview(resultContent);
      }
    } else {
      success = false;
      resultContent = JSON.stringify({ error: `Unknown tool: ${name}` });
      resultPreview = resultContent;
    }
  } catch (err) {
    success = false;
    resultContent = JSON.stringify({
      error: err instanceof Error ? err.message : "Tool execution failed",
    });
    resultPreview = resultContent;
  }

  const durationMs = Date.now() - start;
  meta = { ...meta, durationMs: meta.durationMs ?? durationMs };

  // Tool previews are shown in the UI (expanded by default), so ensure
  // secrets (apiKey/tokens) never reach the client.
  resultContent = sanitizeToolResultJson(resultContent);
  resultPreview = truncatePreview(resultContent);

  const doneLabel = toolDoneLabel(name, args);
  emit({
    type: "tool_done",
    id: stepId,
    tool: name,
    label: success ? doneLabel : `${doneLabel} (failed)`,
    success,
    meta,
    resultPreview,
  });

  const step: ToolStep = {
    id: stepId,
    tool: name,
    label: success ? doneLabel : `${doneLabel} (failed)`,
    status: success ? "done" : "error",
    args,
    resultPreview,
    meta,
  };

  // IMPORTANT: Do not "truncate for model" by slicing JSON strings and appending
  // text — it can invalidate JSON and prevent downstream parsing/compaction.
  // The synthesis phase already compacts tool payloads safely.
  return { content: resultContent, step };
}

/**
 * Endpoint-aware session follow-up: get_details → orthogonal_use on the
 * endpoint that best matches the prior capability card + user query.
 */
async function runSessionFollowUpPipeline(
  session: ApiSessionState,
  userQuery: string,
  workingMessages: ChatMessage[],
  toolSteps: ToolStep[],
  emitLive: EmitFn,
  cache: ToolCache,
  model: string,
): Promise<{ ran: boolean; lastEndpoint?: ApiSessionState["lastEndpoint"] }> {
  if (session.endpoints.length === 0) return { ran: false };

  const endpoint =
    matchFollowUpToEndpoint(userQuery, session.endpoints) ??
    session.lastEndpoint ??
    null;
  if (!endpoint) return { ran: false };

  cache.allowedSlugs.add(session.activeSlug);

  appendAgentReasoning(
    emitLive,
    `Using @${session.activeSlug} ${endpoint.method} ${endpoint.path} — ${endpoint.description.slice(0, 80)}.\n`,
  );

  const detailsId = `session_details_${Date.now()}`;
  const { content: detailsContent, step: detailsStep } = await executeTool(
    "orthogonal_get_details",
    { api: session.activeSlug, path: endpoint.path },
    emitLive,
    detailsId,
    cache,
  );
  if (detailsStep) toolSteps.push(detailsStep);
  workingMessages.push({
    role: "tool",
    tool_call_id: detailsId,
    content: detailsContent,
  });

  const spec = taggedApiRunSpec(session.activeSlug, userQuery);
  let useArgs =
    spec?.path === endpoint.path
      ? {
          api: spec.api,
          path: spec.path,
          body: spec.body,
          query: spec.query,
        }
      : inferUseArgsFromDetails(detailsContent, userQuery);

  if (!useArgs) {
    useArgs = await planUseArgsWithLlm(model, detailsContent, userQuery);
  }
  if (!useArgs) {
    useArgs = { api: session.activeSlug, path: endpoint.path, query: {} };
  }

  const useId = `session_use_${Date.now()}`;
  const { content: useContent, step: useStep } = await executeTool(
    "orthogonal_use",
    useArgs,
    emitLive,
    useId,
    cache,
  );
  if (useStep) toolSteps.push(useStep);
  workingMessages.push({ role: "tool", tool_call_id: useId, content: useContent });

  return { ran: true, lastEndpoint: endpoint };
}

async function runTaggedApiPipeline(
  taggedApis: string[],
  userMessage: string,
  workingMessages: ChatMessage[],
  toolSteps: ToolStep[],
  emitLive: EmitFn,
  cache: ToolCache,
): Promise<boolean> {
  if (taggedApis.length === 0) return false;

  const slug = taggedApis[0].toLowerCase();
  cache.allowedSlugs.add(slug);

  const spec = taggedApiRunSpec(slug, userMessage);
  if (!spec) return false;

  appendAgentReasoning(
    emitLive,
    `Searching with @${slug} for: ${stripTaggedHandles(userMessage).slice(0, 120)}…\n`,
  );

  const id = `tagged_${slug}_${Date.now()}`;
  const { content, step } = await executeTool(
    "orthogonal_use",
    spec,
    emitLive,
    id,
    cache,
  );
  if (step) toolSteps.push(step);
  workingMessages.push({ role: "tool", tool_call_id: id, content });
  return true;
}

function captureCatalogSearchContext(
  effectiveQuery: string,
  toolSteps: ToolStep[],
  workingMessages: ChatMessage[],
): PriorToolContext {
  const searchStep = toolSteps.find((s) => s.tool === "orthogonal_search");
  let searchContent: string | undefined;
  if (searchStep) {
    const msg = workingMessages.find(
      (m) => m.role === "tool" && m.tool_call_id === searchStep.id,
    );
    searchContent = typeof msg?.content === "string" ? msg.content : undefined;
  }
  return buildToolContextSnapshot(
    effectiveQuery,
    (searchStep?.args?.prompt as string | undefined) ?? effectiveQuery,
    searchContent,
    undefined,
  );
}

function injectPriorCatalogSearch(
  prior: PriorToolContext,
  workingMessages: ChatMessage[],
  cache: ToolCache,
): void {
  if (!prior.catalogSearchResult) return;
  cache.searchCalls = 1;
  const id = `search_prior_${Date.now()}`;
  workingMessages.push({
    role: "tool",
    tool_call_id: id,
    content: prior.catalogSearchResult,
  });
}

async function runCatalogSearchOnce(
  userMessage: string,
  workingMessages: ChatMessage[],
  toolSteps: ToolStep[],
  emitLive: EmitFn,
  cache: ToolCache,
): Promise<void> {
  if (cache.searchCalls > 0) return;
  appendAgentReasoning(
    emitLive,
    "Searching the API catalog for relevant data sources.\n",
  );
  const id = `search_${Date.now()}`;
  const { content, step } = await executeTool(
    "orthogonal_search",
    { prompt: userMessage.slice(0, 400) },
    emitLive,
    id,
    cache,
  );
  if (step) toolSteps.push(step);
  workingMessages.push({ role: "tool", tool_call_id: id, content });
}

async function runSingleToolRound(
  model: string,
  workingMessages: ChatMessage[],
  toolSteps: ToolStep[],
  emitLive: EmitFn,
  cache: ToolCache,
  emit: EmitFn,
): Promise<void> {
  emit({ type: "thinking", label: "Planning API calls…" });
  const res = await llmChatStreamWithTools(
    model,
    workingMessages,
    TOOL_DEFINITIONS,
    (piece) => appendAgentReasoning(emitLive, piece),
    { toolChoice: "auto", maxTokens: 2048 },
  );
  if (!res.ok) return;

  const choice = (res.data.choices as Array<Record<string, unknown>>)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  if (!message) return;

  const toolCalls = message.tool_calls as
    | Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>
    | undefined;
  if (!toolCalls?.length) return;

  const reasoningText = (message.content as string) ?? "";
  workingMessages.push({
    role: "assistant",
    content: reasoningText || null,
    tool_calls: toolCalls.slice(0, 2).map((tc) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(tc.function.arguments);
      } catch {
        parsed = {};
      }
      const fixed = coerceToolArgs(tc.function.name, parsed);
      return {
        ...tc,
        function: { ...tc.function, arguments: JSON.stringify(fixed) },
      };
    }),
  });

  for (const tc of toolCalls.slice(0, 2)) {
    if (toolSteps.length >= MAX_TOOL_STEPS_BEFORE_SYNTH) break;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      args = {};
    }
    args = coerceToolArgs(tc.function.name, args);
    const { content, step } = await executeTool(
      tc.function.name,
      args,
      emitLive,
      tc.id,
      cache,
    );
    if (step) toolSteps.push(step);
    workingMessages.push({ role: "tool", tool_call_id: tc.id, content });
  }
}

async function executeIntentPlan(
  plan: IntentPlan,
  workingMessages: ChatMessage[],
  toolSteps: ToolStep[],
  emitLive: EmitFn,
  cache: ToolCache,
  priorToolContext: PriorToolContext | null,
  followUpAffirmation: boolean,
): Promise<void> {
  for (const { slug } of plan.directApis) {
    cache.allowedSlugs.add(slug.toLowerCase());
    await runTaggedApiPipeline(
      [slug],
      plan.topicQuery,
      workingMessages,
      toolSteps,
      emitLive,
      cache,
    );
  }

  if (hasSuccessfulApiRun(toolSteps)) return;

  const priorQuery =
    priorToolContext?.effectiveQuery ?? priorToolContext?.catalogSearchPrompt;
  const reusePriorSearch =
    followUpAffirmation &&
    !!priorToolContext?.catalogSearchResult &&
    (!priorQuery || priorQuery === plan.topicQuery);

  if (reusePriorSearch && priorToolContext?.catalogSearchResult) {
    appendAgentReasoning(
      emitLive,
      "Reusing API catalog results from the previous turn.\n",
    );
    injectPriorCatalogSearch(priorToolContext, workingMessages, cache);
    return;
  }

  await runCatalogSearchOnce(
    plan.catalogSearchPrompt,
    workingMessages,
    toolSteps,
    emitLive,
    cache,
  );
}

export async function runAgentLoop(
  messages: ChatMessage[],
  emit: EmitFn,
  taggedApis: string[] = [],
  model = "groq:llama-3.3-70b-versatile",
  priorToolContext: PriorToolContext | null = null,
): Promise<{
  assistantContent: string;
  toolSteps: ToolStep[];
  reasoningLog: string;
  usageTokens?: number;
  contentStreamed: boolean;
  toolContext?: PriorToolContext;
}> {
  const userMessage =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const effectiveUserQuery = resolveEffectiveUserQuery(messages, userMessage);
  const followUpAffirmation = isFollowUpAffirmation(userMessage);
  const inheritedRaw = resolveInheritedTaggedApis(
    messages,
    priorToolContext,
    taggedApis,
  );
  const apiSession = resolveApiSession(messages, priorToolContext);
  const topicSwitch =
    apiSession != null &&
    isTopicSwitch(effectiveUserQuery, apiSession.activeSlug);
  const inheritContext =
    inheritedRaw.length > 0 &&
    !topicSwitch &&
    (shouldInheritApiContext(effectiveUserQuery, inheritedRaw) ||
      (apiSession?.endpoints?.length ?? 0) > 0);
  const inheritedTaggedApis = inheritContext ? inheritedRaw : [];
  const routingTaggedApis =
    taggedApis.length > 0 ? taggedApis : inheritedTaggedApis;

  const intentPlan = await classifyQueryIntent(
    model,
    messages,
    effectiveUserQuery,
    taggedApis,
    inheritedTaggedApis,
  );

  const planNeedsTools = intentPlanNeedsTools(intentPlan);

  if (!planNeedsTools) {
    const { assistantContent, contentStreamed } = await answerDirectly(
      model,
      messages,
      emit,
    );
    return {
      assistantContent,
      toolSteps: [],
      reasoningLog: "",
      usageTokens: undefined,
      contentStreamed,
      toolContext: undefined,
    };
  }

  let reasoningLog = "";

  const emitLive: EmitFn = (event) => {
    if (event.type === "reasoning_delta" && event.content) {
      reasoningLog += event.content;
    }
    if (event.type === "tool_start" && event.reasoningBefore) {
      reasoningLog += event.reasoningBefore;
    }
    if (event.type === "tool_done" && event.reasoningAfter) {
      reasoningLog += event.reasoningAfter;
    }
    emit(event);
  };

  appendAgentReasoning(
    emitLive,
    `Routing as ${intentPlanSummary(intentPlan)}.\n`,
  );

  const intro =
    taggedApis.length > 0 && isCapabilityQuestion(userMessage)
      ? await tryTaggedApiIntroAnswer(userMessage, taggedApis, emitLive)
      : null;
  if (intro?.content) {
    const primary = intro.sessions[0];
    return {
      assistantContent: intro.content,
      toolSteps: intro.toolSteps,
      reasoningLog,
      usageTokens: undefined,
      contentStreamed: false,
      toolContext: primary
        ? {
            activeSlug: primary.activeSlug,
            endpoints: primary.endpoints,
            effectiveQuery: userMessage,
          }
        : {
            activeSlug: taggedApis[0]?.toLowerCase(),
            effectiveQuery: userMessage,
          },
    };
  }

  let contentStreamed = false;
  const toolSteps: ToolStep[] = [];
  let systemPrompt = SYSTEM_PROMPT;
  if (taggedApis.length > 0) {
    systemPrompt +=
      `\n\nThe user tagged these Orthogonal API handles: ${taggedApis.map((s) => `@${s}`).join(", ")}. ` +
      "Use orthogonal_get_details and orthogonal_use with these api slugs. Do NOT call orthogonal_search unless you need a different API. " +
      "For @openfunnel: account/people filters, audience creation, and audience listing.";
  } else if (routingTaggedApis.length > 0) {
    systemPrompt +=
      `\n\nThe user is continuing a session with @${routingTaggedApis[0]} from a prior turn. ` +
      "Use orthogonal_get_details and orthogonal_use with that api slug. Do NOT switch to scrapegraphai or company-enrich unless they ask for a different API.";
  }
  const contextInjection = buildContextInjection(
    priorToolContext,
    effectiveUserQuery,
  );
  if (contextInjection) {
    systemPrompt += `\n\n${contextInjection}`;
  }
  if (apiSession?.endpoints?.length && inheritedTaggedApis.length > 0) {
    systemPrompt += `\n\n${sessionContextInjection(apiSession)}`;
  }
  const workingMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  let assistantContent = "";
  let usageTokens: number | undefined;
  const startedMs = Date.now();
  const edgeDeadlineMs = startedMs + EDGE_BUDGET_MS;
  const timeLeftMs = () => edgeDeadlineMs - Date.now();
  const cache: ToolCache = {
    details: new Map(),
    search: new Map(),
    searchCalls: 0,
    allowedSlugs: new Set(),
    searchBlockedNotified: false,
  };

  for (const tag of routingTaggedApis) {
    cache.allowedSlugs.add(tag.toLowerCase());
  }

  let sessionLastEndpoint = apiSession?.lastEndpoint;
  const sessionResult =
    apiSession && !topicSwitch && routingTaggedApis.length > 0
      ? await runSessionFollowUpPipeline(
          apiSession,
          effectiveUserQuery,
          workingMessages,
          toolSteps,
          emitLive,
          cache,
          model,
        )
      : { ran: false };
  sessionLastEndpoint = sessionResult.lastEndpoint ?? sessionLastEndpoint;
  const sessionHandled = sessionResult.ran;

  appendAgentReasoning(emitLive, "Understanding what kind of data you need…\n");

  if (followUpAffirmation && effectiveUserQuery !== userMessage.trim()) {
    appendAgentReasoning(
      emitLive,
      `Continuing from your earlier question: ${effectiveUserQuery.slice(0, 140)}${effectiveUserQuery.length > 140 ? "…" : ""}\n`,
    );
  }

  if (!sessionHandled) {
    await executeIntentPlan(
      intentPlan,
      workingMessages,
      toolSteps,
      emitLive,
      cache,
      priorToolContext,
      followUpAffirmation,
    );
  }

  const companyResearch = intentPlan.intent === "company_research";

  if (!intentPlan.skipLlmToolRound && taggedApis.length > 0 && timeLeftMs() > 55_000) {
    appendAgentReasoning(
      emitLive,
      `Planning how to call @${taggedApis.join(", @")}…\n`,
    );
    await runSingleToolRound(
      model,
      workingMessages,
      toolSteps,
      emitLive,
      cache,
      emit,
    );
  } else if (
    !intentPlan.skipLlmToolRound &&
    taggedApis.length === 0 &&
    timeLeftMs() > 55_000 &&
    !hasSuccessfulApiRun(toolSteps)
  ) {
    if (companyResearch) {
      appendAgentReasoning(
        emitLive,
        `Looking up headcount, industry, and leadership for ${extractCompanyDomain(effectiveUserQuery) ?? "the company"}.\n`,
      );
    }
    await runSingleToolRound(
      model,
      workingMessages,
      toolSteps,
      emitLive,
      cache,
      emit,
    );
  }

  if (isToolFailureMessage(assistantContent)) {
    assistantContent = "";
  }

  await ensureLiveDataFetched(
    // Gating for "company research" should be based on the resolved user query,
    // not the classifier's possibly-truncated topicQuery.
    effectiveUserQuery,
    workingMessages,
    toolSteps,
    emitLive,
    cache,
    taggedApis,
  );

  appendAfterToolsReasoning(
    emitLive,
    "Writing up your answer from the API results.\n",
  );

  emit({ type: "thinking", label: "Writing your answer…" });
  const { content: finalAnswer, streamed } = await finalizeAnswer(
    workingMessages,
    toolSteps,
    intentPlan.topicQuery,
    model,
    emitLive,
    timeLeftMs,
  );

  if (finalAnswer.trim()) {
    assistantContent = finalAnswer;
    if (streamed) {
      contentStreamed = true;
    } else {
      streamTokens(finalAnswer, emitLive);
      contentStreamed = true;
    }
  }

  if (!assistantContent.trim()) {
    const emergency =
      formatToolResultsFallback(workingMessages) ??
      formatLeadershipFallback(workingMessages) ??
      buildFailureSummary(
        toolSteps.map((s) => ({
          label: s.label,
          status: s.status === "error" ? "error" : "done",
        })),
      ) ??
      "Sorry, I couldn't generate a response. Please try again.";
    assistantContent = emergency;
    streamTokens(emergency, emitLive);
    contentStreamed = true;
  }

  const hasToolContext = toolSteps.length > 0 || intentPlan.directApis.length > 0;
  const toolContext = hasToolContext
    ? {
        ...captureCatalogSearchContext(
          intentPlan.topicQuery,
          toolSteps,
          workingMessages,
        ),
        intent: intentPlan.intent,
        catalogSearchPrompt: intentPlan.catalogSearchPrompt,
        activeSlug:
          taggedApis[0]?.toLowerCase() ??
          apiSession?.activeSlug ??
          intentPlan.directApis[0]?.slug ??
          priorToolContext?.activeSlug,
        endpoints: apiSession?.endpoints ?? priorToolContext?.endpoints,
        lastEndpoint: sessionLastEndpoint ?? priorToolContext?.lastEndpoint,
      }
    : undefined;

  return {
    assistantContent,
    toolSteps,
    reasoningLog,
    usageTokens,
    contentStreamed,
    toolContext,
  };
}

export async function compressMessages(
  messages: ChatMessage[],
  model = "groq:llama-3.3-70b-versatile",
): Promise<string> {
  const transcript = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role}: ${m.content ?? ""}`)
    .join("\n\n");

  const res = await llmChat(
    model,
    [
      {
        role: "system",
        content:
          "Summarize the following conversation, preserving all key facts, API results, company names, emails, and data points. Be concise but complete.",
      },
      { role: "user", content: transcript },
    ],
    undefined,
    { toolChoice: "none" },
  );

  if (!res.ok) {
    throw new Error(res.error ?? "Compression failed");
  }

  const choice = (res.data.choices as Array<Record<string, unknown>>)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  return (message?.content as string) ?? "Summary unavailable.";
}

export function streamTokens(content: string, emit: EmitFn): void {
  const chunkSize = 4;
  for (let i = 0; i < content.length; i += chunkSize) {
    emit({ type: "token", content: content.slice(i, i + chunkSize) });
  }
}
