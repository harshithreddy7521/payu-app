import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { errorHandler } from "../middleware/error.js";

test("Fastify empty/invalid JSON remains a 400; bodyless member removal reaches its handler", async () => {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  app.delete("/groups/:id/members/:memberId", async () => ({ removed: true }));
  try {
    const path = "/groups/group/members/member";
    const empty = await app.inject({
      method: "DELETE",
      url: path,
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(empty.statusCode, 400);
    assert.equal(empty.json().code, "FST_ERR_CTP_EMPTY_JSON_BODY");
    assert(empty.json().correlationId);
    const malformed = await app.inject({
      method: "DELETE",
      url: path,
      headers: { "Content-Type": "application/json" },
      payload: "{bad",
    });
    assert.equal(malformed.statusCode, 400);
    const valid = await app.inject({ method: "DELETE", url: path });
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.json().removed, true);
  } finally {
    await app.close();
  }
});
