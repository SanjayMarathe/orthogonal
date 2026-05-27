import { test } from "node:test";
import assert from "node:assert/strict";
import {
  companyNameFromDomain,
  countCrustdataDecisionMakers,
  crustdataRetryQuery,
} from "../../supabase/functions/_shared/crustdataHelpers.ts";

test("companyNameFromDomain capitalizes base", () => {
  if (companyNameFromDomain("notion.so") !== "Notion") {
    throw new Error("expected Notion");
  }
});

test("countCrustdataDecisionMakers reads nested array", () => {
  const count = countCrustdataDecisionMakers({
    data: [{ company_name: "Notion", decision_makers: [{ name: "A" }, { name: "B" }] }],
  });
  if (count !== 2) throw new Error(`expected 2, got ${count}`);
});

test("countCrustdataDecisionMakers returns 0 for empty", () => {
  if (countCrustdataDecisionMakers({ data: [{ company_name: "X" }] }) !== 0) {
    throw new Error("expected 0");
  }
});

test("crustdataRetryQuery swaps domain for company_name", () => {
  const retry = crustdataRetryQuery({
    company_domain: "notion.so",
    fields: "decision_makers",
  });
  if (!retry || retry.company_name !== "Notion" || retry.company_domain) {
    throw new Error(`unexpected retry query: ${JSON.stringify(retry)}`);
  }
});

test("crustdataRetryQuery null when company_name set", () => {
  if (crustdataRetryQuery({ company_name: "Notion" }) !== null) {
    throw new Error("expected null");
  }
});
