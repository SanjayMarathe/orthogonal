import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestEnv, requireEnv } from "../lib/env.mjs";
import { getAnonymousAccessToken } from "../lib/chat-client.mjs";

test("Supabase: anonymous auth succeeds", async () => {
  const env = loadTestEnv();
  requireEnv(env, ["supabaseUrl", "supabaseAnonKey"]);

  const token = await getAnonymousAccessToken(
    env.supabaseUrl,
    env.supabaseAnonKey,
  );
  assert.ok(token.length > 20, "expected JWT access token");
});

test("Supabase: models edge function responds", async () => {
  const env = loadTestEnv();
  requireEnv(env, ["supabaseUrl", "supabaseAnonKey"]);

  const token = await getAnonymousAccessToken(
    env.supabaseUrl,
    env.supabaseAnonKey,
  );
  const res = await fetch(`${env.supabaseUrl}/functions/v1/models`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  assert.equal(res.ok, true, body);
  const data = JSON.parse(body);
  assert.ok(Array.isArray(data.models), "expected models array");
  assert.ok(data.models.length > 0, "expected at least one model");
});

test("Supabase: integrations edge function responds", async () => {
  const env = loadTestEnv();
  requireEnv(env, ["supabaseUrl", "supabaseAnonKey"]);

  const token = await getAnonymousAccessToken(
    env.supabaseUrl,
    env.supabaseAnonKey,
  );
  const res = await fetch(`${env.supabaseUrl}/functions/v1/integrations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  assert.equal(res.ok, true, body);
  const data = JSON.parse(body);
  assert.ok(Array.isArray(data.integrations), "expected integrations array");
  assert.ok(data.count > 0, "expected integration count");
});
