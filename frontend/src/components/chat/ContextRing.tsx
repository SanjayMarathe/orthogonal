import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ContextRingProps = {
  tokens: number;
  limit: number;
  size?: number;
  className?: string;
};

export function ContextRing({
  tokens,
  limit,
  size = 32,
  className,
}: ContextRingProps) {
  const ratio = limit > 0 ? Math.min(tokens / limit, 1) : 0;
  const percent = Math.round(ratio * 100);
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - ratio);

  const color =
    ratio >= 0.85 ? "#ef4444" : ratio >= 0.6 ? "#f59e0b" : "#22c55e";

  const tooltip = (
    <div className="space-y-0.5">
      <p className="font-medium">{percent}% of context used</p>
      <p className="text-gray-300">
        {tokens.toLocaleString()} / {limit.toLocaleString()} tokens
      </p>
      <p className="text-gray-400">Run /compress to summarize</p>
    </div>
  );

  return (
    <Tooltip content={tooltip}>
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center",
          className,
        )}
        style={{ width: size, height: size }}
        aria-label={`${percent}% of context used`}
      >
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className="stroke-gray-200 dark:stroke-gray-700"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <span className="absolute text-[8px] font-semibold tabular-nums text-gray-600 dark:text-gray-400">
          {percent}%
        </span>
      </div>
    </Tooltip>
  );
}
