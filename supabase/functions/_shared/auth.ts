import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function getJwtSecret(): string {
  const secret = Deno.env.get("APP_JWT_SECRET") ?? Deno.env.get("JWT_SECRET");
  if (!secret) throw new Error("Missing APP_JWT_SECRET");
  return secret;
}

export type AppUser = {
  id: string;
  email: string;
};

export type AppJwtPayload = {
  sub: string;
  app_user_id: string;
  email: string;
  role: "authenticated";
  aud: "authenticated";
  type: "access" | "refresh";
  sid?: string;
  exp: number;
  iat: number;
};

function b64UrlEncode(input: Uint8Array): string {
  return btoa(String.fromCharCode(...input))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64UrlDecode(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 ? "=".repeat(4 - (normalized.length % 4)) : "";
  const raw = atob(normalized + pad);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(message));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signJwt(payload: AppJwtPayload): Promise<string> {
  const secret = getJwtSecret();
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64UrlEncode(textEncoder.encode(JSON.stringify(header)));
  const p = b64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const msg = `${h}.${p}`;
  const sig = await hmacSha256(secret, msg);
  return `${msg}.${b64UrlEncode(sig)}`;
}

export async function verifyJwt(token: string): Promise<AppJwtPayload | null> {
  const secret = getJwtSecret();
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const msg = `${h}.${p}`;
  const expected = await hmacSha256(secret, msg);
  const got = b64UrlDecode(s);
  if (!timingSafeEqual(expected, got)) return null;
  let payload: AppJwtPayload;
  try {
    payload = JSON.parse(textDecoder.decode(b64UrlDecode(p))) as AppJwtPayload;
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  if (!payload.app_user_id || !payload.email || !payload.sub) return null;
  if (payload.role !== "authenticated" || payload.aud !== "authenticated") return null;
  return payload;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 210_000,
      salt,
    },
    key,
    256,
  );
  const digest = new Uint8Array(bits);
  return `pbkdf2$210000$${b64UrlEncode(salt)}$${b64UrlEncode(digest)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 100_000) return false;
  const salt = b64UrlDecode(parts[2]);
  const expected = b64UrlDecode(parts[3]);
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt,
    },
    key,
    expected.length * 8,
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

export async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return b64UrlEncode(new Uint8Array(digest));
}

export function parseBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export async function requireAppUser(req: Request): Promise<AppJwtPayload> {
  const token = parseBearerToken(req);
  if (!token) throw new Error("Missing authorization");
  const payload = await verifyJwt(token);
  if (!payload || payload.type !== "access") throw new Error("Unauthorized");
  return payload;
}

/** Cron / pg_net invocations use x-queue-worker-secret matching QUEUE_WORKER_SECRET. */
export async function requireAppUserOrWorkerSecret(req: Request): Promise<AppJwtPayload | null> {
  const secret = Deno.env.get("QUEUE_WORKER_SECRET");
  const header = req.headers.get("x-queue-worker-secret");
  if (secret && header && timingSafeEqual(textEncoder.encode(header), textEncoder.encode(secret))) {
    return null;
  }
  return requireAppUser(req);
}

export function supabaseWithAuth(supabaseUrl: string, supabaseAnonKey: string, token: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

