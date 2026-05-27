import { test } from "node:test";
import assert from "node:assert/strict";
import {
  API_TEST_MATRIX,
  diffMatrixVsCatalog,
  matrixBySlug,
} from "../lib/api-test-matrix.mjs";

test("API test matrix has unique slugs", () => {
  const slugs = API_TEST_MATRIX.map((a) => a.slug);
  assert.equal(slugs.length, new Set(slugs).size);
});

test("every API has capability prompt with @slug", () => {
  for (const api of API_TEST_MATRIX) {
    assert.match(
      api.capabilityPrompt,
      new RegExp(`@${api.slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
      api.slug,
    );
    assert.ok(api.detailsPath, `${api.slug} missing detailsPath`);
    assert.ok(api.chatPrompt, `${api.slug} missing chatPrompt`);
    assert.ok(api.chatMustMatch, `${api.slug} missing chatMustMatch`);
  }
});

test("matrixBySlug lookup", () => {
  assert.equal(matrixBySlug("perplexity")?.slug, "perplexity");
  assert.equal(matrixBySlug("missing"), undefined);
});

test("diffMatrixVsCatalog detects gaps", () => {
  const diff = diffMatrixVsCatalog(["perplexity", "new-api"]);
  assert.ok(diff.missingFromMatrix.includes("new-api"));
  assert.ok(diff.extraInMatrix.length > 0);
});

test("matrix includes all trusted production slugs", () => {
  const trusted = [
    "perplexity",
    "parallel",
    "company-enrich",
    "crustdata",
    "apollo",
    "openfunnel",
    "scrapegraphai",
  ];
  const slugs = new Set(API_TEST_MATRIX.map((a) => a.slug));
  for (const t of trusted) {
    assert.ok(slugs.has(t), `missing trusted slug ${t}`);
  }
});
