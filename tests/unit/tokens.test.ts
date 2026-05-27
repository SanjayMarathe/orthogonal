import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateMessagesTokens,
  estimateTokens,
  formatTokenCount,
} from "../../supabase/functions/_shared/tokens.ts";

test("estimateTokens uses char/4 heuristic", () => {
  if (estimateTokens("12345678") !== 2) {
    throw new Error("expected 2 tokens for 8 chars");
  }
});

test("estimateMessagesTokens sums messages", () => {
  const total = estimateMessagesTokens([
    { content: "1234" },
    { content: "56789012", tool_calls: [{ id: "1" }] },
  ]);
  if (total < 3) throw new Error(`expected >=3 tokens, got ${total}`);
});

test("formatTokenCount abbreviates thousands", () => {
  if (formatTokenCount(1500) !== "2k") {
    throw new Error("expected 2k");
  }
});
