import { createClient } from "@supabase/supabase-js";
import { ensureValidAccessToken } from "./appAuth";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Configure frontend/.env",
  );
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
  accessToken: async () => (await ensureValidAccessToken()) ?? "",
});

export type Conversation = {
  id: string;
  title: string;
  context_tokens: number;
  context_limit: number;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ToolStep = {
  id: string;
  tool: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  args?: Record<string, unknown>;
  resultPreview?: string;
  reasoning?: string;
  meta?: {
    requestId?: string;
    priceCents?: number;
    durationMs?: number;
  };
};

export type SseEvent = {
  type: string;
  content?: string;
  id?: string;
  tool?: string;
  label?: string;
  args?: Record<string, unknown>;
  success?: boolean;
  meta?: ToolStep["meta"];
  resultPreview?: string;
  contextTokens?: number;
  contextLimit?: number;
  conversationId?: string;
  title?: string;
  message?: string;
  placement?: "agent" | "after_tools";
  stepId?: string;
  reasoningBefore?: string;
  reasoningAfter?: string;
};
