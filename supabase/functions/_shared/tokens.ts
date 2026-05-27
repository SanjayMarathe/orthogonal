export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(
  messages: Array<{ content?: string | null; tool_calls?: unknown }>,
): number {
  return messages.reduce((sum, msg) => {
    let count = estimateTokens(msg.content);
    if (msg.tool_calls) {
      count += estimateTokens(JSON.stringify(msg.tool_calls));
    }
    return sum + count;
  }, 0);
}

export function formatTokenCount(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
