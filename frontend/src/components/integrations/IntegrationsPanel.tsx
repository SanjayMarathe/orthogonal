import ExtensionIcon from "@mui/icons-material/Extension";
import SearchIcon from "@mui/icons-material/Search";
import VerifiedIcon from "@mui/icons-material/Verified";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatHandle } from "@/lib/integrations";
import { useIntegrations } from "@/hooks/useIntegrations";

type IntegrationsPanelProps = {
  onUseInChat: (handle: string) => void;
};

export function IntegrationsPanel({ onUseInChat }: IntegrationsPanelProps) {
  const { integrations, loading, error, refresh } = useIntegrations();
  const [query, setQuery] = useState("");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return integrations;
    return integrations.filter(
      (i) =>
        i.slug.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        i.endpoints.some(
          (e) =>
            e.path.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q),
        ),
    );
  }, [integrations, query]);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <ExtensionIcon className="!text-[28px] text-gray-700 dark:text-gray-300" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Integrations
        </h1>
      </div>

      <div className="relative mb-4">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 !text-[18px] -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search APIs by name, handle, or endpoint…"
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>

      {loading && (
        <p className="py-8 text-center text-sm text-gray-400">Loading APIs…</p>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
          <button
            type="button"
            onClick={() => refresh()}
            className="ml-2 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="flex-1 space-y-2 overflow-y-auto pb-4">
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">
              No integrations match your search.
            </p>
          )}
          {filtered.map((integration) => {
            const expanded = expandedSlug === integration.slug;
            return (
              <div
                key={integration.slug}
                className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedSlug(expanded ? null : integration.slug)
                  }
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <ExtensionIcon className="!text-[20px] shrink-0 text-gray-500 dark:text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-gray-900 dark:text-gray-100">
                        {integration.name}
                      </span>
                      {integration.verified && (
                        <VerifiedIcon className="!text-[16px] shrink-0 text-blue-500" />
                      )}
                    </div>
                    <code className="text-xs text-blue-600 dark:text-blue-400">
                      {formatHandle(integration.slug)}
                    </code>
                  </div>
                  <span className="shrink-0 text-xs text-gray-400">
                    {integration.endpoints.length} endpoint
                    {integration.endpoints.length !== 1 ? "s" : ""}
                  </span>
                </button>

                {expanded && (
                  <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-800">
                    <button
                      type="button"
                      onClick={() =>
                        onUseInChat(`${formatHandle(integration.slug)} `)
                      }
                      className="mb-3 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      Use {formatHandle(integration.slug)} in chat
                    </button>
                    <ul className="space-y-2">
                      {integration.endpoints.map((ep) => (
                        <li
                          key={ep.path}
                          className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-950"
                        >
                          <div className="flex items-center gap-2 text-xs">
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 font-mono font-semibold",
                                ep.method === "GET"
                                  ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                                  : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
                              )}
                            >
                              {ep.method}
                            </span>
                            <code className="text-gray-700 dark:text-gray-300">
                              {ep.path}
                            </code>
                            {ep.price && (
                              <span className="ml-auto text-gray-400">
                                {ep.price}
                              </span>
                            )}
                          </div>
                          {ep.description && (
                            <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                              {ep.description}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
