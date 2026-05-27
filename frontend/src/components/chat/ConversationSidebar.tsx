import ExtensionIcon from "@mui/icons-material/Extension";
import { MessageSquarePlus, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/supabase";

export type SidebarView = "chat" | "integrations";

type ConversationSidebarProps = {
  conversations: Conversation[];
  currentConversationId: string | null;
  activeView: SidebarView;
  loading?: boolean;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onOpenIntegrations: () => void;
};

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ConversationSidebar({
  conversations,
  currentConversationId,
  activeView,
  loading,
  onSelect,
  onNewChat,
  onOpenIntegrations,
}: ConversationSidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <MessagesSquare className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Chats
          </span>
        </div>
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading && conversations.length === 0 && (
          <p className="px-3 py-2 text-xs text-gray-400">Loading chats…</p>
        )}
        {!loading && conversations.length === 0 && (
          <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
            No conversations yet
          </p>
        )}
        <ul className="space-y-0.5">
          {conversations.map((conv) => {
            const isActive =
              activeView === "chat" && conv.id === currentConversationId;
            return (
              <li key={conv.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conv.id)}
                  className={cn(
                    "flex w-full flex-col rounded-lg px-3 py-2.5 text-left transition-colors",
                    isActive
                      ? "bg-white shadow-sm dark:bg-gray-800"
                      : "hover:bg-gray-100 dark:hover:bg-gray-900",
                  )}
                >
                  <span
                    className={cn(
                      "truncate text-sm font-medium",
                      isActive
                        ? "text-gray-900 dark:text-gray-100"
                        : "text-gray-700 dark:text-gray-300",
                    )}
                  >
                    {conv.title || "New chat"}
                  </span>
                  <span className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                    {formatRelativeDate(conv.updated_at)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-gray-200 p-3 dark:border-gray-800">
        <button
          type="button"
          onClick={onOpenIntegrations}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            activeView === "integrations"
              ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100"
              : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-900",
          )}
        >
          <ExtensionIcon className="!text-[20px]" />
          Integrations
        </button>
      </div>
    </aside>
  );
}
