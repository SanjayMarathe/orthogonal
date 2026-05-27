/** Count decision_makers in a crustdata /screener/company response. */
export function countCrustdataDecisionMakers(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const root = data as Record<string, unknown>;
  const inner = root.data ?? root;
  const arr = Array.isArray(inner) ? inner : [inner];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (Array.isArray(rec.decision_makers)) return rec.decision_makers.length;
  }
  return 0;
}

/** Derive a display company name from a domain (notion.so → Notion). */
export function companyNameFromDomain(domain: string): string {
  const base = domain.split(".")[0] ?? domain;
  if (!base) return domain;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * crustdata domain-only lookups can match the wrong entity (e.g. notion.so → Notion Korea).
 * Retry with company_name when decision_makers is empty.
 */
export function crustdataRetryQuery(
  query: Record<string, unknown>,
): Record<string, unknown> | null {
  if (query.company_name) return null;
  const domain = query.company_domain;
  if (typeof domain !== "string" || !domain.includes(".")) return null;
  const retry: Record<string, unknown> = { ...query };
  delete retry.company_domain;
  retry.company_name = companyNameFromDomain(domain);
  return retry;
}
