import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeQueryParams,
  truncatePreview,
  truncateToolContentForModel,
} from "../../supabase/functions/_shared/orthogonal.ts";

test("normalizeQueryParams stringifies numbers", () => {
  const out = normalizeQueryParams({ limit: 5, domain: "notion.so" });
  if (out?.limit !== "5" || out?.domain !== "notion.so") {
    throw new Error(`unexpected params: ${JSON.stringify(out)}`);
  }
});

test("truncatePreview adds ellipsis", () => {
  const out = truncatePreview("a".repeat(1000), 100);
  if (!out.endsWith("…") || out.length > 110) {
    throw new Error("expected truncated preview");
  }
});

test("truncateToolContentForModel caps large payloads", () => {
  const out = truncateToolContentForModel("b".repeat(20_000), 1000);
  if (!out.includes("[truncated")) {
    throw new Error("expected model truncation");
  }
});
