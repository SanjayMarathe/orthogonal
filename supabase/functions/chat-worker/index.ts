import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { runAgentLoop, streamTokens } from "../_shared/agent.ts";
import { buildUserContentFromHistory } from "../_shared/attachments.ts";
import { requireAppUserOrWorkerSecret } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { episodeFromMetadata } from "../_shared/episodeContext.ts";
import { extractTaggedSlugs } from "../_shared/integrations.ts";
import type { ChatMessage } from "../_shared/types.ts";
import { estimateMessagesTokens, estimateTokens } from "../_shared/tokens.ts";
import {
  dequeueJobs,
  globalRunningJobs,
  markProviderOutcome,
  recordQueueEvent,
  recoverStaleJobs,
  releaseProviderSlot,
  tryAcquireProviderSlot,
  userRunningJobs,
  type QueueJob,
} from "../_shared/queue.ts";

const MAX_BATCH = 5;
const MAX_GLOBAL_RUNNING = Number(Deno.env.get("QUEUE_MAX_GLOBAL_RUNNING") ?? "20");
const MAX_USER_RUNNING = Number(Deno.env.get("QUEUE_MAX_USER_RUNNING") ?? "2");
const STALE_SECONDS = Number(Deno.env.get("QUEUE_STALE_SECONDS") ?? "120");

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function deriveProvider(payload: Record<string, unknown>): string {
  const message = String(payload.message ?? "");
  const tags = extractTaggedSlugs(message);
  return tags[0] ?? "agent";
}

async function failJob(
  supabase: ReturnType<typeof createClient>,
  job: QueueJob,
  reason: string,
): Promise<void> {
  const exhausted = job.attempt >= job.max_attempts;
  await supabase
    .from("queue_jobs")
    .update({
      status: exhausted ? "failed" : "queued",
      error: reason,
      dead_letter_reason: exhausted ? "max_attempts" : null,
      available_at: exhausted
        ? new Date().toISOString()
        : new Date(Date.now() + Math.min(120_000, 5000 * Math.max(1, job.attempt))).toISOString(),
      locked_at: null,
      locked_by: null,
      finished_at: exhausted ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  await recordQueueEvent(supabase, job.id, "job_failed", { reason, exhausted });
}

async function runJob(
  supabase: ReturnType<typeof createClient>,
  job: QueueJob,
): Promise<void> {
  const payload = job.request_payload as Record<string, unknown>;
  const model = (payload.model as string | undefined)?.trim() || "groq:llama-3.3-70b-versatile";
  const message = String(payload.message ?? "");
  const conversationId = String(job.conversation_id);
  const provider = deriveProvider(payload);

  const perUserRunning = await userRunningJobs(supabase, job.user_id);
  if (perUserRunning > MAX_USER_RUNNING) {
    await failJob(supabase, job, "user_concurrency_limit");
    return;
  }

  const globalRunning = await globalRunningJobs(supabase);
  if (globalRunning > MAX_GLOBAL_RUNNING) {
    await failJob(supabase, job, "global_concurrency_limit");
    return;
  }

  const slot = await tryAcquireProviderSlot(supabase, provider);
  if (!slot.ok) {
    await failJob(supabase, job, slot.reason ?? "provider_limit");
    return;
  }

  await recordQueueEvent(supabase, job.id, "job_started", { provider, model });

  try {
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

    const taggedApis = extractTaggedSlugs(message);
    const {
      assistantContent,
      toolSteps,
      reasoningLog,
      usageTokens,
      toolContext,
      episode,
    } = await runAgentLoop(
      chatMessages,
      () => {},
      taggedApis,
      model,
      priorEpisode,
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

    const finalContent = (assistantContent || "").trim()
      ? assistantContent + contextWarning
      : "I couldn't generate a response. Please try again.";

    const { data: inserted, error: insertErr } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: finalContent,
        token_count: estimateTokens(finalContent),
        metadata: { toolSteps, reasoning: reasoningLog, toolContext, episode },
      })
      .select("id")
      .single();
    if (insertErr || !inserted) throw new Error(insertErr?.message ?? "failed_assistant_insert");

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

    await supabase.from("queue_results").upsert({
      job_id: job.id,
      assistant_message_id: inserted.id,
      result_meta: {
        toolCount: toolSteps.length,
        contextTokens,
      },
    });

    await supabase
      .from("queue_jobs")
      .update({
        status: "done",
        error: null,
        locked_at: null,
        locked_by: null,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    await markProviderOutcome(supabase, provider, true);
    await recordQueueEvent(supabase, job.id, "job_done", {
      assistantMessageId: inserted.id,
      toolCount: toolSteps.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "job_error";
    await markProviderOutcome(supabase, provider, false, message);
    await failJob(supabase, job, message);
  } finally {
    await releaseProviderSlot(supabase, provider);
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    // App JWT for manual runs; pg_cron uses x-queue-worker-secret (see migration 006).
    await requireAppUserOrWorkerSecret(req);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const workerId = `worker-${crypto.randomUUID()}`;
    const recovered = await recoverStaleJobs(supabase, STALE_SECONDS);
    if (recovered > 0) {
      await recordQueueEvent(supabase, null, "stale_recovered", { recovered });
    }

    const jobs = await dequeueJobs(supabase, workerId, MAX_BATCH);
    for (const job of jobs) {
      await runJob(supabase, job);
    }

    return json(200, { workerId, recovered, processed: jobs.length, jobIds: jobs.map((j) => j.id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = /Unauthorized|authorization/.test(message) ? 401 : 500;
    return json(status, { error: message });
  }
});

