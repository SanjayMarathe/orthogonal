import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { shortModelName } from "@/lib/models";
import { useModels } from "@/hooks/useModels";
import { cn } from "@/lib/utils";

type ModelSelectorProps = {
  disabled?: boolean;
};

export function ModelSelector({ disabled }: ModelSelectorProps) {
  const {
    models,
    modelsLoading,
    selectedModelId,
    setSelectedModelId,
    selectedModel,
  } = useModels();

  const label = modelsLoading
    ? "Loading…"
    : shortModelName(selectedModel?.name ?? selectedModelId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || modelsLoading || models.length === 0}
        className={cn(
          "flex h-8 max-w-[160px] items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700",
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-64 overflow-y-auto dark:border-gray-700 dark:bg-gray-900"
      >
        {models.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onClick={() => setSelectedModelId(model.id)}
            className={cn(
              "flex flex-col items-start gap-0.5 dark:text-gray-100 dark:focus:bg-gray-800",
              model.id === selectedModelId && "bg-gray-50 dark:bg-gray-800",
            )}
          >
            <span className="font-medium">{model.name}</span>
            {model.description && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {model.description.slice(0, 80)}
                {model.description.length > 80 ? "…" : ""}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
