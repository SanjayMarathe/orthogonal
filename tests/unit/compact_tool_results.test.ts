import { test } from "node:test";
import assert from "node:assert/strict";
import { compactToolPayloadForSummary } from "../../supabase/functions/_shared/compactToolResults.ts";

test("compactToolPayloadForSummary compacts workforce", () => {
  const raw = JSON.stringify({
    success: true,
    data: {
      domain: "notion.so",
      observed_employee_count: 1784,
      department_headcount: { engineering_technical: 363, sales: 301 },
      history: [{ huge: "payload".repeat(1000) }],
    },
  });
  const compact = compactToolPayloadForSummary(raw);
  const parsed = JSON.parse(compact);
  if (!parsed.data.observed_employee_count) {
    throw new Error("missing employee count");
  }
  if (parsed.data.history) {
    throw new Error("history should be stripped");
  }
});

test("compactToolPayloadForSummary trims crustdata decision_makers", () => {
  const makers = Array.from({ length: 50 }, (_, i) => ({
    name: `Person ${i}`,
    title: "VP Sales",
  }));
  const raw = JSON.stringify({
    data: [{ company_name: "Notion", decision_makers: makers }],
  });
  const compact = JSON.parse(compactToolPayloadForSummary(raw));
  const dms = compact.data[0].decision_makers;
  if (dms.length > 30) {
    throw new Error(`expected <=30 decision_makers, got ${dms.length}`);
  }
  if (compact.data[0].decision_makers_total !== 50) {
    throw new Error("expected total count preserved");
  }
});

test("compactToolPayloadForSummary truncates invalid json", () => {
  const raw = "x".repeat(8000);
  const out = compactToolPayloadForSummary(raw);
  if (!out.includes("[truncated]")) {
    throw new Error("expected truncation marker");
  }
});
