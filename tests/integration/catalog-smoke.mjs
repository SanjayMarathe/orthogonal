import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadTestEnv, requireEnv } from "../lib/env.mjs";
import { orthGet, orthPost } from "../lib/orthogonal-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const env = loadTestEnv();
  requireEnv(env, ["orthogonalApiKey"]);

  console.log("Fetching Orthogonal catalog…");
  const catalog = await orthGet("/list-endpoints?limit=500", env.orthogonalApiKey);
  if (!catalog.ok || !catalog.data.apis) {
    console.error("Failed to list endpoints", catalog);
    process.exit(1);
  }

  const apis = catalog.data.apis;
  console.log(`Testing get_details for ${apis.length} APIs…\n`);

  const results = { pass: [], fail: [] };

  for (const api of apis) {
    const ep = api.endpoints?.[0];
    if (!ep?.path) {
      results.fail.push({ slug: api.slug, reason: "no endpoints" });
      continue;
    }

    const res = await orthPost(
      "/details",
      { api: api.slug, path: ep.path },
      env.orthogonalApiKey,
    );
    const ok = res.ok && res.data.success !== false;
    const entry = {
      slug: api.slug,
      path: ep.path,
      status: res.status,
      error: res.data.error ?? res.data.message,
    };

    if (ok) {
      results.pass.push(entry);
      process.stdout.write(".");
    } else {
      results.fail.push(entry);
      process.stdout.write("F");
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  console.log("\n\n=== Catalog smoke summary ===");
  console.log(`PASS: ${results.pass.length}/${apis.length}`);
  console.log(`FAIL: ${results.fail.length}/${apis.length}`);

  if (results.fail.length) {
    console.log("\nFailures:");
    for (const f of results.fail.slice(0, 15)) {
      console.log(`  - ${f.slug}${f.path ?? ""}: ${f.reason ?? f.error ?? f.status}`);
    }
    if (results.fail.length > 15) {
      console.log(`  … and ${results.fail.length - 15} more`);
    }
  }

  process.exit(results.fail.length ? 1 : 0);
}

main();
