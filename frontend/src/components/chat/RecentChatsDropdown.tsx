import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, MessageSquare } from "lucide-react";
import type { Conversation } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type RecentChatsDropdownProps = {
  conversations: Conversation[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
};

export function RecentChatsDropdown({
  conversations,
  currentId,
  onSelect,
  onNewChat,
}: RecentChatsDropdownProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          <MessageSquare className="h-4 w-4" />
          Recent
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[240px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
          align="end"
          sideOffset={8}
        >
          <DropdownMenu.Item
            className="cursor-pointer rounded-md px-3 py-2 text-sm outline-none hover:bg-gray-100"
            onSelect={onNewChat}
          >
            + New chat
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />
          {conversations.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">No recent chats</div>
          )}
          {conversations.map((conv) => (
            <DropdownMenu.Item
              key={conv.id}
              className={cn(
                "cursor-pointer rounded-md px-3 py-2 text-sm outline-none hover:bg-gray-100",
                conv.id === currentId && "bg-gray-50 font-medium",
              )}
              onSelect={() => onSelect(conv.id)}
            >
              <span className="line-clamp-1">{conv.title}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
