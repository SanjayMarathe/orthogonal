import { test } from "node:test";
import assert from "node:assert/strict";
import {
  companyNameForDomain,
  extractCompanyDomain,
  formatLeadershipFromJson,
} from "../../supabase/functions/_shared/leadership.ts";

test("extractCompanyDomain resolves notion", () => {
  if (extractCompanyDomain("Research Notion as a sales target") !== "notion.so") {
    throw new Error("expected notion.so");
  }
});

test("companyNameForDomain returns Notion", () => {
  if (companyNameForDomain("notion.so") !== "Notion") {
    throw new Error("expected Notion");
  }
});

test("formatLeadershipFromJson extracts decision makers", () => {
  const raw = JSON.stringify({
    data: [{
      company_name: "Notion",
      decision_makers: [
        { name: "Jane Doe", title: "Chief Revenue Officer" },
        { name: "John Smith", title: "VP Engineering" },
      ],
    }],
  });
  const formatted = formatLeadershipFromJson(raw, { domain: "notion.so" });
  if (!formatted?.includes("Jane Doe") || !formatted.includes("Chief Revenue Officer")) {
    throw new Error("expected formatted leadership");
  }
});
