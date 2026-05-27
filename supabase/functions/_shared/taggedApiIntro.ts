import {
  fetchIntegrationBySlug,
  formatIntegrationCapabilities,
  isCapabilityQuestion,
} from "./integrations.ts";
import { sessionFromIntegration, type ApiSessionState } from "./apiSession.ts";
import type { SseEvent, ToolStep } from "./types.ts";

type EmitFn = (event: SseEvent) => void;

/** Answer "@api what can you do?" without LLM tool calls. */
export async function tryTaggedApiIntroAnswer(
  userMessage: string,
  taggedApis: string[],
  emit: EmitFn,
): Promise<{
  content: string;
  toolSteps: ToolStep[];
  sessions: ApiSessionState[];
} | null> {
  if (taggedApis.length === 0 || !isCapabilityQuestion(userMessage)) {
    return null;
  }

  emit({ type: "thinking", label: "Loading API capabilities…" });
  emit({
    type: "reasoning_delta",
    placement: "agent",
    content: `Looking up @${taggedApis.join(", @")} in the Orthogonal catalog.\n`,
  });

  const sections: string[] = [];
  const sessions: ApiSessionState[] = [];
  for (const slug of taggedApis) {
    const integration = await fetchIntegrationBySlug(slug);
    if (integration) {
      sections.push(formatIntegrationCapabilities(integration));
      sessions.push(sessionFromIntegration(slug, integration));
    } else {
      sections.push(
        `## @${slug}\n\nCould not find this API in the Orthogonal catalog. Check the slug on the Integrations page.`,
      );
    }
  }

  emit({
    type: "reasoning_delta",
    placement: "agent",
    content: `Loaded ${taggedApis.length} API catalog entries.\n`,
  });

  return {
    content: sections.join("\n\n---\n\n"),
    toolSteps: [],
    sessions,
  };
}
