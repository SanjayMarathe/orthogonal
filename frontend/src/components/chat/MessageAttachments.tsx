import { FileText, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getAttachmentUrl,
  isImageAttachment,
  type ChatAttachment,
} from "@/lib/attachments";
import { cn } from "@/lib/utils";

type MessageAttachmentsProps = {
  attachments: ChatAttachment[];
  compact?: boolean;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function AttachmentImage({ attachment }: { attachment: ChatAttachment }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAttachmentUrl(attachment.path).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [attachment.path]);

  if (!url) {
    return (
      <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-700">
        <ImageIcon className="h-6 w-6 text-gray-400" />
      </div>
    );
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img
        src={url}
        alt={attachment.name}
        className="max-h-40 max-w-full rounded-lg border border-gray-200 object-cover dark:border-gray-700"
      />
    </a>
  );
}

function AttachmentLink({ attachment }: { attachment: ChatAttachment }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAttachmentUrl(attachment.path).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [attachment.path]);

  const inner = (
    <>
      <Paperclip className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{attachment.name}</span>
      <span className="shrink-0 text-gray-400">{formatSize(attachment.size)}</span>
    </>
  );

  if (!url) {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white/60 px-2 py-1 text-xs dark:bg-gray-900/40">
        {inner}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white/60 px-2 py-1 text-xs transition-colors hover:bg-white dark:bg-gray-900/40 dark:hover:bg-gray-900/70"
    >
      {inner}
    </a>
  );
}

export function MessageAttachments({
  attachments,
  compact,
}: MessageAttachmentsProps) {
  if (!attachments.length) return null;

  const images = attachments.filter((a) => isImageAttachment(a.mimeType));
  const files = attachments.filter((a) => !isImageAttachment(a.mimeType));

  return (
    <div className={cn("mt-2 space-y-2", compact && "mt-1.5")}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <AttachmentImage key={a.path} attachment={a} />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((a) => (
            <AttachmentLink key={a.path} attachment={a} />
          ))}
        </div>
      )}
    </div>
  );
}

type PendingFileChipProps = {
  file: File;
  onRemove: () => void;
};

export function PendingFileChip({ file, onRemove }: PendingFileChipProps) {
  const isImage = file.type.startsWith("image/");
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
      {isImage ? (
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
      )}
      <span className="max-w-[140px] truncate">{file.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700"
        aria-label={`Remove ${file.name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
