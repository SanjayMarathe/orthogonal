import type { ChatMessage } from "./types.ts";
import { extractTaggedSlugs } from "./integrations.ts";
import { isCompanyResearchIntent } from "./taggedApiRun.ts";

const AFFIRMATION_RE =
  /^(?:yeah|yes|yep|yup|sure|ok(?:ay)?|please|go ahead|do it|do that|sounds good|exactly|correct|please do|that works|let'?s do it)(?:[,.!?]\s*|\s+(?:do it|do that|please)[,.!?]?\s*)*$/i;

const AFFIRMATION_PREFIX_RE =
  /^(?:yeah|yes|yep|yup|sure|ok(?:ay)?|please)[,.]?\s+(?:do\s+(?:it|that)|go\s+ahead)/i;

const AFFIRMATION_SUFFIX_RE =
  /\s*(?:[,.\s]+|\s+)(?:yeah|yes|yep|yup|sure|ok(?:ay)?|please)?\s*do this\.?\s*$/i;

/** Short replies that refer to the prior assistant suggestion. */
export function isFollowUpAffirmation(text: string): boolean {
  const t = text.trim();
  if (t.length <= 120 && (AFFIRMATION_RE.test(t) || AFFIRMATION_PREFIX_RE.test(t))) {
    return true;
  }
  if (AFFIRMATION_SUFFIX_RE.test(t)) return true;
  if (/\b(?:go ahead|do it|do that)\.?\s*$/i.test(t) && t.length <= 160) return true;
  return false;
}

/** Remove trailing "do this" / "yeah do that" from pasted assistant replies. */
export function stripFollowUpSuffix(text: string): string {
  return text.replace(AFFIRMATION_SUFFIX_RE, "").trim();
}

export function isNewsOrWebIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(news|latest|announce|launch|product line|this quarter|this week|today|cited? sources?|web search|recent)\b/
    .test(t);
}

/** Pull a concrete search topic from the assistant's prior suggestion. */
export function extractTopicFromAssistantSuggestion(
  assistant: string,
): string | null {
  const patterns = [
    /search(?:ing)?\s+for\s+([^.!\n]+)/i,
    /suggest(?:ing)?\s+(?:search(?:ing)?\s+for\s+)?([^.!\n]+)/i,
    /try(?:ing)?\s+(?:@?\w+\s+)?(?:for\s+)?([^.!\n]+)/i,
  ];
  for (const re of patterns) {
    const m = assistant.match(re);
    if (m?.[1]) {
      const topic = m[1].trim().replace(/\s+using\s+the\s+.*$/i, "");
      if (topic.length > 8) return topic;
    }
  }
  return null;
}

/**
 * Expand "yeah do that" into the real user intent using conversation history.
 * Other chat apps do this by sending full history to the LLM; we also resolve
 * explicitly so tool prompts never receive bare affirmations.
 */
export function resolveEffectiveUserQuery(
  messages: ChatMessage[],
  rawUserMessage: string,
): string {
  const raw = rawUserMessage.trim();
  const stripped = stripFollowUpSuffix(raw);
  const isFollowUp =
    isFollowUpAffirmation(raw) ||
    isFollowUpAffirmation(stripped) ||
    AFFIRMATION_SUFFIX_RE.test(raw);

  if (!isFollowUp) return raw;

  const userMsgs = messages.filter((m) => m.role === "user" && m.content?.trim());
  if (userMsgs.length >= 2) {
    for (let i = userMsgs.length - 2; i >= 0; i--) {
      const prior = userMsgs[i].content!.trim();
      const priorStripped = stripFollowUpSuffix(prior);
      const candidate = priorStripped.length > 8 ? priorStripped : prior;
      if (candidate.length > 8 && !isFollowUpAffirmation(candidate)) {
        return candidate;
      }
    }
  }

  return stripped.length > 8 && !isFollowUpAffirmation(stripped) ? stripped : raw;
}

import type { SessionEndpoint } from "./apiSession.ts";

export type PriorToolContext = {
  catalogSearchPrompt?: string;
  catalogSearchResult?: string;
  effectiveQuery?: string;
  intent?: string;
  /** API slug the user was working with (@tag or capability intro). */
  activeSlug?: string;
  /** Endpoints shown in the prior capability card or last successful call. */
  endpoints?: SessionEndpoint[];
  lastEndpoint?: SessionEndpoint;
};

export function priorContextFromMetadata(
  meta: Record<string, unknown> | null | undefined,
): PriorToolContext | null {
  if (!meta) return null;
  const tc = meta.toolContext as PriorToolContext | undefined;
  if (
    tc?.activeSlug ||
    tc?.endpoints?.length ||
    tc?.catalogSearchResult ||
    tc?.catalogSearchPrompt
  ) {
    return tc;
  }
  return null;
}

/** Extract @slug from recent user messages or assistant capability cards. */
export function resolveInheritedTaggedApis(
  messages: ChatMessage[],
  priorToolContext: PriorToolContext | null,
  currentTaggedApis: string[],
): string[] {
  if (currentTaggedApis.length > 0) return [];

  if (priorToolContext?.activeSlug) {
    return [priorToolContext.activeSlug.toLowerCase()];
  }

  const recent = messages.slice(-8);
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    if (m.role === "user") {
      const tags = extractTaggedSlugs(m.content ?? "");
      if (tags.length > 0) return [tags[tags.length - 1]];
    }
    if (m.role === "assistant" && m.content) {
      const backtick = m.content.match(/`@([a-z0-9_-]+)`/i);
      if (backtick) return [backtick[1].toLowerCase()];
      const paren = m.content.match(/\(@([a-z0-9_-]+)\)/i);
      if (paren) return [paren[1].toLowerCase()];
    }
  }
  return [];
}

/**
 * Continue the prior @slug session on short follow-ups ("what are the popular creators?").
 */
export function shouldInheritApiContext(
  query: string,
  inheritedTaggedApis: string[],
): boolean {
  if (inheritedTaggedApis.length === 0) return false;

  const t = query.trim();
  if (t.length <= 120) return true;

  const lower = t.toLowerCase();
  if (isNewsOrWebIntent(query) && !/\b(tiktok|youtube|reddit|kick|creator|clip|playlist)\b/.test(lower)) {
    return false;
  }
  if (isCompanyResearchIntent(query, [])) return false;

  return false;
}

/** Inject prior turn API context so the model and synthesizer see it. */
export function buildContextInjection(
  prior: PriorToolContext | null,
  effectiveQuery: string,
): string | null {
  if (!prior?.catalogSearchResult && !prior?.catalogSearchPrompt && !prior?.activeSlug) {
    return null;
  }
  const parts = [
    "[Conversation context — prior turn API data]",
    `Resolved user intent: ${effectiveQuery}`,
  ];
  if (prior.activeSlug) {
    parts.push(
      `Active API from prior turn: @${prior.activeSlug}. Continue using this slug unless the user clearly switches APIs.`,
    );
  }
  if (prior.catalogSearchPrompt) {
    parts.push(`Prior catalog search prompt: ${prior.catalogSearchPrompt}`);
  }
  if (prior.catalogSearchResult) {
    parts.push(
      `Prior catalog search results (reuse — do NOT search again for affirmations like "yes do that"):\n${prior.catalogSearchResult.slice(0, 4000)}`,
    );
  }
  return parts.join("\n");
}

export function buildToolContextSnapshot(
  effectiveQuery: string,
  catalogSearchPrompt: string | undefined,
  catalogSearchResult: string | undefined,
  activeSlug?: string,
  endpoints?: SessionEndpoint[],
  lastEndpoint?: SessionEndpoint,
): PriorToolContext {
  return {
    effectiveQuery,
    catalogSearchPrompt,
    catalogSearchResult: catalogSearchResult?.slice(0, 8000),
    activeSlug,
    endpoints: endpoints?.slice(0, 24),
    lastEndpoint,
  };
}
