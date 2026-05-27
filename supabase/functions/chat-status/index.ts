import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAppUser } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const user = await requireAppUser(req);
    const url = new URL(req.url);
    const jobId = url.searchParams.get("jobId");
    if (!jobId) return json(400, { error: "Missing jobId" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: job, error } = await supabase
      .from("queue_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!job) return json(404, { error: "Job not found" });
    if (job.user_id !== user.app_user_id) return json(403, { error: "Forbidden" });

    const [{ data: result }, { data: events }] = await Promise.all([
      supabase
        .from("queue_results")
        .select("assistant_message_id, result_meta")
        .eq("job_id", jobId)
        .maybeSingle(),
      supabase
        .from("queue_events")
        .select("event_type, event_meta, created_at")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true }),
    ]);

    let assistantMessage: Record<string, unknown> | null = null;
    if (result?.assistant_message_id) {
      const { data: msg } = await supabase
        .from("messages")
        .select("id, content, metadata, created_at")
        .eq("id", result.assistant_message_id)
        .maybeSingle();
      assistantMessage = msg ?? null;
    }

    return json(200, {
      job: {
        id: job.id,
        status: job.status,
        error: job.error,
        deadLetterReason: job.dead_letter_reason,
        attempt: job.attempt,
        maxAttempts: job.max_attempts,
        createdAt: job.created_at,
        startedAt: job.started_at,
        finishedAt: job.finished_at,
      },
      events: events ?? [],
      assistantMessage,
      resultMeta: result?.result_meta ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = /Unauthorized|authorization/.test(message) ? 401 : 500;
    return json(status, { error: message });
  }
});

