import { ArrowUp, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CHAT_FILE_ACCEPT,
  MAX_CHAT_FILES,
  validateChatFile,
} from "@/lib/attachments";
import { filterIntegrations } from "@/lib/integrations";
import { useIntegrations } from "@/hooks/useIntegrations";
import { useModels } from "@/hooks/useModels";
import { ContextRing } from "./ContextRing";
import { MentionAutocomplete } from "./MentionAutocomplete";
import { MentionTextarea } from "./MentionTextarea";
import { ModelSelector } from "./ModelSelector";
import { PendingFileChip } from "./MessageAttachments";

type MessageInputProps = {
  onSend: (message: string, model: string, files?: File[]) => void;
  disabled?: boolean;
  prefill?: string;
  onPrefillConsumed?: () => void;
  contextTokens: number;
  contextLimit: number;
};

type MentionState = {
  query: string;
  startIndex: number;
};

function getMentionState(
  value: string,
  cursorPos: number,
): MentionState | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/@([\w-]*)$/);
  if (!match) return null;
  return { query: match[1], startIndex: cursorPos - match[0].length };
}

export function MessageInput({
  onSend,
  disabled,
  prefill,
  onPrefillConsumed,
  contextTokens,
  contextLimit,
}: MessageInputProps) {
  const { integrations } = useIntegrations();
  const { selectedModelId } = useModels();
  const [value, setValue] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const syncCursor = () => {
    setCursorPos(textareaRef.current?.selectionStart ?? value.length);
  };

  useEffect(() => {
    if (prefill) {
      setValue(prefill);
      onPrefillConsumed?.();
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(prefill.length, prefill.length);
          syncCursor();
        }
      });
    }
  }, [prefill, onPrefillConsumed]);

  const mention = getMentionState(value, cursorPos);
  const mentionOptions = mention
    ? filterIntegrations(integrations, mention.query).slice(0, 8)
    : [];
  const mentionOpen = !!mention && mentionOptions.length > 0;

  useEffect(() => {
    setMentionIndex(0);
  }, [mention?.query]);

  const insertMention = (slug: string) => {
    if (!mention) return;
    const before = value.slice(0, mention.startIndex);
    const after = value.slice(cursorPos);
    const inserted = `@${slug} `;
    const newValue = `${before}${inserted}${after}`;
    setValue(newValue);
    const newCursor = before.length + inserted.length;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(newCursor, newCursor);
        setCursorPos(newCursor);
      }
    });
  };

  const addFiles = (files: FileList | File[]) => {
    setFileError(null);
    const next = [...pendingFiles];
    for (const file of files) {
      if (next.length >= MAX_CHAT_FILES) {
        setFileError(`Maximum ${MAX_CHAT_FILES} files per message`);
        break;
      }
      const err = validateChatFile(file);
      if (err) {
        setFileError(err);
        continue;
      }
      if (next.some((f) => f.name === file.name && f.size === file.size)) continue;
      next.push(file);
    }
    setPendingFiles(next);
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if ((!trimmed && pendingFiles.length === 0) || disabled) return;
    onSend(
      trimmed,
      selectedModelId,
      pendingFiles.length > 0 ? pendingFiles : undefined,
    );
    setValue("");
    setPendingFiles([]);
    setFileError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionOptions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionOptions[mentionIndex].slug);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = Boolean(value.trim() || pendingFiles.length > 0);

  return (
    <div className="shrink-0 border-t border-gray-100 px-4 py-4 dark:border-gray-800">
      <div className="relative mx-auto max-w-[720px]">
        <MentionAutocomplete
          open={mentionOpen}
          query={mention?.query ?? ""}
          options={mentionOptions}
          selectedIndex={mentionIndex}
          onSelect={(integration) => insertMention(integration.slug)}
        />
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          {pendingFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pendingFiles.map((file, i) => (
                <PendingFileChip
                  key={`${file.name}-${file.size}-${i}`}
                  file={file}
                  onRemove={() =>
                    setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))
                  }
                />
              ))}
            </div>
          )}
          {fileError && (
            <p className="mb-2 text-xs text-red-500">{fileError}</p>
          )}
          <MentionTextarea
            value={value}
            onChange={setValue}
            onKeyDown={handleKeyDown}
            onCursorSync={syncCursor}
            placeholder="Reply... (@ API, attach files, /clear or /compress)"
            disabled={disabled}
            textareaRef={textareaRef}
          />
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
            <div className="flex items-center gap-1">
              <ModelSelector disabled={disabled} />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={CHAT_FILE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                }}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => fileInputRef.current?.click()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                aria-label="Attach files"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <ContextRing
                tokens={contextTokens}
                limit={contextLimit}
                size={32}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={disabled || !canSend}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                aria-label="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
