import { basetenChat } from "./orthogonal.ts";
import {
  groqChat,
  groqChatStream,
  groqChatStreamWithTools,
  isGroqConfigured,
  type GroqChatOptions,
} from "./groq.ts";

export type LlmChatOptions = GroqChatOptions;

export function parseModelId(modelId: string): {
  provider: "groq" | "baseten";
  model: string;
} {
  if (modelId.startsWith("groq:")) {
    return { provider: "groq", model: modelId.slice(5) };
  }
  if (modelId.startsWith("baseten:")) {
    return { provider: "baseten", model: modelId.slice(8) };
  }
  return { provider: "baseten", model: modelId };
}

function isRateLimitError(error?: string): boolean {
  return Boolean(
    error?.includes("Rate limit") ||
      error?.includes("rate_limit") ||
      error?.includes("429") ||
      error?.includes("tokens per minute"),
  );
}

function estimateMessageChars(messages: unknown[]): number {
  return JSON.stringify(messages).length;
}

export async function llmChatStreamWithTools(
  modelId: string,
  messages: unknown[],
  tools: unknown[] | undefined,
  onReasoningDelta: (text: string) => void,
  options?: LlmChatOptions,
): Promise<{
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
}> {
  const { provider, model } = parseModelId(modelId);

  if (provider === "groq" && tools?.length) {
    return groqChatStreamWithTools(
      messages,
      tools,
      model,
      options,
      onReasoningDelta,
    );
  }

  const res = await llmChat(modelId, messages, tools, options);
  if (!res.ok) return res;

  const choice = (res.data.choices as Array<Record<string, unknown>>)?.[0];
  const msg = choice?.message as Record<string, unknown> | undefined;
  const content = (msg?.content as string)?.trim() ?? "";
  if (content) onReasoningDelta(content);

  return res;
}

export async function llmChatStream(
  modelId: string,
  messages: unknown[],
  onToken: (token: string) => void,
  options?: LlmChatOptions,
): Promise<{ ok: boolean; content: string; error?: string }> {
  const { provider, model } = parseModelId(modelId);

  if (provider === "groq") {
    const res = await groqChatStream(messages, model, options, onToken);
    if (res.ok) return res;
    if (!isRateLimitError(res.error)) return res;

    const fallback = await groqChatStream(
      messages,
      "llama-3.1-8b-instant",
      options,
      onToken,
    );
    if (fallback.ok) return fallback;
  }

  const res = await llmChat(modelId, messages, undefined, {
    ...options,
    toolChoice: "none",
  });
  if (!res.ok) {
    return { ok: false, content: "", error: res.error };
  }
  const choice = (res.data.choices as Array<Record<string, unknown>>)?.[0];
  const msg = choice?.message as Record<string, unknown> | undefined;
  const content = (msg?.content as string)?.trim() ?? "";
  if (content) onToken(content);
  return { ok: true, content };
}

export async function llmChat(
  modelId: string,
  messages: unknown[],
  tools?: unknown[],
  options?: LlmChatOptions,
): Promise<{
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
}> {
  const { provider, model } = parseModelId(modelId);

  if (provider === "groq") {
    let res = await groqChat(messages, tools, model, options);
    if (
      !res.ok &&
      isRateLimitError(res.error) &&
      model !== "llama-3.1-8b-instant" &&
      estimateMessageChars(messages) < 24_000
    ) {
      res = await groqChat(messages, tools, "llama-3.1-8b-instant", {
        ...options,
        maxTokens: options?.maxTokens ?? 4096,
      });
    }
    if (!res.ok && isRateLimitError(res.error)) {
      return basetenChat(messages, tools, "moonshotai/Kimi-K2.5", {
        ...options,
        maxTokens: options?.maxTokens ?? 2048,
      });
    }
    return res;
  }

  return basetenChat(messages, tools, model, options);
}

export { isGroqConfigured };
