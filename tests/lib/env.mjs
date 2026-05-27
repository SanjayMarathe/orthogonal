import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** Load Supabase + Orthogonal config from frontend/.env and supabase/functions/.env */
export function loadTestEnv() {
  const frontend = parseEnvFile(resolve(ROOT, "frontend/.env"));
  const edge = parseEnvFile(resolve(ROOT, "supabase/functions/.env"));

  return {
    supabaseUrl: frontend.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    supabaseAnonKey:
      frontend.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY,
    orthogonalApiKey:
      edge.ORTHOGONAL_API_KEY ?? process.env.ORTHOGONAL_API_KEY,
    defaultModel:
      process.env.TEST_CHAT_MODEL ?? "groq:llama-3.3-70b-versatile",
  };
}

export function requireEnv(env, keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required env: ${missing.join(", ")}. ` +
        "Set in frontend/.env or supabase/functions/.env",
    );
  }
}
