import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractTaggedSlugs,
  filterIntegrations,
  formatHandle,
} from "../../frontend/src/lib/integrations.ts";

test("formatHandle prefixes @", () => {
  assert.equal(formatHandle("crustdata"), "@crustdata");
});

test("extractTaggedSlugs dedupes case-insensitively", () => {
  const slugs = extractTaggedSlugs("Try @CrustData and @crustdata");
  assert.deepEqual(slugs, ["crustdata"]);
});

test("filterIntegrations matches slug and name", () => {
  const list = [
    { slug: "crustdata", name: "Crustdata", endpoints: [] },
    { slug: "apollo", name: "Apollo", endpoints: [] },
  ];
  const out = filterIntegrations(list, "crust");
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, "crustdata");
});
