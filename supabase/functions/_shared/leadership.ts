import { KNOWN_COMPANY_DOMAINS } from "./companyDomains.ts";
import type { ChatMessage } from "./types.ts";

export function isLeadershipQuery(text: string): boolean {
  return /\b(c-?suite|executives?|leadership|decision[\s-]?makers?|ceo|cfo|cto|coo|cmo|chief\s+\w+\s+officer)\b/i.test(
    text,
  );
}

export function extractCompanyDomain(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [name, domain] of Object.entries(KNOWN_COMPANY_DOMAINS)) {
    if (lower.includes(name)) return domain;
  }
  const domainMatch = text.match(
    /\b([a-z0-9][a-z0-9-]*\.(?:com|io|co|org|ai|net))\b/i,
  );
  if (domainMatch) return domainMatch[1].toLowerCase();
  const ofMatch = text.match(
    /\b(?:of|at|for)\s+([A-Z][A-Za-z0-9&.\s-]{1,40}?)(?:\?|\.|,|$)/,
  );
  if (ofMatch) {
    const guess = ofMatch[1].trim().toLowerCase().split(/\s+/)[0];
    if (KNOWN_COMPANY_DOMAINS[guess]) return KNOWN_COMPANY_DOMAINS[guess];
  }
  return null;
}

export function companyNameForDomain(domain: string): string | null {
  for (const [name, d] of Object.entries(KNOWN_COMPANY_DOMAINS)) {
    if (d === domain) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  const base = domain.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function isCsuiteTitle(title: string): boolean {
  const t = title.toLowerCase();
  if (
    /\b(chapter|latinos@|erg|employee resource|@amazon|co-?founder|site founder|volunteer)\b/i.test(
      title,
    )
  ) {
    return false;
  }
  return /\b(ceo|cfo|cto|coo|cmo|cio|cpo|cro|chief [\w]+ officer|chief executive|chief financial|chief technology|chief operating|chief marketing|senior vice president|\bsvp\b|\bevp\b|executive vice president|vice president|president[, ]|general counsel|distinguished engineer)\b/i.test(
    t,
  );
}

function pickBestCompanyRecord(
  data: unknown[],
  domain: string,
  hintName?: string | null,
): Record<string, unknown> | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  if (data.length === 1 && data[0] && typeof data[0] === "object") {
    return data[0] as Record<string, unknown>;
  }

  const domainBase = domain.split(".")[0].toLowerCase();
  let best: Record<string, unknown> | null = null;
  let bestScore = -1;

  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = String(rec.company_name ?? "").toLowerCase();
    let score = 0;
    if (name.includes(domainBase)) score += 15;
    if (hintName && name.includes(hintName.toLowerCase())) score += 25;
    if (hintName && name === hintName.toLowerCase()) score += 50;
    const linkedinId = String(rec.linkedin_id ?? "");
    if (domain === "amazon.com" && linkedinId === "1586") score += 100;
    const dmCount = Array.isArray(rec.decision_makers)
      ? rec.decision_makers.length
      : 0;
    score += Math.min(dmCount, 10);
    if (score > bestScore) {
      bestScore = score;
      best = rec;
    }
  }
  return best;
}

function collectDecisionMakers(
  value: unknown,
  out: Record<string, unknown>[],
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectDecisionMakers(item, out);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.decision_makers)) {
    for (const dm of obj.decision_makers) {
      if (dm && typeof dm === "object") out.push(dm as Record<string, unknown>);
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") collectDecisionMakers(v, out);
  }
}

export function formatLeadershipFromJson(
  raw: string,
  options?: { domain?: string; csuiteOnly?: boolean },
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  let companyRecord: Record<string, unknown> | null = null;
  if (parsed && typeof parsed === "object") {
    const data = (parsed as Record<string, unknown>).data;
    if (Array.isArray(data)) {
      const hint = options?.domain
        ? companyNameForDomain(options.domain)
        : null;
      companyRecord = pickBestCompanyRecord(data, options?.domain ?? "", hint);
    }
  }

  const makers: Record<string, unknown>[] = [];
  if (companyRecord) {
    if (Array.isArray(companyRecord.decision_makers)) {
      for (const dm of companyRecord.decision_makers) {
        if (dm && typeof dm === "object") makers.push(dm as Record<string, unknown>);
      }
    }
  } else {
    collectDecisionMakers(parsed, makers);
  }

  if (makers.length === 0) return null;

  const companyName = companyRecord
    ? String(companyRecord.company_name ?? "")
    : "";

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const dm of makers) {
    const name =
      (dm.name as string) ??
      (dm.full_name as string) ??
      (dm.person_name as string);
    const title =
      (dm.title as string) ??
      (dm.job_title as string) ??
      (dm.position as string) ??
      "";
    if (options?.csuiteOnly && title && !isCsuiteTitle(title)) continue;
    const email = dm.email as string | undefined;
    const phone =
      (dm.phone as string) ??
      (dm.phone_number as string) ??
      (dm.mobile as string);
    const linkedin =
      (dm.linkedin_profile_url as string) ?? (dm.linkedin_url as string);
    const key = `${name ?? ""}|${title ?? ""}|${email ?? ""}`;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const parts = [`**${name}**`];
    if (title) parts.push(`— ${title}`);
    const contact: string[] = [];
    if (email) contact.push(email);
    if (phone) contact.push(phone);
    if (linkedin) contact.push(linkedin);
    if (contact.length) parts.push(`(${contact.join(" · ")})`);
    lines.push(`- ${parts.join(" ")}`);
    if (lines.length >= 20) break;
  }

  if (lines.length === 0) return null;

  const heading = companyName
    ? `## ${companyName} — leadership (Crustdata)\n\n`
    : "## Company leadership (Crustdata)\n\n";

  return heading + lines.join("\n");
}

export function formatLeadershipFallback(messages: ChatMessage[]): string | null {
  const toolContents = messages
    .filter((m) => m.role === "tool" && m.content)
    .map((m) => m.content as string)
    .reverse();
  for (const raw of toolContents) {
    const formatted = formatLeadershipFromJson(raw);
    if (formatted) return formatted;
  }
  return null;
}
