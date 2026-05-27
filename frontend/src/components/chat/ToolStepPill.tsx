import {
  ChevronRight,
  LayoutGrid,
  Loader2,
  Search,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ToolStep } from "@/lib/supabase";

function ToolIcon({ tool }: { tool: string }) {
  const className = "h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400";
  switch (tool) {
    case "orthogonal_search":
      return <Search className={className} />;
    case "orthogonal_get_details":
      return <LayoutGrid className={className} />;
    case "orthogonal_use":
      return <Zap className={className} />;
    default:
      return <Zap className={className} />;
  }
}

type ToolStepPillProps = {
  step: ToolStep;
};

export function ToolStepPill({ step }: ToolStepPillProps) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = step.status === "running";
  const isError = step.status === "error";

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border bg-white px-3 py-2 text-left text-sm transition-colors dark:bg-gray-900",
          isError ? "border-red-200 dark:border-red-900" : "border-gray-200 dark:border-gray-700",
          isRunning && "animate-pulse-border",
        )}
      >
        <ToolIcon tool={step.tool} />
        <span className="flex-1 text-gray-700 dark:text-gray-300">{step.label}</span>
        {isRunning ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />
        ) : (
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-gray-400 transition-transform",
              expanded && "rotate-90",
            )}
          />
        )}
      </button>
      {expanded && !isRunning && (
        <div className="ml-6 mt-1 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-400">
          {step.args && Object.keys(step.args).length > 0 && (
            <div>
              <p className="mb-1 font-medium text-gray-700">Input</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(step.args, null, 2)}
              </pre>
            </div>
          )}
          {step.resultPreview && (
            <div>
              <p className="mb-1 font-medium text-gray-700">Output</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">
                {step.resultPreview}
              </pre>
            </div>
          )}
          {step.meta && (
            <div className="flex flex-wrap gap-3 text-gray-500">
              {step.meta.requestId && (
                <span>ID: {step.meta.requestId}</span>
              )}
              {step.meta.priceCents != null && (
                <span>Cost: ${(step.meta.priceCents / 100).toFixed(4)}</span>
              )}
              {step.meta.durationMs != null && (
                <span>{step.meta.durationMs}ms</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
