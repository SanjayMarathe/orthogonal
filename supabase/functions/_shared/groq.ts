const GROQ_BASE = "https://api.groq.com/openai/v1";
const GROQ_TIMEOUT_MS = 60_000;
const MAX_GROQ_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function groqRetryMs(error: string, attempt: number): number {
  const match = error.match(/try again in ([\d.]+)s/i);
  if (match) return Math.ceil(Number.parseFloat(match[1]) * 1000) + 500;
  return Math.min(30_000, 3000 * 2 ** attempt);
}

function isGroqRateLimit(error?: string): boolean {
  return Boolean(
    error?.includes("Rate limit") || error?.includes("rate_limit"),
  );
}

function isGroqToolFailure(data: Record<string, unknown>): boolean {
  const choice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0];
  if (!choice) return false;
  if (choice.finish_reason === "failed_generation") return true;
  const content = (choice.message as Record<string, unknown> | undefined)?.content;
  if (typeof content === "string") {
    return (
      content.includes("tool call validation failed") ||
      content.includes("Failed to call a function")
    );
  }
  return false;
}

export type GroqChatOptions = {
  toolChoice?: "auto" | "none" | "required";
  maxTokens?: number;
  temperature?: number;
};

function getGroqKey(): string | null {
  return Deno.env.get("GROQ_API_KEY") ?? null;
}

export function isGroqConfigured(): boolean {
  return Boolean(getGroqKey());
}

/** Curated Groq models with reliable tool-calling (Context7 / Groq docs). */
export const GROQ_MODEL_CATALOG = [
  {
    id: "groq:llama-3.3-70b-versatile",
    name: "Groq · Llama 3.3 70B",
    description: "Fast inference with tool calling (recommended)",
    contextLength: 128_000,
  },
  {
    id: "groq:openai/gpt-oss-20b",
    name: "Groq · GPT OSS 20B",
    description: "Low-latency reasoning + tools",
    contextLength: 131_072,
  },
  {
    id: "groq:llama-3.1-8b-instant",
    name: "Groq · Llama 3.1 8B",
    description: "Fastest — lighter tool use",
    contextLength: 131_072,
  },
];

function sanitizeMessagesForGroq(messages: unknown[]): unknown[] {
  return (messages as Array<Record<string, unknown>>).map((msg) => {
    const toolCalls = msg.tool_calls as
      | Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>
      | undefined;
    if (!toolCalls?.length) return msg;
    return {
      ...msg,
      tool_calls: toolCalls.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }
        if (tc.function.name === "orthogonal_search" && args.limit != null) {
          delete args.limit;
        }
        return {
          ...tc,
          function: {
            ...tc.function,
            arguments: JSON.stringify(args),
          },
        };
      }),
    };
  });
}

export async function groqChatStreamWithTools(
  messages: unknown[],
  tools: unknown[],
  model = "llama-3.3-70b-versatile",
  options?: GroqChatOptions,
  onContentDelta?: (text: string) => void,
  attempt = 0,
): Promise<{
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
}> {
  const key = getGroqKey();
  if (!key) {
    return { ok: false, data: {}, error: "GROQ_API_KEY is not configured on the server" };
  }

  const sanitizedMessages = sanitizeMessagesForGroq(messages);
  const body: Record<string, unknown> = {
    model,
    messages: sanitizedMessages,
    tools,
    tool_choice: options?.toolChoice ?? "auto",
    temperature: options?.temperature ?? 0.4,
    max_tokens: options?.maxTokens ?? 4096,
    stream: true,
  };

  try {
    const response = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });

    if (!response.ok) {
      const rawText = await response.text();
      let data: Record<string, unknown> = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        /* ignore */
      }
      const errMsg =
        (data.error as { message?: string })?.message ??
        (data.message as string) ??
        `Groq HTTP ${response.status}`;
      if (
        (response.status === 429 || isGroqRateLimit(errMsg)) &&
        attempt < MAX_GROQ_RETRIES
      ) {
        await sleep(groqRetryMs(errMsg, attempt));
        return groqChatStreamWithTools(
          messages,
          tools,
          model,
          options,
          onContentDelta,
          attempt + 1,
        );
      }
      return { ok: false, data, error: errMsg };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { ok: false, data: {}, error: "No response stream from Groq" };
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const toolAcc: Record<
      number,
      { id: string; type: string; function: { name: string; arguments: string } }
    > = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as Record<string, unknown>;
          const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
          const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          const piece = delta.content as string | undefined;
          if (piece) {
            content += piece;
            onContentDelta?.(piece);
          }

          const toolDeltas = delta.tool_calls as
            | Array<{
                index?: number;
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
              }>
            | undefined;
          if (toolDeltas) {
            for (const td of toolDeltas) {
              const idx = td.index ?? 0;
              if (!toolAcc[idx]) {
                toolAcc[idx] = {
                  id: "",
                  type: "function",
                  function: { name: "", arguments: "" },
                };
              }
              if (td.id) toolAcc[idx].id += td.id;
              if (td.type) toolAcc[idx].type = td.type;
              if (td.function?.name) {
                toolAcc[idx].function.name += td.function.name;
              }
              if (td.function?.arguments) {
                toolAcc[idx].function.arguments += td.function.arguments;
              }
            }
          }
        } catch {
          /* skip malformed chunk */
        }
      }
    }

    const toolCalls = Object.keys(toolAcc)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => toolAcc[Number(k)])
      .filter((tc) => tc.id && tc.function.name);

    const data: Record<string, unknown> = {
      choices: [{
        message: {
          content: content || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
      }],
    };

    if (isGroqToolFailure(data) && attempt < MAX_GROQ_RETRIES) {
      await sleep(800 * (attempt + 1));
      return groqChatStreamWithTools(
        messages,
        tools,
        model,
        options,
        onContentDelta,
        attempt + 1,
      );
    }

    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      data: {},
      error: err instanceof Error ? err.message : "Groq stream failed",
    };
  }
}

export async function groqChatStream(
  messages: unknown[],
  model = "llama-3.3-70b-versatile",
  options?: GroqChatOptions,
  onToken?: (token: string) => void,
): Promise<{ ok: boolean; content: string; error?: string }> {
  const key = getGroqKey();
  if (!key) {
    return { ok: false, content: "", error: "GROQ_API_KEY is not configured on the server" };
  }

  const sanitizedMessages = sanitizeMessagesForGroq(messages);
  const body: Record<string, unknown> = {
    model,
    messages: sanitizedMessages,
    temperature: options?.temperature ?? 0.3,
    max_tokens: options?.maxTokens ?? 4096,
    stream: true,
  };

  try {
    const response = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });

    if (!response.ok) {
      const rawText = await response.text();
      let data: Record<string, unknown> = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        /* ignore */
      }
      const errMsg =
        (data.error as { message?: string })?.message ??
        (data.message as string) ??
        `Groq HTTP ${response.status}`;
      return { ok: false, content: "", error: errMsg };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { ok: false, content: "", error: "No response stream from Groq" };
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as Record<string, unknown>;
          const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
          const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
          const piece = delta?.content as string | undefined;
          if (piece) {
            content += piece;
            onToken?.(piece);
          }
        } catch {
          /* skip malformed chunk */
        }
      }
    }

    return { ok: true, content: content.trim() };
  } catch (err) {
    return {
      ok: false,
      content: "",
      error: err instanceof Error ? err.message : "Groq stream failed",
    };
  }
}

export async function groqChat(
  messages: unknown[],
  tools?: unknown[],
  model = "llama-3.3-70b-versatile",
  options?: GroqChatOptions,
  attempt = 0,
): Promise<{
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
}> {
  const key = getGroqKey();
  if (!key) {
    return { ok: false, data: {}, error: "GROQ_API_KEY is not configured on the server" };
  }

  const sanitizedMessages = sanitizeMessagesForGroq(messages);

  const body: Record<string, unknown> = {
    model,
    messages: sanitizedMessages,
    temperature: options?.temperature ?? 0.4,
    max_tokens: options?.maxTokens ?? 4096,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = options?.toolChoice ?? "auto";
  }

  try {
    const response = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });

    const rawText = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      return {
        ok: false,
        data: {},
        error: `Invalid JSON from Groq: ${rawText.slice(0, 200)}`,
      };
    }

    if (!response.ok) {
      const errMsg =
        (data.error as { message?: string })?.message ??
        (data.message as string) ??
        `Groq HTTP ${response.status}`;
      if (
        (response.status === 429 || isGroqRateLimit(errMsg)) &&
        attempt < MAX_GROQ_RETRIES
      ) {
        await sleep(groqRetryMs(errMsg, attempt));
        return groqChat(messages, tools, model, options, attempt + 1);
      }
      return { ok: false, data, error: errMsg };
    }

    if (isGroqToolFailure(data) && attempt < MAX_GROQ_RETRIES) {
      await sleep(800 * (attempt + 1));
      return groqChat(messages, tools, model, options, attempt + 1);
    }

    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      data: {},
      error: err instanceof Error ? err.message : "Groq request failed",
    };
  }
}
