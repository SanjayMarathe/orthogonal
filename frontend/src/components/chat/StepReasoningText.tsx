import { cn } from "@/lib/utils";

type StepReasoningTextProps = {
  content: string;
  className?: string;
};

export function StepReasoningText({ content, className }: StepReasoningTextProps) {
  if (!content.trim()) return null;

  return (
    <p
      className={cn(
        "whitespace-pre-wrap text-xs leading-relaxed text-gray-500 dark:text-gray-400",
        className,
      )}
    >
      {content.trim()}
    </p>
  );
}
