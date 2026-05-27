import { test } from "node:test";
import assert from "node:assert/strict";
import { formatToolResultsFallback } from "../../supabase/functions/_shared/synthesize.ts";

test("formatToolResultsFallback builds markdown from workforce tool payload", () => {
  const messages = [
    { role: "user", content: "Is Shopify a good ICP?" },
    {
      role: "tool",
      tool_call_id: "1",
      content: JSON.stringify({
        success: true,
        data: {
          domain: "shopify.com",
          observed_employee_count: 8100,
          department_headcount: { engineering_technical: 1200, sales: 900 },
        },
      }),
    },
  ];
  const out = formatToolResultsFallback(messages);
  assert.ok(out);
  assert.match(out!, /8100/);
  assert.match(out!, /shopify/i);
});

test("formatToolResultsFallback never returns empty when tools exist", () => {
  const messages = [
    { role: "user", content: "test" },
    { role: "tool", tool_call_id: "1", content: JSON.stringify({ error: "timeout" }) },
  ];
  const out = formatToolResultsFallback(messages);
  assert.ok(out);
  assert.match(out!, /failed/i);
});
