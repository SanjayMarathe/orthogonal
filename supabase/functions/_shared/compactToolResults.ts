/** Shrink large API payloads before the synthesis LLM call. */
export function compactToolPayloadForSummary(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.length > 6000 ? raw.slice(0, 6000) + "…[truncated]" : raw;
  }

  if (!parsed || typeof parsed !== "object") return raw;

  const root = parsed as Record<string, unknown>;
  const data = root.data ?? parsed;
  const compact = compactData(data);
  if (!compact) return raw.length > 6000 ? raw.slice(0, 6000) + "…[truncated]" : raw;

  return JSON.stringify({ success: root.success ?? true, data: compact });
}

function compactData(data: unknown): unknown {
  if (Array.isArray(data)) {
    if (data.length === 0) return data;
    const first = data[0];
    if (first && typeof first === "object" && "decision_makers" in first) {
      return data.map((item) => compactCrustdataRecord(item));
    }
    if (data.length > 3) {
      return data.slice(0, 3).map((item) => compactGenericRecord(item));
    }
    return data.map((item) => compactGenericRecord(item));
  }

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (obj.department_headcount || obj.observed_employee_count) {
      return compactWorkforce(obj);
    }
    if (obj.items && Array.isArray(obj.items)) {
      return {
        items: (obj.items as unknown[]).slice(0, 3).map((item) =>
          compactGenericRecord(item)
        ),
      };
    }
    if ("decision_makers" in obj) return compactCrustdataRecord(obj);
    return compactGenericRecord(obj);
  }

  return data;
}

function compactWorkforce(obj: Record<string, unknown>): Record<string, unknown> {
  return {
    domain: obj.domain,
    observed_employee_count: obj.observed_employee_count,
    employee_count_range: obj.employee_count_range,
    department_headcount: obj.department_headcount,
  };
}

function compactCrustdataRecord(item: unknown): Record<string, unknown> {
  if (!item || typeof item !== "object") return {};
  const rec = item as Record<string, unknown>;
  const makers = Array.isArray(rec.decision_makers) ? rec.decision_makers : [];
  const trimmed = makers.slice(0, 30).map((dm) => {
    if (!dm || typeof dm !== "object") return dm;
    const d = dm as Record<string, unknown>;
    return {
      name: d.name ?? d.full_name ?? d.person_name,
      title: d.title ?? d.job_title ?? d.position,
      email: d.email,
      linkedin_profile_url: d.linkedin_profile_url ?? d.linkedin_url,
    };
  });
  return {
    company_name: rec.company_name,
    company_domain: rec.company_domain,
    headcount: rec.headcount,
    funding_and_investment: rec.funding_and_investment,
    decision_makers: trimmed,
    decision_makers_total: makers.length,
  };
}

function compactGenericRecord(item: unknown): Record<string, unknown> {
  if (!item || typeof item !== "object") return {};
  const rec = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const keys = [
    "name",
    "domain",
    "website",
    "industry",
    "industries",
    "employees",
    "employee_count_range",
    "observed_employee_count",
    "description",
    "founded_year",
    "location",
    "financial",
    "revenue",
    "type",
    "categories",
  ];
  for (const k of keys) {
    if (rec[k] !== undefined) out[k] = rec[k];
  }
  return out;
}
