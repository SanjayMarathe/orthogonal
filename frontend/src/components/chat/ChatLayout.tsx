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
import {
  getAppUser,
  loginWithEmail,
  logoutAppUser,
  registerWithEmail,
  subscribeAuthChange,
  type AppUser,
} from "@/lib/appAuth";

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
  const [authUser, setAuthUser] = useState<AppUser | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [sharedLoadDone, setSharedLoadDone] = useState(false);
  const [view, setView] = useState<SidebarView>("chat");
  const [inputPrefill, setInputPrefill] = useState<string | undefined>();

  useEffect(() => {
    setAuthUser(getAppUser());
    setAuthReady(true);
    return subscribeAuthChange(() => {
      setAuthUser(getAppUser());
      setSharedLoadDone(false);
      if (!getAppUser()) {
        resetChat();
      }
    });
  }, []);

  useEffect(() => {
    if (!authReady || !authUser || sharedLoadDone) return;
    const urlId = getConversationIdFromUrl();
    if (urlId) {
      void loadMessages(urlId).finally(() => setSharedLoadDone(true));
    } else {
      setSharedLoadDone(true);
    }
  }, [authReady, authUser, sharedLoadDone, loadMessages]);

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

  const handleAuthSubmit = async () => {
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      if (authMode === "register") {
        await registerWithEmail(email, password);
      } else {
        await loginWithEmail(email, password);
      }
      setEmail("");
      setPassword("");
      await refresh();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setAuthSubmitting(false);
    }
  };

  if (!authUser) {
    return (
      <div className="relative flex h-full items-center justify-center bg-white dark:bg-gray-900">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {authMode === "login" ? "Sign in" : "Create account"}
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Email/password auth is required to access your conversations.
          </p>
          <div className="space-y-3">
            <input
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {authError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{authError}</p>
            ) : null}
            <button
              className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
              onClick={handleAuthSubmit}
              disabled={authSubmitting || !email || !password}
            >
              {authSubmitting
                ? "Please wait…"
                : authMode === "login"
                  ? "Sign in"
                  : "Create account"}
            </button>
            <button
              className="w-full text-sm text-gray-600 underline dark:text-gray-300"
              onClick={() => setAuthMode((m) => (m === "login" ? "register" : "login"))}
            >
              {authMode === "login"
                ? "Need an account? Register"
                : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full bg-white dark:bg-gray-900">
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
      <button
        className="absolute bottom-4 right-4 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
        onClick={() => void logoutAppUser()}
      >
        Sign out
      </button>
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
