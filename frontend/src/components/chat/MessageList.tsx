import { useEffect, useRef } from "react";
import type { ToolStep } from "@/lib/supabase";
import { AssistantMessage } from "./AssistantMessage";
import { ChatShareActions } from "./ChatShareActions";
import { UserMessageBubble } from "./UserMessageBubble";

export type DisplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  prompt?: string;
  attachments?: import("@/lib/attachments").ChatAttachment[];
  toolSteps?: ToolStep[];
  agentReasoning?: string;
  thinkingLabel?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
};

type MessageListProps = {
  messages: DisplayMessage[];
  conversationId?: string | null;
  showShareActions?: boolean;
  onRetry?: () => void;
  retryDisabled?: boolean;
};

export function MessageList({
  messages,
  conversationId,
  showShareActions,
  onRetry,
  retryDisabled,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
          Ask anything with Orthogonal
        </p>
        <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
          Enrich companies, find contacts, search the web, and more — powered
          by Orthogonal&apos;s API catalog.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[720px] flex-1 px-4 py-6">
      {messages.map((msg) =>
        msg.role === "user" ? (
          <UserMessageBubble
            key={msg.id}
            content={msg.content}
            attachments={msg.attachments}
          />
        ) : (
          <AssistantMessage
            key={msg.id}
            content={msg.content}
            toolSteps={msg.toolSteps}
            agentReasoning={msg.agentReasoning}
            thinkingLabel={msg.thinkingLabel}
            isThinking={msg.isThinking}
            isStreaming={msg.isStreaming}
          />
        ),
      )}
      {showShareActions && conversationId && (
        <ChatShareActions
          conversationId={conversationId}
          messages={messages}
          onRetry={onRetry}
          retryDisabled={retryDisabled}
        />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
