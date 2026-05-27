import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireAppUser } from "../_shared/auth.ts";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pathParts(url: string): string[] {
  const p = new URL(url).pathname.replace(/\/+$/, "");
  const idx = p.indexOf("/functions/v1/conversations");
  if (idx < 0) return [];
  const rest = p.slice(idx + "/functions/v1/conversations".length);
  return rest.split("/").filter(Boolean);
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const appUser = await requireAppUser(req);
    const parts = pathParts(req.url);
    const url = new URL(req.url);
    const conversationIdParam = url.searchParams.get("conversationId");
    const includeMessages = url.searchParams.get("include") === "messages";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRole);

    if (req.method === "GET" && parts.length === 0 && !conversationIdParam) {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("user_id", appUser.app_user_id)
        .order("updated_at", { ascending: false });
      if (error) return json(500, { error: error.message });
      return json(200, { conversations: data ?? [] });
    }

    if (req.method === "POST" && parts.length === 0) {
      const body = (await req.json().catch(() => ({}))) as { title?: string };
      const title = (body.title ?? "New chat").slice(0, 120);
      const { data, error } = await supabase
        .from("conversations")
        .insert({ user_id: appUser.app_user_id, title })
        .select("*")
        .single();
      if (error) return json(500, { error: error.message });
      return json(200, { conversation: data });
    }

    if (
      req.method === "GET" &&
      ((parts.length >= 1 && !!parts[0]) || !!conversationIdParam)
    ) {
      const conversationId = conversationIdParam ?? parts[0];
      const { data: conv, error: convError } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle();
      if (convError) return json(500, { error: convError.message });
      if (!conv) return json(404, { error: "Conversation not found" });

      const canAccess =
        conv.user_id === appUser.app_user_id || conv.is_public === true;
      if (!canAccess) return json(403, { error: "Forbidden" });

      if ((parts.length === 1 && !includeMessages) || (!parts.length && !includeMessages)) {
        return json(200, { conversation: conv });
      }

      if ((parts.length === 2 && parts[1] === "messages") || includeMessages) {
        const { data: messages, error } = await supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true });
        if (error) return json(500, { error: error.message });
        return json(200, { conversation: conv, messages: messages ?? [] });
      }
    }

    return json(404, { error: "Not found" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status =
      /Missing authorization|Unauthorized/.test(message) ? 401 : 500;
    return json(status, { error: message });
  }
});

