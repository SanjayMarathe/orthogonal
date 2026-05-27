import { useCallback, useEffect, useState } from "react";
import type { DisplayMessage } from "@/components/chat/MessageList";
import type { ChatAttachment } from "@/lib/attachments";
import { uploadChatFiles } from "@/lib/attachments";
import { setConversationUrl } from "@/lib/chatShare";
import type { SseEvent, ToolStep } from "@/lib/supabase";
import { ensureValidAccessToken, getAppUser } from "@/lib/appAuth";

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
    const user = getAppUser();
    const token = await ensureValidAccessToken();
    if (!token) {
      setMessages([]);
      setConversationId(null);
      setIsReadOnly(false);
      return false;
    }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const res = await fetch(
      `${supabaseUrl}/functions/v1/conversations?conversationId=${encodeURIComponent(convId)}&include=messages`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) {
      setMessages([]);
      setConversationId(null);
      setIsReadOnly(false);
      return false;
    }
    const payload = (await res.json()) as {
      conversation?: {
        title: string;
        context_tokens: number;
        context_limit: number;
        user_id: string;
      };
      messages?: Array<{
        id: string;
        role: "user" | "assistant" | "system" | "tool";
        content: string | null;
        metadata: Record<string, unknown> | null;
      }>;
    };
    const conv = payload.conversation;
    if (!conv) {
      setMessages([]);
      setConversationId(null);
      setIsReadOnly(false);
      return false;
    }

    setTitle(conv.title);
    setContextTokens(conv.context_tokens);
    setContextLimit(conv.context_limit);
    setIsReadOnly(Boolean(user && conv.user_id !== user.id));
    const data = payload.messages;

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
        const accessToken = await ensureValidAccessToken();
        if (!accessToken) throw new Error("Not authenticated");

        let uploadedAttachments: ChatAttachment[] = reuseAttachments ?? [];
        if (files?.length) {
          const user = getAppUser();
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
        let pendingStepReasoning = "";
        let afterToolsReasoning = "";

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
            Authorization: `Bearer ${accessToken}`,
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

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const payload = (await response.json()) as {
            queued?: boolean;
            jobId?: string;
            conversationId?: string;
            content?: string;
          };
          if (payload.conversationId) {
            setConversationId(payload.conversationId);
          }
          if (payload.queued && payload.jobId) {
            const pollUntil = Date.now() + 120_000;
            let content = "";
            while (Date.now() < pollUntil) {
              await new Promise((r) => setTimeout(r, 1500));
              const statusRes = await fetch(
                `${supabaseUrl}/functions/v1/chat-status?jobId=${encodeURIComponent(payload.jobId)}`,
                {
                  headers: { Authorization: `Bearer ${accessToken}` },
                },
              );
              if (!statusRes.ok) continue;
              const status = (await statusRes.json()) as {
                job?: { status?: string; error?: string };
                assistantMessage?: { content?: string; metadata?: Record<string, unknown> };
              };
              const st = status.job?.status;
              if (st === "done" && status.assistantMessage) {
                content = status.assistantMessage.content ?? "";
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content,
                          toolSteps: (status.assistantMessage?.metadata?.toolSteps as ToolStep[] | undefined) ?? [],
                          agentReasoning:
                            (status.assistantMessage?.metadata?.reasoning as string | undefined) ??
                            undefined,
                          isStreaming: false,
                          isThinking: false,
                        }
                      : m,
                  ),
                );
                onConversationUpdate?.();
                setIsLoading(false);
                return;
              }
              if (st === "failed" || st === "cancelled") {
                throw new Error(status.job?.error ?? "Queued job failed");
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, isThinking: true, thinkingLabel: "Queued… waiting for worker" }
                    : m,
                ),
              );
            }
            throw new Error("Queued job timed out");
          }
          if (payload.content) {
            const queuedContent = payload.content ?? "";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: queuedContent, isStreaming: false, isThinking: false }
                  : m,
              ),
            );
            onConversationUpdate?.();
            setIsLoading(false);
            return;
          }
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
              const chunk = event.content + "\n";
              if (liveToolSteps.length > 0) {
                afterToolsReasoning += chunk;
              } else {
                pendingStepReasoning += chunk;
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolSteps: [...liveToolSteps],
                        agentReasoning: afterToolsReasoning,
                        isThinking: false,
                      }
                    : m,
                ),
              );
            }
            if (event.type === "reasoning_delta" && event.content) {
              const toolsFinished =
                liveToolSteps.length > 0 &&
                !liveToolSteps.some((s) => s.status === "running");
              if (
                event.placement === "after_tools" ||
                (event.placement === "agent" && toolsFinished)
              ) {
                afterToolsReasoning += event.content;
              } else if (event.stepId) {
                const idx = liveToolSteps.findIndex((s) => s.id === event.stepId);
                if (idx >= 0) {
                  const step = liveToolSteps[idx];
                  liveToolSteps[idx] = {
                    ...step,
                    reasoning: (step.reasoning ?? "") + event.content,
                  };
                } else {
                  pendingStepReasoning += event.content;
                }
              } else {
                pendingStepReasoning += event.content;
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolSteps: [...liveToolSteps],
                        agentReasoning: afterToolsReasoning,
                        isThinking: false,
                      }
                    : m,
                ),
              );
            }
            if (event.type === "tool_start" && event.id) {
              const stepReasoning =
                pendingStepReasoning.trim() || event.reasoningBefore?.trim() || "";
              pendingStepReasoning = "";
              liveToolSteps.push({
                id: event.id,
                tool: event.tool ?? "",
                label: event.label ?? "Running…",
                status: "running",
                args: event.args,
                reasoning: stepReasoning || undefined,
              });
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolSteps: [...liveToolSteps],
                        agentReasoning: afterToolsReasoning,
                        isThinking: false,
                      }
                    : m,
                ),
              );
            }
            if (event.type === "tool_done" && event.id) {
              const idx = liveToolSteps.findIndex((s) => s.id === event.id);
              if (idx >= 0) {
                const step = liveToolSteps[idx];
                const extra = event.reasoningAfter?.trim();
                liveToolSteps[idx] = {
                  ...step,
                  label: event.label ?? step.label,
                  status: event.success ? "done" : "error",
                  resultPreview: event.resultPreview,
                  meta: event.meta,
                  reasoning: extra
                    ? [step.reasoning, extra].filter(Boolean).join("\n")
                    : step.reasoning,
                };
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolSteps: [...liveToolSteps],
                        agentReasoning: afterToolsReasoning,
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
                        agentReasoning: afterToolsReasoning,
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

        if (pendingStepReasoning.trim() && liveToolSteps.length > 0) {
          const last = liveToolSteps[liveToolSteps.length - 1];
          liveToolSteps[liveToolSteps.length - 1] = {
            ...last,
            reasoning: [last.reasoning, pendingStepReasoning.trim()]
              .filter(Boolean)
              .join("\n"),
          };
          pendingStepReasoning = "";
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content,
                  toolSteps: [...liveToolSteps],
                  agentReasoning: afterToolsReasoning,
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
