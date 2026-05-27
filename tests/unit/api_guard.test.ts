import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFailureSummary,
  extractSlugsFromSearchJson,
  isApiSlugAllowed,
  rejectUnknownApi,
  TRUSTED_API_SLUGS,
} from "../../supabase/functions/_shared/apiGuard.ts";

const searchJson = JSON.stringify({
  results: [{ slug: "company-enrich" }, { slug: "crustdata" }],
});

test("extractSlugsFromSearchJson parses catalog slugs", () => {
  const slugs = extractSlugsFromSearchJson(searchJson);
  if (!slugs.has("company-enrich") || !slugs.has("crustdata")) {
    throw new Error(`expected slugs, got ${[...slugs].join(",")}`);
  }
});

test("isApiSlugAllowed blocks hallucinated crunchbase", () => {
  const allowed = new Set<string>();
  if (isApiSlugAllowed("crunchbase", allowed, 1)) {
    throw new Error("crunchbase should be blocked");
  }
});

test("isApiSlugAllowed allows trusted slugs after search", () => {
  const allowed = extractSlugsFromSearchJson(searchJson);
  if (!isApiSlugAllowed("company-enrich", allowed, 1)) {
    throw new Error("company-enrich should be allowed");
  }
  if (isApiSlugAllowed("fake-api", allowed, 1)) {
    throw new Error("fake-api should be rejected after search");
  }
});

test("isApiSlugAllowed allows any slug before first search", () => {
  if (!isApiSlugAllowed("some-new-api", new Set(), 0)) {
    throw new Error("pre-search slug should be allowed");
  }
});

test("rejectUnknownApi mentions trusted slugs", () => {
  const msg = rejectUnknownApi("zoominfo", new Set());
  if (!msg.includes("zoominfo") || !msg.includes("crustdata")) {
    throw new Error("rejectUnknownApi should list trusted slugs");
  }
});

test("buildFailureSummary empty when no errors", () => {
  if (buildFailureSummary([{ label: "ok", status: "done" }]) !== "") {
    throw new Error("expected empty summary");
  }
});

test("buildFailureSummary lists failed tools", () => {
  const summary = buildFailureSummary([
    { label: "Ran crustdata (failed)", status: "error" },
  ]);
  if (!summary.includes("all API calls failed") || !summary.includes("crustdata")) {
    throw new Error("expected failure summary with tool label");
  }
});

test("TRUSTED_API_SLUGS includes company-enrich", () => {
  if (!TRUSTED_API_SLUGS.has("company-enrich")) {
    throw new Error("missing company-enrich");
  }
});
