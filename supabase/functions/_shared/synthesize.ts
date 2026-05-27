import { compactToolPayloadForSummary } from "./compactToolResults.ts";
import { formatLeadershipFromJson } from "./leadership.ts";
import { llmChat } from "./llm.ts";
import type { ChatMessage, SseEvent } from "./types.ts";

const SYNTHESIS_INSTRUCTION = `Write the final answer for the user based ONLY on tool results above.

Rules:
- Use clean markdown: headings, bullet lists, and tables where helpful.
- Never paste raw JSON or large code blocks.
- Only include facts explicitly present in the tool results — never invent names, funding, or contacts.
- If a requested data point is missing from tool results, say it wasn't returned and which API call failed or lacked that field.
- Do not mention email, SMS, or sending messages unless the user explicitly asked to send something.
- If the user asked for VP+ or executive contacts, list up to 5 from crustdata decision_makers (VP, SVP, EVP, Chief, President titles).
- Never use placeholder text like [Name], [insert X], or TBD — only real values from tool results or state what is missing.
- Cite which API provided each section when useful (e.g. company-enrich, crustdata).`;

export function pruneMessagesForSummary(messages: ChatMessage[]): ChatMessage[] {
  const system = messages.find((m) => m.role === "system");
  const userMsgs = messages.filter((m) => m.role === "user");
  const toolMsgs = messages.filter((m) => m.role === "tool").slice(-5);
  const assistantWithTools = messages
    .filter((m) => m.role === "assistant" && m.tool_calls?.length)
    .slice(-5);

  const pruned: ChatMessage[] = [];
  if (system) pruned.push(system);
  pruned.push(...userMsgs.slice(-2));
  for (const a of assistantWithTools) {
    pruned.push({
      role: "assistant",
      content: a.content ?? null,
      tool_calls: a.tool_calls,
    });
  }
  for (const t of toolMsgs) {
    pruned.push({
      role: "tool",
      tool_call_id: t.tool_call_id,
      content: compactToolPayloadForSummary(t.content ?? ""),
    });
  }
  return pruned;
}

function parseToolPayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Guaranteed markdown when the LLM synthesis call fails or times out. */
export function formatToolResultsFallback(messages: ChatMessage[]): string | null {
  const userQuestion =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const toolMsgs = messages.filter((m) => m.role === "tool" && m.content);
  if (toolMsgs.length === 0) return null;

  const lines: string[] = [];
  const failed: string[] = [];

  for (const t of toolMsgs) {
    const raw = t.content ?? "";
    const parsed = parseToolPayload(raw) as Record<string, unknown> | null;
    if (!parsed) continue;

    if (parsed.error) {
      failed.push(String(parsed.error).slice(0, 120));
      continue;
    }

    const results = (parsed as { results?: Array<{ slug?: string; name?: string }> })
      .results;
    if (Array.isArray(results) && results.length > 0) {
      lines.push("## APIs found (catalog search)");
      for (const r of results.slice(0, 6)) {
        if (r.slug) lines.push(`- **${r.slug}**${r.name ? ` — ${r.name}` : ""}`);
      }
    }

    const endpoints = (parsed as { endpoints?: unknown[] }).endpoints;
    if (Array.isArray(endpoints) && endpoints.length > 0) {
      lines.push("## Endpoint schema (get_details)");
      for (const ep of endpoints.slice(0, 3)) {
        if (ep && typeof ep === "object") {
          const e = ep as Record<string, unknown>;
          lines.push(
            `- \`${e.method ?? "GET"} ${e.path ?? ""}\` — ${String(e.description ?? "").slice(0, 120)}`,
          );
        }
      }
    }

    const data = (parsed.data ?? parsed) as Record<string, unknown>;

    const searchResults = (data.results ?? parsed.results) as
      | Array<Record<string, unknown>>
      | undefined;
    if (Array.isArray(searchResults) && searchResults.length > 0) {
      lines.push("## Web search results");
      for (const r of searchResults.slice(0, 8)) {
        const title = String(r.title ?? r.name ?? "Result");
        const url = r.url ? String(r.url) : "";
        const snippet = String(r.snippet ?? r.description ?? "").slice(0, 280);
        lines.push(`- **${title}**${url ? ` — ${url}` : ""}`);
        if (snippet) lines.push(`  ${snippet}`);
      }
    }

    if (data.observed_employee_count != null || data.department_headcount) {
      lines.push("## Company workforce (company-enrich)");
      if (data.domain) lines.push(`- **Domain:** ${data.domain}`);
      if (data.observed_employee_count != null) {
        lines.push(`- **Employees:** ${data.observed_employee_count}`);
      }
      if (data.employee_count_range) {
        lines.push(`- **Range:** ${data.employee_count_range}`);
      }
      const dept = data.department_headcount as Record<string, number> | undefined;
      if (dept && typeof dept === "object") {
        lines.push("- **Departments:**");
        for (const [k, v] of Object.entries(dept).slice(0, 8)) {
          lines.push(`  - ${k.replace(/_/g, " ")}: ${v}`);
        }
      }
    }

    if (data.industry || data.industries || data.description) {
      lines.push("## Company profile");
      if (data.name) lines.push(`- **Name:** ${data.name}`);
      if (data.industry) lines.push(`- **Industry:** ${data.industry}`);
      if (Array.isArray(data.industries)) {
        lines.push(`- **Industries:** ${data.industries.join(", ")}`);
      }
      if (data.description) {
        lines.push(`- ${String(data.description).slice(0, 300)}`);
      }
    }

    const leadership = formatLeadershipFromJson(raw);
    if (leadership) lines.push(leadership);
  }

  if (lines.length === 0 && failed.length === 0) return null;

  const heading = userQuestion.trim()
    ? `## Answer\n\nBased on your question: *${userQuestion.trim().slice(0, 200)}*\n`
    : "## Answer\n";

  const body = lines.length ? lines.join("\n\n") : "";
  const failNote = failed.length
    ? `\n\n**Some API calls failed:** ${failed.slice(0, 3).join("; ")}`
    : "";

  return `${heading}\n${body}${failNote}`.trim();
}

export async function synthesizeFromToolResults(
  workingMessages: ChatMessage[],
  model: string,
  emit?: (event: SseEvent) => void,
): Promise<{ content: string; streamed: boolean }> {
  const summaryMessages: ChatMessage[] = [
    ...pruneMessagesForSummary(workingMessages),
    { role: "user", content: SYNTHESIS_INSTRUCTION },
  ];

  emit?.({ type: "thinking", label: "Writing your answer…" });

  const summaryRes = await llmChat(
    model,
    summaryMessages,
    undefined,
    { toolChoice: "none", maxTokens: 2048 },
  );
  if (summaryRes.ok) {
    const choice = (summaryRes.data.choices as Array<Record<string, unknown>>)?.[0];
    const msg = choice?.message as Record<string, unknown> | undefined;
    const content = (msg?.content as string)?.trim() ?? "";
    if (content) return { content, streamed: false };
  }

  const fallback = formatToolResultsFallback(workingMessages);
  if (fallback) {
    return { content: fallback, streamed: false };
  }

  return {
    content:
      "I ran the API calls but couldn't turn the results into a summary. Some calls may have failed — try `@company-enrich` or `@crustdata` with a specific domain or company name.",
    streamed: false,
  };
}
