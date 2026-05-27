type ThinkingIndicatorProps = {
  label?: string;
};

export function ThinkingIndicator({ label }: ThinkingIndicatorProps) {
  return (
    <div className="mb-3 flex items-center gap-0.5 text-sm text-gray-400 dark:text-gray-500">
      <span>{label ?? "thinking"}</span>
      <span className="inline-flex">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="thinking-dot inline-block"
            style={{ animationDelay: `${i * 0.15}s` }}
          >
            .
          </span>
        ))}
      </span>
    </div>
  );
}
