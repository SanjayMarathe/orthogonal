import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { ChatAttachment } from "./types.ts";

const MAX_EXTRACT_CHARS = 30_000;
const CHAT_UPLOADS_BUCKET = "chat-uploads";

export function validateAttachmentPaths(
  userId: string,
  attachments: ChatAttachment[],
): ChatAttachment[] {
  return attachments.filter((a) => {
    if (!a.path?.startsWith(`${userId}/`)) return false;
    if (!a.name || !a.mimeType) return false;
    if (a.size > 5_242_880) return false;
    return true;
  });
}

async function extractTextFromBlob(
  blob: Blob,
  mimeType: string,
  name: string,
): Promise<string> {
  const lower = name.toLowerCase();
  const isText =
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/csv" ||
    lower.endsWith(".md") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".json") ||
    lower.endsWith(".tsv") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".log") ||
    lower.endsWith(".txt");

  if (isText) {
    const text = await blob.text();
    if (text.length <= MAX_EXTRACT_CHARS) return text;
    return (
      text.slice(0, MAX_EXTRACT_CHARS) +
      `\n…[truncated ${text.length - MAX_EXTRACT_CHARS} chars]`
    );
  }

  if (mimeType.startsWith("image/")) {
    return "[Image attached — visual content is not sent to the model; describe the image in your message if needed.]";
  }

  if (mimeType === "application/pdf") {
    return "[PDF attached — binary content not extracted. Summarize or quote relevant parts in your message if needed.]";
  }

  return "[Binary file attached — content not extracted.]";
}

export async function processAttachmentsForMessage(
  supabase: SupabaseClient,
  userMessage: string,
  attachments: ChatAttachment[],
): Promise<{
  displayContent: string;
  llmContent: string;
  attachmentExcerpts: Array<{ name: string; excerpt: string }>;
}> {
  if (!attachments.length) {
    return {
      displayContent: userMessage,
      llmContent: userMessage,
      attachmentExcerpts: [],
    };
  }

  const excerpts: Array<{ name: string; excerpt: string }> = [];
  const fileBlocks: string[] = [];

  for (const att of attachments) {
    const { data, error } = await supabase.storage
      .from(CHAT_UPLOADS_BUCKET)
      .download(att.path);
    if (error || !data) {
      excerpts.push({
        name: att.name,
        excerpt: `[Failed to load file: ${error?.message ?? "unknown error"}]`,
      });
      fileBlocks.push(`**${att.name}** — could not be read.`);
      continue;
    }
    const excerpt = await extractTextFromBlob(data, att.mimeType, att.name);
    excerpts.push({ name: att.name, excerpt });
    fileBlocks.push(
      `**${att.name}** (${att.mimeType}, ${Math.round(att.size / 1024)} KB)\n\`\`\`\n${excerpt}\n\`\`\``,
    );
  }

  const filesSection = fileBlocks.join("\n\n");
  const llmContent = userMessage.trim()
    ? `${userMessage.trim()}\n\n---\n**Attached files:**\n\n${filesSection}`
    : `**Attached files:**\n\n${filesSection}`;

  const displayContent = userMessage.trim()
    ? userMessage.trim()
    : attachments.length === 1
      ? `📎 ${attachments[0].name}`
      : `📎 ${attachments.length} files attached`;

  return { displayContent, llmContent, attachmentExcerpts: excerpts };
}

export function buildUserContentFromHistory(
  content: string | null,
  metadata: Record<string, unknown> | null,
): string {
  const excerpts = metadata?.attachmentExcerpts as
    | Array<{ name: string; excerpt: string }>
    | undefined;
  if (!excerpts?.length) return content ?? "";

  const attachments = metadata?.attachments as ChatAttachment[] | undefined;
  const fileBlocks = excerpts.map((e, i) => {
    const att = attachments?.[i];
    const meta = att
      ? ` (${att.mimeType}, ${Math.round(att.size / 1024)} KB)`
      : "";
    return `**${e.name}**${meta}\n\`\`\`\n${e.excerpt}\n\`\`\``;
  });

  const base = content?.trim() ?? "";
  const filesSection = fileBlocks.join("\n\n");
  return base
    ? `${base}\n\n---\n**Attached files:**\n\n${filesSection}`
    : `**Attached files:**\n\n${filesSection}`;
}
