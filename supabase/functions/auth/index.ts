import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import {
  hashPassword,
  hashToken,
  parseBearerToken,
  signJwt,
  verifyJwt,
  verifyPassword,
} from "../_shared/auth.ts";

type AuthBody = {
  email?: string;
  password?: string;
  refreshToken?: string;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(raw: string | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

function validatePassword(password: string | undefined): string | null {
  const p = password ?? "";
  if (p.length < 8) return "Password must be at least 8 characters";
  if (p.length > 200) return "Password too long";
  return null;
}

async function issueSessionTokens(user: { id: string; email: string }, sessionId: string) {
  const now = Math.floor(Date.now() / 1000);
  const accessExp = now + 60 * 15;
  const refreshExp = now + 60 * 60 * 24 * 30;
  const accessToken = await signJwt({
    sub: user.id,
    app_user_id: user.id,
    email: user.email,
    role: "authenticated",
    aud: "authenticated",
    type: "access",
    sid: sessionId,
    iat: now,
    exp: accessExp,
  });
  const refreshToken = await signJwt({
    sub: user.id,
    app_user_id: user.id,
    email: user.email,
    role: "authenticated",
    aud: "authenticated",
    type: "refresh",
    sid: sessionId,
    iat: now,
    exp: refreshExp,
  });
  return { accessToken, refreshToken, accessExp, refreshExp };
}

function makePendingHash(): string {
  const rand = `${Date.now()}-${Math.random()}-${Math.random()}`;
  return `pending-${rand}`;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRole);

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    const body = (await req.json().catch(() => ({}))) as AuthBody;

    if (req.method === "POST" && path.endsWith("/register")) {
      const email = normalizeEmail(body.email);
      const passwordError = validatePassword(body.password);
      if (!email || !email.includes("@")) return json(400, { error: "Invalid email" });
      if (passwordError) return json(400, { error: passwordError });

      const { data: existing } = await supabase
        .from("app_users")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (existing) return json(409, { error: "Email already registered" });

      const passwordHash = await hashPassword(body.password!);
      const { data: user, error: userErr } = await supabase
        .from("app_users")
        .insert({ email })
        .select("id, email")
        .single();
      if (userErr || !user) return json(500, { error: userErr?.message ?? "Failed to create user" });

      const { error: credErr } = await supabase
        .from("app_user_credentials")
        .insert({ user_id: user.id, password_hash: passwordHash, password_algo: "pbkdf2-sha256" });
      if (credErr) return json(500, { error: credErr.message });

      const { data: session, error: sessionErr } = await supabase
        .from("app_sessions")
        .insert({
          user_id: user.id,
          refresh_token_hash: makePendingHash(),
          user_agent: req.headers.get("user-agent"),
          ip_address: req.headers.get("x-forwarded-for"),
          expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        })
        .select("id")
        .single();
      if (sessionErr || !session) return json(500, { error: sessionErr?.message ?? "Failed to create session" });

      const tokens = await issueSessionTokens(user, session.id);
      const refreshHash = await hashToken(tokens.refreshToken);
      await supabase.from("app_sessions").update({ refresh_token_hash: refreshHash }).eq("id", session.id);

      return json(200, {
        user: { id: user.id, email: user.email },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessExp,
      });
    }

    if (req.method === "POST" && path.endsWith("/login")) {
      const email = normalizeEmail(body.email);
      if (!email || !body.password) return json(400, { error: "Missing credentials" });

      const { data: user, error: userErr } = await supabase
        .from("app_users")
        .select("id, email, app_user_credentials(password_hash)")
        .eq("email", email)
        .maybeSingle();
      if (userErr || !user) return json(401, { error: "Invalid credentials" });

      const passHash = (user.app_user_credentials as { password_hash?: string } | null)?.password_hash;
      if (!passHash) return json(401, { error: "Invalid credentials" });
      const valid = await verifyPassword(body.password, passHash);
      if (!valid) return json(401, { error: "Invalid credentials" });

      const { data: session, error: sessionErr } = await supabase
        .from("app_sessions")
        .insert({
          user_id: user.id,
          refresh_token_hash: makePendingHash(),
          user_agent: req.headers.get("user-agent"),
          ip_address: req.headers.get("x-forwarded-for"),
          expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        })
        .select("id")
        .single();
      if (sessionErr || !session) return json(500, { error: sessionErr?.message ?? "Failed to create session" });

      const tokens = await issueSessionTokens({ id: user.id, email: user.email }, session.id);
      const refreshHash = await hashToken(tokens.refreshToken);
      await supabase.from("app_sessions").update({ refresh_token_hash: refreshHash }).eq("id", session.id);

      return json(200, {
        user: { id: user.id, email: user.email },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessExp,
      });
    }

    if (req.method === "POST" && path.endsWith("/refresh")) {
      const refreshToken = body.refreshToken ?? parseBearerToken(req);
      if (!refreshToken) return json(400, { error: "Missing refresh token" });
      const payload = await verifyJwt(refreshToken);
      if (!payload || payload.type !== "refresh" || !payload.sid) return json(401, { error: "Invalid refresh token" });
      const refreshHash = await hashToken(refreshToken);

      const { data: session, error: sessionErr } = await supabase
        .from("app_sessions")
        .select("id, user_id, revoked_at, expires_at, app_users(email)")
        .eq("id", payload.sid)
        .eq("refresh_token_hash", refreshHash)
        .maybeSingle();
      if (sessionErr || !session) return json(401, { error: "Invalid refresh token" });
      if (session.revoked_at) return json(401, { error: "Session revoked" });
      if (new Date(session.expires_at).getTime() < Date.now()) return json(401, { error: "Session expired" });

      const user = {
        id: session.user_id as string,
        email: ((session.app_users as { email?: string } | null)?.email ?? payload.email) as string,
      };
      const tokens = await issueSessionTokens(user, session.id as string);
      await supabase
        .from("app_sessions")
        .update({
          refresh_token_hash: await hashToken(tokens.refreshToken),
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id);

      return json(200, {
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessExp,
      });
    }

    if (req.method === "POST" && path.endsWith("/logout")) {
      const refreshToken = body.refreshToken ?? parseBearerToken(req);
      if (!refreshToken) return json(200, { ok: true });
      const payload = await verifyJwt(refreshToken);
      if (payload?.sid) {
        await supabase
          .from("app_sessions")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", payload.sid);
      }
      return json(200, { ok: true });
    }

    if (req.method === "GET" && path.endsWith("/me")) {
      const token = parseBearerToken(req);
      if (!token) return json(401, { error: "Missing authorization" });
      const payload = await verifyJwt(token);
      if (!payload || payload.type !== "access") return json(401, { error: "Unauthorized" });
      return json(200, { user: { id: payload.app_user_id, email: payload.email } });
    }

    return json(404, { error: "Not found" });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "Internal error" });
  }
});

