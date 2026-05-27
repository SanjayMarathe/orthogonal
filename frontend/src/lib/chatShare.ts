import type { DisplayMessage } from "@/components/chat/MessageList";

const CONVERSATION_QUERY_KEY = "c";

export function getConversationIdFromUrl(): string | null {
  const id = new URLSearchParams(window.location.search).get(
    CONVERSATION_QUERY_KEY,
  );
  return id && id.length > 0 ? id : null;
}

export function setConversationUrl(conversationId: string | null): void {
  const url = new URL(window.location.href);
  if (conversationId) {
    url.searchParams.set(CONVERSATION_QUERY_KEY, conversationId);
  } else {
    url.searchParams.delete(CONVERSATION_QUERY_KEY);
  }
  window.history.replaceState({}, "", url);
}

export function buildShareUrl(conversationId: string): string {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set(CONVERSATION_QUERY_KEY, conversationId);
  return url.toString();
}

export function formatChatForClipboard(messages: DisplayMessage[]): string {
  return messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => {
      const role = m.role === "user" ? "You" : "Assistant";
      return `${role}:\n${m.content.trim()}`;
    })
    .join("\n\n");
}
