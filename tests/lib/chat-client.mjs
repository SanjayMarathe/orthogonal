/**
 * Shared custom-auth helper + chat SSE client for E2E tests.
 */

export async function createTestAccessToken(supabaseUrl) {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const password = "Passw0rd!Passw0rd!";
  const res = await fetch(`${supabaseUrl}/functions/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.accessToken) {
    throw new Error(`Failed to register test user: ${JSON.stringify(body)}`);
  }
  return body.accessToken;
}

/**
 * @returns {Promise<{
 *   content: string;
 *   toolSteps: Array<{ type: string; tool?: string; label?: string; success?: boolean }>;
 *   events: unknown[];
 *   elapsedMs: number;
 *   hasInvalidJson: boolean;
 * }>}
 */
export async function runChatStream({
  supabaseUrl,
  accessToken,
  message,
  model = "groq:llama-3.3-70b-versatile",
  conversationId,
  timeoutMs = 180_000,
}) {
  const startMs = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let content = "";
  let postToolReasoning = "";
  const toolSteps = [];
  const events = [];
  let hasInvalidJson = false;

  try {
    const chatRes = await fetch(`${supabaseUrl}/functions/v1/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        message,
        stream: true,
        model,
      }),
      signal: controller.signal,
    });

    if (!chatRes.ok) {
      const err = await chatRes.text();
      throw new Error(`Chat HTTP ${chatRes.status}: ${err.slice(0, 500)}`);
    }

    const reader = chatRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          events.push(event);

          if (event.type === "token" && event.content) content += event.content;
          if (event.type === "reasoning_delta" && event.placement === "after_tools") {
            postToolReasoning += event.content ?? "";
          }
          if (event.type === "tool_start") {
            toolSteps.push({
              type: "start",
              id: event.id,
              tool: event.tool,
              label: event.label,
            });
          }
          if (event.type === "tool_done") {
            toolSteps.push({
              type: "done",
              id: event.id,
              tool: event.tool,
              label: event.label,
              success: event.success,
            });
            const preview = event.resultPreview ?? "";
            if (preview.includes("Invalid JSON response from Orthogonal")) {
              hasInvalidJson = true;
            }
          }
          if (event.type === "error") {
            throw new Error(event.message ?? "SSE error event");
          }
        } catch (err) {
          if (err instanceof SyntaxError) continue;
          throw err;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (content.includes("Invalid JSON response from Orthogonal")) {
    hasInvalidJson = true;
  }

  return {
    content,
    postToolReasoning,
    toolSteps,
    events,
    elapsedMs: Date.now() - startMs,
    hasInvalidJson,
  };
}
