/** Slugs verified on Orthogonal — block hallucinated names like crunchbase/zoominfo. */
export const TRUSTED_API_SLUGS = new Set([
  "crustdata",
  "company-enrich",
  "contactout",
  "nyne",
  "aviato",
  "openfunnel",
  "apollo",
  "scrapegraphai",
  "context-dev",
  "scrapecreators",
  "openmart",
  "notte",
  "parallel",
  "perplexity",
]);

const BLOCKED_API_SLUGS = new Set([
  "crunchbase",
  "zoominfo",
  "clearbit",
  "linkedin",
  "salesforce-data",
]);

export function extractSlugsFromSearchJson(raw: string): Set<string> {
  const slugs = new Set<string>();
  try {
    const data = JSON.parse(raw) as { results?: Array<{ slug?: string }> };
    for (const r of data.results ?? []) {
      if (r.slug) slugs.add(r.slug.toLowerCase());
    }
  } catch {
    /* ignore */
  }
  return slugs;
}

export function isApiSlugAllowed(
  api: string,
  allowedFromSearch: Set<string>,
  searchCalls: number,
): boolean {
  const slug = api.toLowerCase().trim();
  if (!slug) return false;
  if (BLOCKED_API_SLUGS.has(slug)) return false;
  if (TRUSTED_API_SLUGS.has(slug)) return true;
  if (searchCalls === 0) return true;
  return allowedFromSearch.has(slug);
}

export function rejectUnknownApi(
  api: string,
  allowedFromSearch: Set<string>,
): string {
  const allowed = [
    ...TRUSTED_API_SLUGS,
    ...Array.from(allowedFromSearch),
  ].slice(0, 12);
  return JSON.stringify({
    error:
      `API slug "${api}" is not available on Orthogonal (often hallucinated). ` +
      `Use orthogonal_search results only. Trusted slugs include: ${allowed.join(", ")}.`,
  });
}

export function buildFailureSummary(
  toolSteps: Array<{ label: string; status: string }>,
): string {
  const failed = toolSteps.filter((s) => s.status === "error");
  if (failed.length === 0) return "";
  const lines = failed.slice(0, 6).map((s) => `- ${s.label}`);
  return (
    "I couldn't complete the request — **all API calls failed**. " +
    "I won't guess or invent data.\n\n" +
    lines.join("\n") +
    "\n\nTry tagging a specific API (e.g. `@company-enrich` `@crustdata`) or narrowing the question."
  );
}
