import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractTaggedSlugs,
  isCapabilityQuestion,
} from "../../supabase/functions/_shared/integrations.ts";

test("extractTaggedSlugs finds multiple handles", () => {
  const slugs = extractTaggedSlugs(
    "Use @crustdata and @company-enrich for @CrustData again",
  );
  if (slugs.length !== 2 || !slugs.includes("crustdata") || !slugs.includes("company-enrich")) {
    throw new Error(`unexpected slugs: ${slugs.join(",")}`);
  }
});

test("isCapabilityQuestion matches what can you do", () => {
  if (!isCapabilityQuestion("@openfunnel what can you do?")) {
    throw new Error("expected capability question");
  }
});

test("isCapabilityQuestion rejects research prompts", () => {
  if (
    isCapabilityQuestion(
      "Research Notion as a sales target with headcount and funding",
    )
  ) {
    throw new Error("research prompt should not be capability question");
  }
});
