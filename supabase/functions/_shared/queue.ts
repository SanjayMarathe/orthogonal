import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type QueueJob = {
  id: string;
  conversation_id: string;
  user_id: string;
  message_id: string | null;
  request_payload: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  priority: number;
  attempt: number;
  max_attempts: number;
  idempotency_key: string | null;
  available_at: string;
  locked_at: string | null;
  locked_by: string | null;
  error: string | null;
};

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export async function hashSha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildIdempotencyKey(opts: {
  userId: string;
  conversationId: string;
  prompt: string;
  model?: string;
  attachments?: unknown;
}): Promise<string> {
  const normalized = stableStringify({
    u: opts.userId,
    c: opts.conversationId,
    p: opts.prompt.trim(),
    m: opts.model ?? "",
    a: opts.attachments ?? [],
  });
  return await hashSha256(normalized);
}

export async function enqueueJob(
  supabase: SupabaseClient,
  payload: {
    conversationId: string;
    userId: string;
    messageId: string | null;
    requestPayload: Record<string, unknown>;
    idempotencyKey: string;
    priority?: number;
    maxAttempts?: number;
  },
): Promise<QueueJob> {
  const { data: existing } = await supabase
    .from("queue_jobs")
    .select("*")
    .eq("idempotency_key", payload.idempotencyKey)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as QueueJob;

  const { data, error } = await supabase
    .from("queue_jobs")
    .insert({
      conversation_id: payload.conversationId,
      user_id: payload.userId,
      message_id: payload.messageId,
      request_payload: payload.requestPayload,
      idempotency_key: payload.idempotencyKey,
      priority: payload.priority ?? 0,
      max_attempts: payload.maxAttempts ?? 3,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to enqueue job");
  return data as QueueJob;
}

export async function recordQueueEvent(
  supabase: SupabaseClient,
  jobId: string | null,
  eventType: string,
  eventMeta: Record<string, unknown> = {},
): Promise<void> {
  await supabase.from("queue_events").insert({
    job_id: jobId,
    event_type: eventType,
    event_meta: eventMeta,
  });
}

export async function recoverStaleJobs(
  supabase: SupabaseClient,
  staleSeconds = 120,
): Promise<number> {
  const { data, error } = await supabase.rpc("recover_stale_jobs", {
    stale_seconds: staleSeconds,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function dequeueJobs(
  supabase: SupabaseClient,
  workerId: string,
  limit = 5,
): Promise<QueueJob[]> {
  const { data, error } = await supabase.rpc("dequeue_jobs", {
    worker: workerId,
    limit_n: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as QueueJob[];
}

export async function getProviderState(
  supabase: SupabaseClient,
  provider: string,
): Promise<{ max_running: number; current_running: number; open_until: string | null }> {
  const [{ data: lim }, { data: breaker }] = await Promise.all([
    supabase
      .from("queue_provider_limits")
      .select("max_running, current_running")
      .eq("provider", provider)
      .maybeSingle(),
    supabase
      .from("queue_provider_breakers")
      .select("open_until")
      .eq("provider", provider)
      .maybeSingle(),
  ]);

  return {
    max_running: Number(lim?.max_running ?? 5),
    current_running: Number(lim?.current_running ?? 0),
    open_until: (breaker?.open_until as string | null) ?? null,
  };
}

export async function tryAcquireProviderSlot(
  supabase: SupabaseClient,
  provider: string,
): Promise<{ ok: boolean; reason?: string }> {
  const state = await getProviderState(supabase, provider);
  if (state.open_until && new Date(state.open_until).getTime() > Date.now()) {
    return { ok: false, reason: "breaker_open" };
  }
  if (state.current_running >= state.max_running) {
    return { ok: false, reason: "provider_limit" };
  }

  await supabase
    .from("queue_provider_limits")
    .upsert({
      provider,
      max_running: state.max_running,
      current_running: state.current_running + 1,
      updated_at: new Date().toISOString(),
    });
  return { ok: true };
}

export async function releaseProviderSlot(
  supabase: SupabaseClient,
  provider: string,
): Promise<void> {
  const state = await getProviderState(supabase, provider);
  await supabase
    .from("queue_provider_limits")
    .upsert({
      provider,
      max_running: state.max_running,
      current_running: Math.max(0, state.current_running - 1),
      updated_at: new Date().toISOString(),
    });
}

export async function markProviderOutcome(
  supabase: SupabaseClient,
  provider: string,
  ok: boolean,
  errorMessage?: string,
): Promise<void> {
  const { data } = await supabase
    .from("queue_provider_breakers")
    .select("*")
    .eq("provider", provider)
    .maybeSingle();

  const currentFailures = Number(data?.failure_count ?? 0);
  const nextFailures = ok ? 0 : currentFailures + 1;
  const openUntil = !ok && nextFailures >= 5
    ? new Date(Date.now() + 60_000).toISOString()
    : null;

  await supabase.from("queue_provider_breakers").upsert({
    provider,
    failure_count: nextFailures,
    open_until: openUntil,
    last_error: ok ? null : (errorMessage ?? "provider_error"),
    updated_at: new Date().toISOString(),
  });
}

export async function userRunningJobs(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count } = await supabase
    .from("queue_jobs")
    .select("*", { head: true, count: "exact" })
    .eq("user_id", userId)
    .eq("status", "running");
  return Number(count ?? 0);
}

export async function globalRunningJobs(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from("queue_jobs")
    .select("*", { head: true, count: "exact" })
    .eq("status", "running");
  return Number(count ?? 0);
}

