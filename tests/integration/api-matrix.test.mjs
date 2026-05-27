/**
 * Integration tests: every catalog API — get_details + optional /run smoke.
 *
 * npm run test:api-matrix
 * TEST_API_SLUG=perplexity npm run test:api-matrix
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestEnv, requireEnv } from "../lib/env.mjs";
import { orthGet, orthPost } from "../lib/orthogonal-client.mjs";
import {
  API_TEST_MATRIX,
  diffMatrixVsCatalog,
  filterMatrix,
  isSoftRunFailure,
} from "../lib/api-test-matrix.mjs";

const env = loadTestEnv();
const slugFilter = process.env.TEST_API_SLUG?.toLowerCase();
const matrix = slugFilter ? filterMatrix({ slug: slugFilter }) : API_TEST_MATRIX;

if (slugFilter && matrix.length === 0) {
  throw new Error(`Unknown TEST_API_SLUG: ${slugFilter}`);
}

test("API matrix covers entire Orthogonal catalog", async () => {
  requireEnv(env, ["orthogonalApiKey"]);
  const res = await orthGet("/list-endpoints?limit=500", env.orthogonalApiKey);
  assert.equal(res.ok, true, `list-endpoints failed: ${JSON.stringify(res.data)}`);
  const slugs = (res.data.apis ?? []).map((a) => a.slug);
  const diff = diffMatrixVsCatalog(slugs);
  assert.deepEqual(
    diff.missingFromMatrix,
    [],
    `Add test cases for: ${diff.missingFromMatrix.join(", ")}`,
  );
  assert.equal(diff.matrixCount, diff.catalogCount);
});

for (const api of matrix) {
  test(`get_details: ${api.slug}`, async () => {
    requireEnv(env, ["orthogonalApiKey"]);
    const res = await orthPost(
      "/details",
      { api: api.slug, path: api.detailsPath },
      env.orthogonalApiKey,
    );
    assert.equal(
      res.ok,
      true,
      `${api.slug} ${api.detailsPath}: ${JSON.stringify(res.data).slice(0, 400)}`,
    );
  });

  if (api.run) {
    test(`run: ${api.slug} ${api.run.path}`, async () => {
      requireEnv(env, ["orthogonalApiKey"]);
      const payload = {
        api: api.slug,
        path: api.run.path,
      };
      if (api.run.body) payload.body = api.run.body;
      if (api.run.query) payload.query = api.run.query;

      const res = await orthPost("/run", payload, env.orthogonalApiKey);

      if (isSoftRunFailure(res.status, res.data)) {
        console.warn(
          `  [soft-fail] ${api.slug}: ${res.status} — ${JSON.stringify(res.data).slice(0, 200)}`,
        );
        return;
      }

      assert.equal(
        res.ok,
        true,
        `${api.slug} run failed (${res.status}): ${JSON.stringify(res.data).slice(0, 500)}`,
      );
    });
  } else {
    test(`run: ${api.slug} (skipped — ${api.runNote ?? "details only"})`, () => {
      assert.ok(true);
    });
  }
}
