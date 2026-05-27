import { Check, Copy, RotateCcw, Share2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { DisplayMessage } from "./MessageList";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { buildShareUrl, formatChatForClipboard } from "@/lib/chatShare";
import { cn } from "@/lib/utils";

type ChatShareActionsProps = {
  conversationId: string;
  messages: DisplayMessage[];
  onRetry?: () => void;
  retryDisabled?: boolean;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const iconBtnClass =
  "h-7 w-7 shrink-0 border-gray-200 bg-white p-0 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100";

export function ChatShareActions({
  conversationId,
  messages,
  onRetry,
  retryDisabled,
}: ChatShareActionsProps) {
  const [copiedChat, setCopiedChat] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);

  const handleCopyChat = useCallback(async () => {
    const text = formatChatForClipboard(messages);
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopiedChat(true);
      window.setTimeout(() => setCopiedChat(false), 2000);
    }
  }, [messages]);

  const handleShareChat = useCallback(async () => {
    const url = buildShareUrl(conversationId);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "Orthogonal chat",
          url,
        });
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }
    const ok = await copyText(url);
    if (ok) {
      setCopiedShare(true);
      window.setTimeout(() => setCopiedShare(false), 2000);
    }
  }, [conversationId]);

  const hasCopyableContent = messages.some((m) => m.content.trim().length > 0);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const canRetry = Boolean(
    lastUser &&
      (lastUser.prompt?.trim() ||
        lastUser.content.trim() ||
        lastUser.attachments?.length),
  );

  return (
    <div className="mt-3 flex items-center gap-1 border-t border-gray-100 pt-3 dark:border-gray-800">
      <Tooltip content={copiedChat ? "Copied" : "Copy chat"}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(iconBtnClass)}
          onClick={handleCopyChat}
          disabled={!hasCopyableContent}
          aria-label="Copy chat"
        >
          {copiedChat ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </Tooltip>
      <Tooltip content={copiedShare ? "Link copied" : "Share chat"}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(iconBtnClass)}
          onClick={handleShareChat}
          aria-label="Share chat"
        >
          {copiedShare ? (
            <Check className="h-3 w-3" />
          ) : (
            <Share2 className="h-3 w-3" />
          )}
        </Button>
      </Tooltip>
      {onRetry && (
        <Tooltip content="Retry last prompt">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn(iconBtnClass)}
            onClick={onRetry}
            disabled={retryDisabled || !canRetry}
            aria-label="Retry last prompt"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
