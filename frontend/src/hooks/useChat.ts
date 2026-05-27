import { useCallback, useEffect, useState } from "react";
import type { DisplayMessage } from "@/components/chat/MessageList";
import type { ChatAttachment } from "@/lib/attachments";
import { uploadChatFiles } from "@/lib/attachments";
import { setConversationUrl } from "@/lib/chatShare";
import type { SseEvent, ToolStep } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";

export function useChat(onConversationUpdate?: () => void) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [title, setTitle] = useState("New chat");
  const [contextTokens, setContextTokens] = useState(0);
  const [contextLimit, setContextLimit] = useState(262000);

  useEffect(() => {
    setConversationUrl(conversationId);
  }, [conversationId]);

  const loadMessages = useCallback(async (convId: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: conv, error: convError } = await supabase
      .from("conversations")
      .select("title, context_tokens, context_limit, user_id")
      .eq("id", convId)
      .single();

    if (convError || !conv) {
      setMessages([]);
      setConversationId(null);
      setIsReadOnly(false);
      return false;
    }

    setTitle(conv.title);
    setContextTokens(conv.context_tokens);
    setContextLimit(conv.context_limit);
    setIsReadOnly(Boolean(user && conv.user_id !== user.id));

    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });

    if (data) {
      setMessages(
        data
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content ?? "",
            prompt:
              ((m.metadata as Record<string, unknown>)?.prompt as string) ??
              m.content ??
              "",
            toolSteps:
              (m.metadata as Record<string, unknown>)?.toolSteps as
                | ToolStep[]
                | undefined,
            agentReasoning:
              ((m.metadata as Record<string, unknown>)?.agentReasoning as
                | string
                | undefined) ??
              ((m.metadata as Record<string, unknown>)?.reasoning as
                | string
                | undefined),
            attachments: (m.metadata as Record<string, unknown>)
              ?.attachments as ChatAttachment[] | undefined,
          })),
      );
    } else {
      setMessages([]);
    }
    setConversationId(convId);
    return true;
  }, []);

  const sendMessage = useCallback(
    async (
      text: string,
      model?: string,
      files?: File[],
      reuseAttachments?: ChatAttachment[],
    ) => {
      setIsLoading(true);
      const assistantId = `assistant-${Date.now()}`;

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error("Not authenticated");

        let uploadedAttachments: ChatAttachment[] = reuseAttachments ?? [];
        if (files?.length) {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) throw new Error("Not authenticated");
          uploadedAttachments = await uploadChatFiles(
            user.id,
            conversationId,
            files,
          );
        }

        const displayText =
          text.trim() ||
          (uploadedAttachments.length === 1
            ? `📎 ${uploadedAttachments[0].name}`
            : uploadedAttachments.length > 1
              ? `📎 ${uploadedAttachments.length} files attached`
              : "");

        const userMsg: DisplayMessage = {
          id: `user-${Date.now()}`,
          role: "user",
          content: displayText,
          prompt: text.trim(),
          attachments: uploadedAttachments,
        };
        setMessages((prev) => [...prev, userMsg]);

        const liveToolSteps: ToolStep[] = [];
        let agentReasoning = "";

        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: "",
            toolSteps: [],
            isStreaming: true,
            isThinking: true,
            thinkingLabel: "Thinking about your request",
          },
        ]);

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const response = await fetch(`${supabaseUrl}/functions/v1/chat`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversationId,
            message: text,
            stream: true,
            model,
            attachments: uploadedAttachments,
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error ?? "Chat request failed",
          );
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";
        let content = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json) continue;

            let event: SseEvent;
            try {
              event = JSON.parse(json) as SseEvent;
            } catch {
              continue;
            }

            if (event.type === "conversation" && event.conversationId) {
              setConversationId(event.conversationId);
            }
            if (event.type === "title" && event.title) {
              setTitle(event.title);
            }
            if (event.type === "thinking" && event.label) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        isThinking: true,
                        thinkingLabel: event.label,
                        toolSteps: [...liveToolSteps],
                      }
                    : m,
                ),
              );
            }
            if (event.type === "reasoning" && event.content) {
              agentReasoning += event.content + "\n";
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        agentReasoning,
                        isThinking: false,
                      }
                    : m,
                ),
              );
            }
            if (event.type === "reasoning_delta" && event.content) {
              if (
                event.placement === "agent" ||
                event.placement === "after_tools" ||
                !event.stepId
              ) {
                agentReasoning += event.content;
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolSteps: [...liveToolSteps],
                        agentReasoning,
                        isThinking: false,
                      }
                    : m,
                ),
              );
            }
            if (event.type === "tool_start" && event.id) {
              liveToolSteps.push({
                id: event.id,
                tool: event.tool ?? "",
                label: event.label ?? "Running…",
                status: "running",
                args: event.args,
              });
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolSteps: [...liveToolSteps],
                        isThinking: false,
                      }
                    : m,
                ),
              );
            }
            if (event.type === "tool_done" && event.id) {
              const idx = liveToolSteps.findIndex((s) => s.id === event.id);
              if (idx >= 0) {
                liveToolSteps[idx] = {
                  ...liveToolSteps[idx],
                  label: event.label ?? liveToolSteps[idx].label,
                  status: event.success ? "done" : "error",
                  resultPreview: event.resultPreview,
                  meta: event.meta,
                };
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolSteps: [...liveToolSteps],
                        agentReasoning,
                        isThinking: false,
                      }
                    : m,
                ),
              );
            }
            if (event.type === "token" && event.content) {
              content += event.content;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content,
                        toolSteps: [...liveToolSteps],
                        agentReasoning,
                        isThinking: false,
                      }
                    : m,
                ),
              );
            }
            if (event.type === "error" && event.message) {
              content = `Sorry, an error occurred: ${event.message}`;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content, isStreaming: false, isThinking: false }
                    : m,
                ),
              );
            }
            if (event.type === "done") {
              if (event.contextTokens != null) {
                setContextTokens(event.contextTokens);
              }
              if (event.contextLimit != null) {
                setContextLimit(event.contextLimit);
              }
              if (event.conversationId) {
                setConversationId(event.conversationId);
              }
            }
          }
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content,
                  toolSteps: [...liveToolSteps],
                  agentReasoning,
                  isStreaming: false,
                  isThinking: false,
                }
              : m,
          ),
        );

        onConversationUpdate?.();
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Something went wrong";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `Sorry, an error occurred: ${errorMsg}`,
                  isStreaming: false,
                }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId, onConversationUpdate],
  );

  const retryLastPrompt = useCallback(
    async (model?: string) => {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser || isLoading) return;
      const prompt = lastUser.prompt ?? lastUser.content;
      if (!prompt.trim() && !lastUser.attachments?.length) return;
      await sendMessage(prompt, model, undefined, lastUser.attachments);
    },
    [messages, isLoading, sendMessage],
  );

  const resetChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setIsReadOnly(false);
    setTitle("New chat");
    setContextTokens(0);
    setContextLimit(262000);
  }, []);

  return {
    messages,
    isLoading,
    conversationId,
    isReadOnly,
    title,
    contextTokens,
    contextLimit,
    loadMessages,
    sendMessage,
    retryLastPrompt,
    resetChat,
    setTitle,
  };
}
