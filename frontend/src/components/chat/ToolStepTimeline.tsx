import type { ToolStep } from "@/lib/supabase";
import { ToolStepPill } from "./ToolStepPill";

type ToolStepTimelineProps = {
  steps: ToolStep[];
};

export function ToolStepTimeline({ steps }: ToolStepTimelineProps) {
  if (steps.length === 0) return null;

  return (
    <div className="my-3 flex">
      <div className="mr-3 w-px shrink-0 bg-gray-200 dark:bg-gray-700" />
      <div className="min-w-0 flex-1">
        {steps.map((step) => (
          <ToolStepPill key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}
