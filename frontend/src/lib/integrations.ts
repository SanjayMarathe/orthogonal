export type OrthogonalEndpoint = {
  path: string;
  method: string;
  description: string;
  price?: string;
};

export type OrthogonalIntegration = {
  slug: string;
  name: string;
  verified?: boolean;
  endpoints: OrthogonalEndpoint[];
};

export function formatHandle(slug: string): string {
  return `@${slug}`;
}

export function extractTaggedSlugs(text: string): string[] {
  const matches = text.matchAll(/@([a-zA-Z0-9_-]+)/g);
  const slugs = new Set<string>();
  for (const match of matches) {
    slugs.add(match[1].toLowerCase());
  }
  return [...slugs];
}

export function filterIntegrations(
  integrations: OrthogonalIntegration[],
  query: string,
): OrthogonalIntegration[] {
  const q = query.toLowerCase();
  if (!q) return integrations;
  return integrations.filter(
    (i) =>
      i.slug.toLowerCase().includes(q) ||
      i.name.toLowerCase().includes(q),
  );
}
