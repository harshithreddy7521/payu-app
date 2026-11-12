import { test } from "node:test";
import assert from "node:assert/strict";
import { apiFetch } from "./api";

test("bodyless requests omit JSON content type, JSON writes and custom headers are preserved", async () => {
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(init!);
    return new Response('{"ok":true}', {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await apiFetch("/v1/groups/g/members/m", {
      method: "DELETE",
      token: "test-token",
    });
    await apiFetch("/v1/members/m/archive", {
      method: "PATCH",
      token: "test-token",
    });
    await apiFetch("/v1/groups");
    for (const call of calls)
      assert.equal(new Headers(call.headers).has("Content-Type"), false);
    assert.equal(
      new Headers(calls[0].headers).get("Authorization"),
      "Bearer test-token",
    );
    await apiFetch("/v1/groups", { method: "POST", body: '{"name":"Group"}' });
    assert.equal(
      new Headers(calls[3].headers).get("Content-Type"),
      "application/json",
    );
    await apiFetch("/custom", {
      method: "POST",
      body: "hello",
      headers: new Headers({
        "Content-Type": "text/plain",
        "X-Custom": "present",
      }),
    });
    assert.equal(
      new Headers(calls[4].headers).get("Content-Type"),
      "text/plain",
    );
    assert.equal(new Headers(calls[4].headers).get("X-Custom"), "present");
    await apiFetch("/upload", { method: "POST", body: new FormData() });
    assert.equal(new Headers(calls[5].headers).has("Content-Type"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
