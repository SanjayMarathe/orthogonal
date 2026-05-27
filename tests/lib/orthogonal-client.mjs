const BASE = "https://api.orthogonal.com/v1";

export async function orthGet(path, apiKey) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: "invalid json", preview: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, data };
}

export async function orthPost(path, body, apiKey) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: "invalid json", preview: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, data };
}
