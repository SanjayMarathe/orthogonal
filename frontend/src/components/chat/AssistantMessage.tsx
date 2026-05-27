import { StepReasoningText } from "./StepReasoningText";
import { ThinkingIndicator } from "./ThinkingIndicator";
import type { ToolStep } from "@/lib/supabase";
import { MarkdownContent } from "./MarkdownContent";
import { ToolStepTimeline } from "./ToolStepTimeline";

type AssistantMessageProps = {
  content: string;
  toolSteps?: ToolStep[];
  agentReasoning?: string;
  thinkingLabel?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
};

export function AssistantMessage({
  content,
  toolSteps = [],
  agentReasoning,
  thinkingLabel,
  isThinking,
  isStreaming,
}: AssistantMessageProps) {
  const hasRunningTool = toolSteps.some((s) => s.status === "running");
  const showAgentStream =
    Boolean(agentReasoning?.trim()) ||
    (Boolean(isStreaming) && !content && !hasRunningTool);
  const showThinking =
    Boolean(isStreaming) &&
    !content &&
    !agentReasoning?.trim() &&
    toolSteps.length === 0 &&
    (isThinking || !!thinkingLabel);

  return (
    <div className="mb-6 space-y-3">
      {showThinking && <ThinkingIndicator label={thinkingLabel} />}

      {showAgentStream && (
        <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/40">
          <StepReasoningText
            content={agentReasoning ?? ""}
            className="text-sm leading-relaxed text-gray-700 dark:text-gray-300"
          />
          {isStreaming && !content && !hasRunningTool && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-gray-400 dark:bg-gray-500" />
          )}
        </div>
      )}

      {toolSteps.length > 0 && (
        <details className="group" open={hasRunningTool}>
          <summary className="cursor-pointer list-none text-xs font-medium text-gray-500 dark:text-gray-400">
            <span className="group-open:hidden">Show API calls ({toolSteps.length})</span>
            <span className="hidden group-open:inline">API calls ({toolSteps.length})</span>
          </summary>
          <div className="mt-2">
            <ToolStepTimeline steps={toolSteps} />
          </div>
        </details>
      )}

      {content && (
        <div className="text-gray-900 dark:text-gray-100">
          <MarkdownContent content={content} />
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-gray-400 dark:bg-gray-500" />
          )}
        </div>
      )}
    </div>
  );
}
