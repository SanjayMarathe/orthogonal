import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";

type PageHeaderProps = {
  title?: string;
  children?: ReactNode;
};

export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
      <h1 className="min-w-0 flex-1 truncate text-base font-medium text-gray-900 dark:text-gray-100">
        {title}
      </h1>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        <ThemeToggle />
      </div>
    </header>
  );
}
