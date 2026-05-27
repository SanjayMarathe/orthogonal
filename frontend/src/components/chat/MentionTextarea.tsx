import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const MENTION_PATTERN = /(@[a-zA-Z0-9_-]+)/g;

function renderHighlightedText(text: string): ReactNode {
  const parts = text.split(MENTION_PATTERN);
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      return (
        <span
          key={i}
          className="rounded bg-blue-100 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

type MentionTextareaProps = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCursorSync: () => void;
  placeholder?: string;
  disabled?: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
};

export function MentionTextarea({
  value,
  onChange,
  onKeyDown,
  onCursorSync,
  placeholder,
  disabled,
  textareaRef,
}: MentionTextareaProps) {
  const mirrorRef = useRef<HTMLDivElement>(null);

  const syncScroll = () => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (ta && mirror) {
      mirror.scrollTop = ta.scrollTop;
    }
  };

  useEffect(() => {
    syncScroll();
  }, [value]);

  return (
    <div className="relative max-h-[160px] min-h-[24px] overflow-hidden">
      <div
        ref={mirrorRef}
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-[15px] leading-relaxed text-gray-900 dark:text-gray-100",
          !value && "invisible",
        )}
      >
        {value ? renderHighlightedText(value) : null}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(onCursorSync);
        }}
        onKeyDown={onKeyDown}
        onClick={() => {
          onCursorSync();
          syncScroll();
        }}
        onKeyUp={() => {
          onCursorSync();
          syncScroll();
        }}
        onSelect={() => {
          onCursorSync();
          syncScroll();
        }}
        onScroll={syncScroll}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className={cn(
          "relative w-full resize-none bg-transparent text-[15px] leading-relaxed text-transparent caret-gray-900 placeholder:text-gray-400 focus:outline-none dark:caret-gray-100 dark:placeholder:text-gray-500",
          disabled && "opacity-50",
        )}
        onInput={(e) => {
          const target = e.target as HTMLTextAreaElement;
          target.style.height = "auto";
          target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
        }}
      />
    </div>
  );
}
