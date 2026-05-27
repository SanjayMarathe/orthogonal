import { orthogonalListEndpoints, orthogonalSearch } from "./orthogonal.ts";

export type CatalogIntegration = {
  slug: string;
  name: string;
  description?: string;
  verified?: boolean;
  endpoints: Array<{
    path: string;
    method: string;
    description: string;
    price?: string;
  }>;
};

export type CatalogResult = {
  integrations: CatalogIntegration[];
  count: number;
  totalEndpoints: number;
};

type ListApiItem = {
  name?: string;
  slug?: string;
  description?: string;
  verified?: boolean;
  endpoints?: Array<{
    path?: string;
    method?: string;
    description?: string;
    price?: string;
  }>;
};

export function extractTaggedSlugs(text: string): string[] {
  const matches = text.matchAll(/@([a-zA-Z0-9_-]+)/g);
  const slugs = new Set<string>();
  for (const match of matches) {
    slugs.add(match[1].toLowerCase());
  }
  return [...slugs];
}

export function isCapabilityQuestion(text: string): boolean {
  const t = text.toLowerCase().replace(/@\w+/g, "").trim();
  return (
    t.length < 120 &&
    /\b(what can you do|what do you do|what are you|your capabilities|what is this|how can you help|what does .+ do|help me with)\b/i.test(
      text,
    )
  );
}

export async function fetchIntegrationBySlug(
  slug: string,
): Promise<CatalogIntegration | null> {
  const res = await orthogonalSearch(slug, 5);
  if (!res.ok) return null;
  const data = res.data as { results?: ListApiItem[] };
  const match =
    data.results?.find((r) => r.slug?.toLowerCase() === slug.toLowerCase()) ??
    data.results?.[0];
  return match ? mapApiItem(match) : null;
}

export function formatIntegrationCapabilities(
  integration: CatalogIntegration,
): string {
  const lines = integration.endpoints.map(
    (e) =>
      `- **${e.method} \`${e.path}\`** — ${e.description || "No description"}${
        e.price ? ` (${e.price})` : ""
      }`,
  );
  const desc = integration.description
    ? `${integration.description}\n\n`
    : "";
  return (
    `## ${integration.name} (\`@${integration.slug}\`)\n\n` +
    desc +
    `**${integration.endpoints.length} endpoints** available via Orthogonal:\n\n` +
    lines.join("\n") +
    `\n\nTag \`@${integration.slug}\` and describe what you want — e.g. "get people filters" or "create an account audience".`
  );
}

function mapApiItem(item: ListApiItem): CatalogIntegration | null {
  if (!item.slug) return null;
  return {
    slug: item.slug,
    name: item.name ?? item.slug,
    description: item.description,
    verified: item.verified,
    endpoints: (item.endpoints ?? [])
      .filter((e) => e.path && e.method)
      .map((e) => ({
        path: e.path!,
        method: e.method!,
        description: e.description ?? "",
        price: e.price,
      })),
  };
}

/** Full catalog via GET /v1/list-endpoints (paginated). See docs.orthogonal.com/api-reference/list-endpoints */
export async function fetchOrthogonalCatalog(): Promise<CatalogResult> {
  const integrations: CatalogIntegration[] = [];
  let offset = 0;
  const limit = 100;
  let totalEndpoints = 0;

  while (true) {
    const res = await orthogonalListEndpoints(limit, offset);
    if (!res.ok) {
      throw new Error(
        (res as { error?: string }).error ?? "Failed to list Orthogonal APIs",
      );
    }

    const data = res.data as {
      apis?: ListApiItem[];
      totalEndpoints?: number;
      pagination?: { hasMore?: boolean };
    };

    if (typeof data.totalEndpoints === "number") {
      totalEndpoints = data.totalEndpoints;
    }

    for (const item of data.apis ?? []) {
      const mapped = mapApiItem(item);
      if (mapped) integrations.push(mapped);
    }

    if (!data.pagination?.hasMore) break;
    offset += limit;
  }

  integrations.sort((a, b) => a.name.localeCompare(b.name));

  return {
    integrations,
    count: integrations.length,
    totalEndpoints:
      totalEndpoints ||
      integrations.reduce((n, i) => n + i.endpoints.length, 0),
  };
}
