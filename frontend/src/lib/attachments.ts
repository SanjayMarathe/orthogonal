import { supabase } from "./supabase";

export type ChatAttachment = {
  path: string;
  name: string;
  mimeType: string;
  size: number;
};

export const MAX_CHAT_FILES = 5;
export const MAX_CHAT_FILE_BYTES = 5 * 1024 * 1024;

const ACCEPT =
  ".txt,.md,.json,.csv,.tsv,.yaml,.yml,.log,.pdf,.png,.jpg,.jpeg,.webp,.gif,text/*,application/json,application/pdf,image/*";

export const CHAT_FILE_ACCEPT = ACCEPT;

export function validateChatFile(file: File): string | null {
  if (file.size > MAX_CHAT_FILE_BYTES) {
    return `${file.name} exceeds 5 MB limit`;
  }
  return null;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export async function uploadChatFiles(
  userId: string,
  conversationId: string | null,
  files: File[],
): Promise<ChatAttachment[]> {
  const folder = conversationId ?? `pending-${Date.now()}`;
  const uploaded: ChatAttachment[] = [];

  for (const file of files) {
    const err = validateChatFile(file);
    if (err) throw new Error(err);

    const path = `${userId}/${folder}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
    const { error } = await supabase.storage
      .from("chat-uploads")
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (error) throw new Error(`Upload failed for ${file.name}: ${error.message}`);

    uploaded.push({
      path,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    });
  }

  return uploaded;
}

export async function getAttachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("chat-uploads")
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export function isImageAttachment(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
