import type { ReactNode } from "react";

export function formatTokenCount(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function renderMarkdownLite(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("_") && part.endsWith("_")) {
      return (
        <em key={i} className="text-gray-500">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}
