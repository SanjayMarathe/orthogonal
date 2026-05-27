import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestEnv, requireEnv } from "../lib/env.mjs";
import { orthGet, orthPost } from "../lib/orthogonal-client.mjs";

test("Orthogonal API: list-endpoints returns catalog", async () => {
  const env = loadTestEnv();
  requireEnv(env, ["orthogonalApiKey"]);

  const res = await orthGet("/list-endpoints?limit=50", env.orthogonalApiKey);
  assert.equal(res.ok, true, `list-endpoints failed: ${JSON.stringify(res.data)}`);
  const apis = res.data.apis ?? res.data.data?.apis;
  assert.ok(Array.isArray(apis) && apis.length > 0, "expected apis array");
  assert.ok(apis[0].slug, "expected slug on first api");
});

test("Orthogonal API: search finds company-enrich", async () => {
  const env = loadTestEnv();
  requireEnv(env, ["orthogonalApiKey"]);

  const res = await orthPost(
    "/search",
    { prompt: "company enrichment workforce", limit: 10 },
    env.orthogonalApiKey,
  );
  assert.equal(res.ok, true, `search failed: ${JSON.stringify(res.data)}`);
  const results = res.data.results ?? res.data.data?.results ?? [];
  const slugs = results.map((r) => r.slug);
  assert.ok(
    slugs.some((s) => /company-enrich|crustdata|apollo/.test(s)),
    `expected enrichment API in: ${slugs.join(", ")}`,
  );
});

test("Orthogonal API: get_details for company-enrich enrich", async () => {
  const env = loadTestEnv();
  requireEnv(env, ["orthogonalApiKey"]);

  const res = await orthPost(
    "/details",
    { api: "company-enrich", path: "/companies/enrich" },
    env.orthogonalApiKey,
  );
  assert.equal(res.ok, true, `details failed: ${JSON.stringify(res.data)}`);
});
