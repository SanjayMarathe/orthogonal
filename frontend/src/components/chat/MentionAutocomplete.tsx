import ExtensionIcon from "@mui/icons-material/Extension";
import VerifiedIcon from "@mui/icons-material/Verified";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { formatHandle, type OrthogonalIntegration } from "@/lib/integrations";

type MentionAutocompleteProps = {
  open: boolean;
  query: string;
  options: OrthogonalIntegration[];
  selectedIndex: number;
  onSelect: (integration: OrthogonalIntegration) => void;
};

export function MentionAutocomplete({
  open,
  query,
  options,
  selectedIndex,
  onSelect,
}: MentionAutocompleteProps) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open || options.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
      <div className="border-b border-gray-100 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
        Integrations{query ? ` matching “${query}”` : ""}
      </div>
      <ul ref={listRef} className="max-h-52 overflow-y-auto py-1">
        {options.map((integration, index) => (
          <li key={integration.slug}>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(integration);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                index === selectedIndex
                  ? "bg-gray-100 dark:bg-gray-800"
                  : "hover:bg-gray-50 dark:hover:bg-gray-800/50",
              )}
            >
              <ExtensionIcon className="!text-[18px] shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-gray-900 dark:text-gray-100">
                    {integration.name}
                  </span>
                  {integration.verified && (
                    <VerifiedIcon className="!text-[14px] shrink-0 text-blue-500" />
                  )}
                </div>
                <span className="text-xs text-blue-600 dark:text-blue-400">
                  {formatHandle(integration.slug)}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
