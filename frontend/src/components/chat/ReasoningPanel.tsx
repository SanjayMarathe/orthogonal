import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type ReasoningPanelProps = {
  content: string;
  isStreaming?: boolean;
};

export function ReasoningPanel({ content, isStreaming }: ReasoningPanelProps) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (isStreaming) setOpen(true);
  }, [isStreaming]);

  if (!content.trim() && !isStreaming) return null;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <span>Reasoning</span>
        {isStreaming && (
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />
        )}
      </button>
      {open && (
        <div className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/40">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {content}
          </p>
        </div>
      )}
    </div>
  );
}
