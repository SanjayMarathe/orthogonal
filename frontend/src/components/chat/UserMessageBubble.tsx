import type { ChatAttachment } from "@/lib/attachments";
import { MessageAttachments } from "./MessageAttachments";

type UserMessageBubbleProps = {
  content: string;
  attachments?: ChatAttachment[];
};

function renderContent(content: string) {
  const parts = content.split(/(@[a-zA-Z0-9_-]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      return (
        <span
          key={i}
          className="rounded bg-blue-100 px-1 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

export function UserMessageBubble({
  content,
  attachments = [],
}: UserMessageBubbleProps) {
  return (
    <div className="mb-6 flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-gray-100 px-4 py-2.5 text-[15px] leading-relaxed text-gray-900 dark:bg-gray-800 dark:text-gray-100">
        {content ? renderContent(content) : null}
        <MessageAttachments attachments={attachments} />
      </div>
    </div>
  );
}
