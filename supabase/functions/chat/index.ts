import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  buildUserContentFromHistory,
  processAttachmentsForMessage,
  validateAttachmentPaths,
} from "../_shared/attachments.ts";
import { requireAppUser } from "../_shared/auth.ts";
import { compressMessages, runAgentLoop, streamTokens } from "../_shared/agent.ts";
import { episodeFromMetadata } from "../_shared/episodeContext.ts";
import { extractTaggedSlugs } from "../_shared/integrations.ts";
import { getDefaultModelId } from "../_shared/models.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { estimateMessagesTokens, estimateTokens } from "../_shared/tokens.ts";
import type { ChatMessage, ChatRequest, SseEvent } from "../_shared/types.ts";
import {
  buildIdempotencyKey,
  enqueueJob,
  recordQueueEvent,
} from "../_shared/queue.ts";

function sseLine(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function generateTitle(message: string): string {
  const trimmed = message.trim().slice(0, 60);
  return trimmed.length < message.trim().length ? `${trimmed}…` : trimmed;
}

const SSE_HEADERS = {
  ...corsHeaders,
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

const CHAT_QUEUE_MODE = (Deno.env.get("CHAT_QUEUE_MODE") ?? "off").toLowerCase();

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const appUser = await requireAppUser(req);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRole);

    const body = (await req.json()) as ChatRequest;
    const { message, stream = true, model: requestedModel, attachments: rawAttachments = [], queueMode } = body;
    const model = requestedModel?.trim() || getDefaultModelId();
    let conversationId = body.conversationId;
    const attachments = validateAttachmentPaths(appUser.app_user_id, rawAttachments ?? []);

    const trimmed = (message ?? "").trim();
    if (!trimmed && attachments.length === 0) {
      return new Response(JSON.stringify({ error: "Message or attachment is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!conversationId) {
      const title = generateTitle(trimmed);
      const { data: conv, error: convError } = await supabase
        .from("conversations")
        .insert({ user_id: appUser.app_user_id, title })
        .select("id, context_tokens, context_limit")
        .single();
      if (convError) throw convError;
      conversationId = conv.id;
    } else {
      const { data: conv, error: convError } = await supabase
        .from("conversations")
        .select("id, user_id, context_tokens, context_limit, is_public")
        .eq("id", conversationId)
        .maybeSingle();
      if (convError || !conv) throw new Error("Conversation not found");
      const canAccess =
        conv.user_id === appUser.app_user_id || conv.is_public === true;
      if (!canAccess) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (conv.user_id !== appUser.app_user_id) {
        return new Response(
          JSON.stringify({ error: "Cannot write to shared conversation" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // Slash: /clear
    if (trimmed === "/clear") {
      await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", conversationId);

      await supabase
        .from("conversations")
        .update({
          context_summary: null,
          context_tokens: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId);

      const confirmContent =
        "Context cleared. All messages in this conversation have been removed.";

      await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: confirmContent,
        token_count: estimateTokens(confirmContent),
        metadata: { slashCommand: "/clear" },
      });

      if (stream) {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  sseLine({ type: "conversation", conversationId }),
                ),
              );
              streamTokens(confirmContent, (e) =>
                controller.enqueue(encoder.encode(sseLine(e)))
              );
              controller.enqueue(
                encoder.encode(
                  sseLine({
                    type: "done",
                    contextTokens: estimateTokens(confirmContent),
                    contextLimit: 262000,
                    conversationId,
                  }),
                ),
              );
              controller.close();
            },
          }),
          { headers: SSE_HEADERS },
        );
      }
      return new Response(JSON.stringify({ content: confirmContent }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Slash: /compress
    if (trimmed === "/compress") {
      const { data: allMessages } = await supabase
        .from("messages")
        .select("role, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      const msgs = allMessages ?? [];
      if (msgs.length < 10) {
        const hint =
          "Not enough messages to compress yet. Keep chatting — /compress works best with 10+ messages.";
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: hint,
          token_count: estimateTokens(hint),
          metadata: { slashCommand: "/compress" },
        });

        if (stream) {
          const encoder = new TextEncoder();
          return new Response(
            new ReadableStream({
              start(controller) {
                streamTokens(hint, (e) =>
                  controller.enqueue(encoder.encode(sseLine(e)))
                );
                controller.enqueue(
                  encoder.encode(
                    sseLine({
                      type: "done",
                      contextTokens: 0,
                      contextLimit: 262000,
                      conversationId,
                    }),
                  ),
                );
                controller.close();
              },
            }),
            { headers: SSE_HEADERS },
          );
        }
        return new Response(JSON.stringify({ content: hint }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const toSummarize = msgs.slice(0, -4) as ChatMessage[];
      const keep = msgs.slice(-4);
      const summary = await compressMessages(toSummarize, model);

      await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", conversationId);

      await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "system",
        content: `[Compressed context summary]\n${summary}`,
        token_count: estimateTokens(summary),
        metadata: { compressed: true },
      });

      if (keep.length > 0) {
        await supabase.from("messages").insert(
          keep.map((m) => ({
            conversation_id: conversationId,
            role: m.role,
            content: m.content,
            token_count: estimateTokens(m.content),
          })),
        );
      }

      const newTokens = estimateMessagesTokens([
        { content: summary },
        ...keep.map((m) => ({ content: m.content })),
      ]);

      await supabase
        .from("conversations")
        .update({
          context_summary: summary,
          context_tokens: newTokens,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId);

      const confirmContent = `Context compressed. Summarized ${toSummarize.length} older messages. Current context: ~${newTokens} tokens.`;

      await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: confirmContent,
        token_count: estimateTokens(confirmContent),
        metadata: { slashCommand: "/compress" },
      });

      if (stream) {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              streamTokens(confirmContent, (e) =>
                controller.enqueue(encoder.encode(sseLine(e)))
              );
              controller.enqueue(
                encoder.encode(
                  sseLine({
                    type: "done",
                    contextTokens: newTokens,
                    contextLimit: 262000,
                    conversationId,
                  }),
                ),
              );
              controller.close();
            },
          }),
          { headers: SSE_HEADERS },
        );
      }
      return new Response(JSON.stringify({ content: confirmContent }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normal message
    const { displayContent, llmContent, attachmentExcerpts } =
      await processAttachmentsForMessage(supabase, trimmed, attachments);

    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: displayContent,
      token_count: estimateTokens(llmContent),
      metadata: {
        attachments,
        attachmentExcerpts,
        prompt: trimmed,
      },
    });

    const effectiveQueueMode = (queueMode ?? CHAT_QUEUE_MODE) as "off" | "shadow" | "on";
    if (effectiveQueueMode === "on" || effectiveQueueMode === "shadow") {
      const idempotencyKey = await buildIdempotencyKey({
        userId: appUser.app_user_id,
        conversationId,
        prompt: trimmed,
        model,
        attachments,
      });
      const job = await enqueueJob(supabase, {
        conversationId,
        userId: appUser.app_user_id,
        messageId: null,
        idempotencyKey,
        requestPayload: {
          conversationId,
          message: trimmed,
          model,
          attachments,
          queuedBy: "chat",
        },
      });
      await recordQueueEvent(supabase, job.id, "enqueued", {
        mode: effectiveQueueMode,
        streamRequested: stream,
      });

      if (effectiveQueueMode === "on") {
        if (stream) {
          const encoder = new TextEncoder();
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(sseLine({ type: "conversation", conversationId })));
                controller.enqueue(encoder.encode(sseLine({ type: "thinking", label: "Queued for processing…" })));
                controller.enqueue(
                  encoder.encode(
                    sseLine({
                      type: "done",
                      conversationId,
                      message: "queued",
                    }),
                  ),
                );
                controller.close();
              },
            }),
            { headers: SSE_HEADERS },
          );
        }
        return new Response(
          JSON.stringify({
            conversationId,
            queued: true,
            jobId: job.id,
            status: job.status,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { count } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversationId);

    const isFirstMessage = count === 1;
    let titleForStream: string | undefined;
    if (isFirstMessage) {
      titleForStream = generateTitle(displayContent);
      await supabase
        .from("conversations")
        .update({ title: titleForStream, updated_at: new Date().toISOString() })
        .eq("id", conversationId);
    }

    const { data: history } = await supabase
      .from("messages")
      .select("role, content, tool_calls, tool_call_id, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    const chatMessages: ChatMessage[] = (history ?? [])
      .filter((m) => m.role !== "tool")
      .map((m) => {
        const meta = m.metadata as Record<string, unknown> | null;
        const content =
          m.role === "user"
            ? buildUserContentFromHistory(m.content, meta)
            : m.content;
        return {
          role: m.role as ChatMessage["role"],
          content,
          tool_calls: m.tool_calls ?? undefined,
          tool_call_id: m.tool_call_id ?? undefined,
        };
      });

    const priorAssistant = (history ?? [])
      .filter((m) => m.role === "assistant")
      .pop();
    const priorEpisode = episodeFromMetadata(
      priorAssistant?.metadata as Record<string, unknown> | null,
    );

    const { data: conv } = await supabase
      .from("conversations")
      .select("context_tokens, context_limit")
      .eq("id", conversationId)
      .single();

    const contextLimit = conv?.context_limit ?? 262000;
    const usageRatio = (conv?.context_tokens ?? 0) / contextLimit;
    const contextWarning =
      usageRatio >= 0.85
        ? "\n\n_Note: Your context window is over 85% full. Consider running /compress to summarize older messages._"
        : "";

    const taggedApis = extractTaggedSlugs(trimmed);

    if (stream) {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          async start(controller) {
            // Open the stream immediately so the client can render tool steps
            // and tokens incrementally (avoid proxy buffering the whole response).
            controller.enqueue(encoder.encode(": connected\n\n"));

            let flushChain = Promise.resolve();
            const emit = (event: SseEvent) => {
              flushChain = flushChain.then(async () => {
                controller.enqueue(encoder.encode(sseLine(event)));
                if (event.type === "token") {
                  await new Promise((r) => setTimeout(r, 0));
                }
              });
            };

            try {
              emit({ type: "conversation", conversationId });
              if (titleForStream) {
                emit({
                  type: "title",
                  title: titleForStream,
                  conversationId,
                });
              }

              const {
                assistantContent,
                toolSteps,
                reasoningLog,
                usageTokens,
                contentStreamed,
                toolContext,
                episode,
              } = await runAgentLoop(
                chatMessages,
                emit,
                taggedApis,
                model,
                priorEpisode,
              );

              const finalContent =
                assistantContent.trim() ||
                "I couldn't generate a response. The request may have timed out — please try again or ask a narrower question.";
              const fullContent = finalContent + contextWarning;

              if (!contentStreamed || !assistantContent.trim()) {
                await streamTokens(fullContent, emit);
              } else if (contextWarning) {
                await streamTokens(contextWarning, emit);
              }

              await flushChain;

              await supabase.from("messages").insert({
                conversation_id: conversationId,
                role: "assistant",
                content: fullContent,
                token_count: estimateTokens(fullContent),
                metadata: {
                  toolSteps,
                  reasoning: reasoningLog,
                  toolContext,
                  episode,
                },
              });

              const { data: allMsgs } = await supabase
                .from("messages")
                .select("content, tool_calls")
                .eq("conversation_id", conversationId);

              const contextTokens =
                usageTokens ??
                estimateMessagesTokens(
                  (allMsgs ?? []).map((m) => ({
                    content: m.content,
                    tool_calls: m.tool_calls,
                  })),
                );

              await supabase
                .from("conversations")
                .update({
                  context_tokens: contextTokens,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", conversationId);

              emit({
                type: "done",
                contextTokens,
                contextLimit,
                conversationId,
              });
              controller.close();
            } catch (err) {
              const errMsg =
                err instanceof Error ? err.message : "Internal server error";
              emit({ type: "error", message: errMsg });
              controller.close();
            }
          },
        }),
        { headers: SSE_HEADERS },
      );
    }

    const { assistantContent, toolSteps, reasoningLog, usageTokens, toolContext, episode } =
      await runAgentLoop(
        chatMessages,
        () => {},
        taggedApis,
        model,
        priorEpisode,
      );

    const finalContent = assistantContent + contextWarning;

    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: finalContent,
      token_count: estimateTokens(finalContent),
      metadata: { toolSteps, reasoning: reasoningLog, toolContext, episode },
    });

    const { data: allMsgs } = await supabase
      .from("messages")
      .select("content, tool_calls")
      .eq("conversation_id", conversationId);

    const contextTokens =
      usageTokens ??
      estimateMessagesTokens(
        (allMsgs ?? []).map((m) => ({
          content: m.content,
          tool_calls: m.tool_calls,
        })),
      );

    await supabase
      .from("conversations")
      .update({
        context_tokens: contextTokens,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    return new Response(
      JSON.stringify({
        conversationId,
        content: finalContent,
        toolSteps,
        reasoning: reasoningLog,
        contextTokens,
        contextLimit,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status =
      /Missing authorization|Unauthorized/.test(message) ? 401 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
