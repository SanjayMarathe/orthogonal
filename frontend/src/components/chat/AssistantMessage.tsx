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
  const chatOnlyStream =
    toolSteps.length === 0 &&
    (Boolean(agentReasoning?.trim()) ||
      (Boolean(isStreaming) && !content && !hasRunningTool));
  const showThinking =
    Boolean(isStreaming) &&
    !content &&
    !agentReasoning?.trim() &&
    toolSteps.length === 0 &&
    (isThinking || !!thinkingLabel);
  const showPostToolReasoning =
    Boolean(agentReasoning?.trim()) && toolSteps.length > 0;

  return (
    <div className="mb-6 space-y-3">
      {showThinking && <ThinkingIndicator label={thinkingLabel} />}

      {chatOnlyStream && (
        <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/40">
          <StepReasoningText
            content={agentReasoning ?? ""}
            className="text-sm leading-relaxed text-gray-700 dark:text-gray-300"
          />
          {isStreaming && !content && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-gray-400 dark:bg-gray-500" />
          )}
        </div>
      )}

      {toolSteps.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            API calls ({toolSteps.length})
          </p>
          <ToolStepTimeline steps={toolSteps} />
        </div>
      )}

      {showPostToolReasoning && (
        <StepReasoningText
          content={agentReasoning ?? ""}
          className="text-sm leading-relaxed text-gray-600 dark:text-gray-300"
        />
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
