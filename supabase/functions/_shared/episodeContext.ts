import { compactToolPayloadForSummary } from "./compactToolResults.ts";
import { extractCompanyDomain } from "./leadership.ts";
import { isTopicSwitch } from "./apiSession.ts";
import type { SessionEndpoint } from "./apiSession.ts";
import type { PriorToolContext } from "./conversationContext.ts";
import {
  isFollowUpAffirmation,
  isNewsOrWebIntent,
} from "./conversationContext.ts";
import { extractTaggedSlugs } from "./integrations.ts";
import { isCompanyResearchIntent } from "./taggedApiRun.ts";
import {
  intentPlanNeedsTools,
  type IntentPlan,
  type QueryIntent,
} from "./intentRouter.ts";
import type { ToolStep } from "./types.ts";

export type EpisodeState = {
  id: string;
  summary: string;
  intent?: QueryIntent;
  entity?: string;
  activeSlug?: string;
  endpoints?: SessionEndpoint[];
  toolFacts?: string;
  turnIndex: number;
  /** Ephemeral: used only for affirmation catalog reuse, not injected into classifier. */
  catalogSearchPrompt?: string;
  catalogSearchResult?: string;
  effectiveQuery?: string;
};

export type TurnPlan = IntentPlan & {
  continueEpisode: boolean;
  mode: "chat" | QueryIntent;
  episodeBoundary: boolean;
};

const CASUAL_CHAT_RE =
  /^(?:hi|hello|hey|thanks|thank you|ok|okay|test(?:\s+message)?|ping|yo)(?:[,.!?]\s*)*$/i;

function newEpisodeId(): string {
  return `ep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function extractEntity(query: string): string | undefined {
  const domain = extractCompanyDomain(query);
  if (domain) return domain;
  const m = query.match(
    /\b(?:research|about|for)\s+([A-Z][a-zA-Z0-9]+(?:\.[a-z]{2,})?)\b/,
  );
  return m?.[1]?.toLowerCase();
}

function entitiesDiffer(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const na = a.toLowerCase().replace(/^www\./, "");
  const nb = b.toLowerCase().replace(/^www\./, "");
  if (na === nb) return false;
  if (na.includes(nb) || nb.includes(na)) return false;
  return true;
}

/** Hard signals that the user started a new task — not message-length heuristics. */
export function detectEpisodeBoundary(
  userMessage: string,
  effectiveQuery: string,
  priorEpisode: EpisodeState | null,
  taggedApis: string[],
): boolean {
  if (!priorEpisode?.activeSlug && !priorEpisode?.summary && !priorEpisode?.toolFacts) {
    return false;
  }

  const tags = extractTaggedSlugs(userMessage);
  if (
    tags.length > 0 &&
    priorEpisode.activeSlug &&
    tags[0].toLowerCase() !== priorEpisode.activeSlug.toLowerCase()
  ) {
    return true;
  }

  if (
    priorEpisode.activeSlug &&
    isTopicSwitch(effectiveQuery, priorEpisode.activeSlug)
  ) {
    return true;
  }

  const currentEntity = extractEntity(effectiveQuery);
  if (
    isCompanyResearchIntent(effectiveQuery, taggedApis) &&
    entitiesDiffer(currentEntity, priorEpisode.entity)
  ) {
    return true;
  }

  if (
    isNewsOrWebIntent(effectiveQuery) &&
    priorEpisode.intent === "company_research" &&
    !isFollowUpAffirmation(userMessage)
  ) {
    return true;
  }

  if (CASUAL_CHAT_RE.test(userMessage.trim()) && !isFollowUpAffirmation(userMessage)) {
    return true;
  }

  return false;
}

export function episodeFromMetadata(
  meta: Record<string, unknown> | null | undefined,
): EpisodeState | null {
  if (!meta) return null;
  const ep = meta.episode as EpisodeState | undefined;
  if (ep?.id && ep.summary) return ep;

  const tc = meta.toolContext as PriorToolContext | undefined;
  if (!tc?.activeSlug && !tc?.catalogSearchResult && !tc?.effectiveQuery) {
    return null;
  }

  return {
    id: newEpisodeId(),
    summary:
      tc.effectiveQuery ??
      tc.catalogSearchPrompt ??
      `Prior task using @${tc.activeSlug ?? "API"}`,
    intent: tc.intent as QueryIntent | undefined,
    entity: tc.effectiveQuery ? extractEntity(tc.effectiveQuery) : undefined,
    activeSlug: tc.activeSlug,
    endpoints: tc.endpoints,
    toolFacts: undefined,
    turnIndex: 1,
    catalogSearchPrompt: tc.catalogSearchPrompt,
    catalogSearchResult: tc.catalogSearchResult,
    effectiveQuery: tc.effectiveQuery,
  };
}

export function assembleEpisodeInjection(
  episode: EpisodeState | null,
  continueEpisode: boolean,
  effectiveQuery: string,
): string | null {
  if (!continueEpisode || !episode) return null;

  const parts = [
    "[Episode context — same task as prior turn]",
    `Resolved user intent: ${effectiveQuery}`,
  ];
  if (episode.summary) {
    parts.push(`Task summary: ${episode.summary.slice(0, 800)}`);
  }
  if (episode.entity) {
    parts.push(`Entity in scope: ${episode.entity}`);
  }
  if (episode.activeSlug) {
    parts.push(`API in use: @${episode.activeSlug}`);
  }
  if (episode.toolFacts) {
    parts.push(`Prior tool facts (reuse, do not re-fetch unless stale):\n${episode.toolFacts.slice(0, 3000)}`);
  }
  return parts.join("\n");
}

export function shouldInheritTaggedApis(
  turnPlan: TurnPlan,
  priorEpisode: EpisodeState | null,
  taggedApis: string[],
): boolean {
  if (taggedApis.length > 0) return false;
  if (turnPlan.episodeBoundary) return false;
  if (!turnPlan.continueEpisode) return false;
  return !!priorEpisode?.activeSlug || priorEpisode?.endpoints != null;
}

function compactFactsFromToolSteps(toolSteps: ToolStep[]): string {
  const lines: string[] = [];
  for (const step of toolSteps) {
    if (step.status !== "done" || !step.resultPreview) continue;
    const label = step.label || step.tool;
    const compact = compactToolPayloadForSummary(step.resultPreview);
    lines.push(`- ${label}: ${compact.slice(0, 1200)}`);
  }
  return lines.join("\n").slice(0, 6000);
}

function buildEpisodeSummary(
  intent: QueryIntent | undefined,
  effectiveQuery: string,
  activeSlug: string | undefined,
  toolFacts: string,
): string {
  const slugPart = activeSlug ? ` via @${activeSlug}` : "";
  const intentPart = intent ? ` (${intent})` : "";
  let summary = `User task${intentPart}: ${effectiveQuery.slice(0, 200)}${slugPart}.`;
  if (toolFacts) {
    summary += ` Key data collected in prior turn.`;
  }
  return summary.slice(0, 600);
}

export function buildEpisodeAfterTurn(opts: {
  priorEpisode: EpisodeState | null;
  intent: QueryIntent;
  effectiveQuery: string;
  activeSlug?: string;
  endpoints?: SessionEndpoint[];
  toolSteps: ToolStep[];
  catalogSearchPrompt?: string;
  catalogSearchResult?: string;
  continueEpisode: boolean;
}): EpisodeState {
  const toolFacts = compactFactsFromToolSteps(opts.toolSteps);
  const entity =
    extractEntity(opts.effectiveQuery) ?? opts.priorEpisode?.entity;
  const activeSlug =
    opts.activeSlug ?? opts.priorEpisode?.activeSlug;

  const sameEpisode = opts.continueEpisode && !!opts.priorEpisode;

  const id = sameEpisode ? opts.priorEpisode!.id : newEpisodeId();
  const turnIndex = sameEpisode
    ? (opts.priorEpisode!.turnIndex ?? 0) + 1
    : 1;

  const summary = buildEpisodeSummary(
    opts.intent,
    opts.effectiveQuery,
    activeSlug,
    toolFacts || opts.priorEpisode?.toolFacts || "",
  );

  const mergedFacts = [opts.priorEpisode?.toolFacts, toolFacts]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);

  return {
    id,
    summary,
    intent: opts.intent,
    entity,
    activeSlug,
    endpoints: opts.endpoints ?? opts.priorEpisode?.endpoints,
    toolFacts: mergedFacts || undefined,
    turnIndex,
    catalogSearchPrompt: opts.catalogSearchPrompt,
    catalogSearchResult: opts.catalogSearchResult?.slice(0, 4000),
    effectiveQuery: opts.effectiveQuery,
  };
}

/** Slim snapshot for UI / legacy readers — no catalog blob. */
export function episodeToToolContext(episode: EpisodeState): PriorToolContext {
  return {
    effectiveQuery: episode.effectiveQuery,
    intent: episode.intent,
    activeSlug: episode.activeSlug,
    endpoints: episode.endpoints,
    catalogSearchPrompt: episode.catalogSearchPrompt,
  };
}

export function priorCatalogForAffirmation(
  episode: EpisodeState | null,
): PriorToolContext | null {
  if (!episode?.catalogSearchResult) return null;
  return {
    effectiveQuery: episode.effectiveQuery,
    catalogSearchPrompt: episode.catalogSearchPrompt,
    catalogSearchResult: episode.catalogSearchResult,
  };
}

export function toTurnPlan(
  plan: IntentPlan,
  opts: {
    continueEpisode: boolean;
    episodeBoundary: boolean;
  },
): TurnPlan {
  return {
    ...plan,
    continueEpisode: opts.continueEpisode,
    episodeBoundary: opts.episodeBoundary,
    mode: intentPlanNeedsTools(plan) ? plan.intent : "chat",
  };
}
