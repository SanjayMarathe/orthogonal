export type AppUser = {
  id: string;
  email: string;
};

type AuthPayload = {
  user: AppUser;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
};

const STORAGE_KEY = "orthogonal-app-auth";

type StoredAuth = AuthPayload;

let cachedAuth: StoredAuth | null = null;

function readStorage(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  if (cachedAuth) return cachedAuth;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    cachedAuth = JSON.parse(raw) as StoredAuth;
    return cachedAuth;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function writeStorage(value: StoredAuth | null): void {
  if (typeof window === "undefined") return;
  cachedAuth = value;
  if (!value) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("app-auth-changed"));
}

function authUrl(path: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  return `${supabaseUrl}/functions/v1/auth${path}`;
}

function edgePublicHeaders(): HeadersInit {
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? "";
  return {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  };
}

export function getAppAuthToken(): string | null {
  return readStorage()?.accessToken ?? null;
}

export function getAppUser(): AppUser | null {
  return readStorage()?.user ?? null;
}

export function clearAppAuth(): void {
  writeStorage(null);
}

async function postAuth(path: string, body: Record<string, unknown>): Promise<AuthPayload> {
  const res = await fetch(authUrl(path), {
    method: "POST",
    headers: edgePublicHeaders(),
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AuthPayload> & {
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "Authentication failed");
  return data as AuthPayload;
}

export async function registerWithEmail(email: string, password: string): Promise<AppUser> {
  const payload = await postAuth("/register", { email, password });
  writeStorage(payload);
  return payload.user;
}

export async function loginWithEmail(email: string, password: string): Promise<AppUser> {
  const payload = await postAuth("/login", { email, password });
  writeStorage(payload);
  return payload.user;
}

export async function refreshAccessToken(): Promise<string | null> {
  const auth = readStorage();
  if (!auth?.refreshToken) return null;
  const res = await fetch(authUrl("/refresh"), {
    method: "POST",
    headers: edgePublicHeaders(),
    body: JSON.stringify({ refreshToken: auth.refreshToken }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AuthPayload> & {
    error?: string;
  };
  if (!res.ok) {
    clearAppAuth();
    return null;
  }
  const updated = data as AuthPayload;
  writeStorage(updated);
  return updated.accessToken;
}

export async function ensureValidAccessToken(): Promise<string | null> {
  const auth = readStorage();
  if (!auth) return null;
  const now = Math.floor(Date.now() / 1000);
  if (auth.accessTokenExpiresAt > now + 30) return auth.accessToken;
  return refreshAccessToken();
}

export async function logoutAppUser(): Promise<void> {
  const auth = readStorage();
  if (auth?.refreshToken) {
    await fetch(authUrl("/logout"), {
      method: "POST",
      headers: edgePublicHeaders(),
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    }).catch(() => undefined);
  }
  clearAppAuth();
}

export function subscribeAuthChange(cb: () => void): () => void {
  const fn = () => cb();
  window.addEventListener("app-auth-changed", fn);
  return () => window.removeEventListener("app-auth-changed", fn);
}

