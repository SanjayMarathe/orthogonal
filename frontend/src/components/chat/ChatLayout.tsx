import { useCallback, useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatHeader } from "./ChatHeader";
import { PageHeader } from "./PageHeader";
import {
  ConversationSidebar,
  type SidebarView,
} from "./ConversationSidebar";
import { MessageInput } from "./MessageInput";
import { MessageList } from "./MessageList";
import { IntegrationsPanel } from "@/components/integrations/IntegrationsPanel";
import { useChat } from "@/hooks/useChat";
import { useConversations } from "@/hooks/useConversations";
import { getConversationIdFromUrl } from "@/lib/chatShare";
import { IntegrationsProvider } from "@/hooks/useIntegrations";
import { ModelsProvider, useModels } from "@/hooks/useModels";
import { ThemeToggle } from "./ThemeToggle";
import { supabase } from "@/lib/supabase";

function ChatLayoutInner() {
  const { selectedModelId } = useModels();
  const { conversations, loading, refresh, createConversation } =
    useConversations();
  const {
    messages,
    isLoading,
    conversationId,
    title,
    contextTokens,
    contextLimit,
    isReadOnly,
    loadMessages,
    sendMessage,
    retryLastPrompt,
    resetChat,
  } = useChat(refresh);

  const [authReady, setAuthReady] = useState(false);
  const [sharedLoadDone, setSharedLoadDone] = useState(false);
  const [view, setView] = useState<SidebarView>("chat");
  const [inputPrefill, setInputPrefill] = useState<string | undefined>();

  useEffect(() => {
    async function initAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        await supabase.auth.signInAnonymously();
      }
      setAuthReady(true);
    }
    initAuth();
  }, []);

  useEffect(() => {
    if (!authReady || sharedLoadDone) return;
    const urlId = getConversationIdFromUrl();
    if (urlId) {
      void loadMessages(urlId).finally(() => setSharedLoadDone(true));
    } else {
      setSharedLoadDone(true);
    }
  }, [authReady, sharedLoadDone, loadMessages]);

  const handleNewChat = async () => {
    setView("chat");
    resetChat();
    await createConversation();
  };

  const handleSelectConversation = async (id: string) => {
    setView("chat");
    await loadMessages(id);
  };

  const handleUseInChat = useCallback((handle: string) => {
    setView("chat");
    setInputPrefill(handle);
  }, []);

  const handlePrefillConsumed = useCallback(() => {
    setInputPrefill(undefined);
  }, []);

  const handleRetry = useCallback(() => {
    void retryLastPrompt(selectedModelId);
  }, [retryLastPrompt, selectedModelId]);

  if (!authReady) {
    return (
      <div className="relative flex h-full items-center justify-center bg-white dark:bg-gray-900">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">Connecting…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-white dark:bg-gray-900">
      <ConversationSidebar
        conversations={conversations}
        currentConversationId={conversationId}
        activeView={view}
        loading={loading}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        onOpenIntegrations={() => setView("integrations")}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {view === "chat" ? (
          <>
            <ChatHeader title={title} />
            <ScrollArea className="flex-1">
              <MessageList
                messages={messages}
                conversationId={conversationId}
                showShareActions={
                  Boolean(conversationId) &&
                  !isLoading &&
                  messages.length > 0 &&
                  !messages.some((m) => m.isStreaming)
                }
                onRetry={isReadOnly ? undefined : handleRetry}
                retryDisabled={isLoading}
              />
            </ScrollArea>
            {isReadOnly ? (
              <p className="border-t border-gray-100 px-4 py-3 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                This is a shared conversation (read-only). Start a new chat to
                ask your own questions.
              </p>
            ) : (
              <MessageInput
                onSend={sendMessage}
                disabled={isLoading}
                prefill={inputPrefill}
                onPrefillConsumed={handlePrefillConsumed}
                contextTokens={contextTokens}
                contextLimit={contextLimit}
              />
            )}
          </>
        ) : (
          <>
            <PageHeader title="Integrations" />
            <ScrollArea className="flex-1">
              <IntegrationsPanel onUseInChat={handleUseInChat} />
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  );
}

export function ChatLayout() {
  return (
    <TooltipProvider>
      <ModelsProvider>
        <IntegrationsProvider>
          <ChatLayoutInner />
        </IntegrationsProvider>
      </ModelsProvider>
    </TooltipProvider>
  );
}
