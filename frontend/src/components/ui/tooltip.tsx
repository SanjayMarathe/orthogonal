import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export function TooltipProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  children,
  content,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className={cn(
            "z-50 max-w-xs rounded-md bg-gray-900 px-3 py-2 text-xs leading-relaxed text-white shadow-md dark:bg-gray-800",
          )}
          sideOffset={4}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-gray-900 dark:fill-gray-800" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
