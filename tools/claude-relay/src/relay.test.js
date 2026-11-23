import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { askClaude, parseRequest, RelayError, MODEL, PLAN_SCHEMA } from "./relay.js";

const good = { kind: "analysis", system: "Be brief.", messages: [{ role: "user", content: "Who is busiest?" }] };

test("accepts the app's request and drops anything extra", () => {
  const r = parseRequest(JSON.stringify({ ...good, model: "other", max_tokens: 1 }));
  assert.deepEqual(r, good);
});

test("refuses other shapes", () => {
  for (const bad of ["not json", JSON.stringify({ ...good, kind: "chat" }), JSON.stringify({ ...good, messages: [] }),
    JSON.stringify({ ...good, messages: [{ role: "assistant", content: "x" }] }), JSON.stringify({ ...good, system: "" })]) {
    assert.throws(() => parseRequest(bad), (e) => e instanceof RelayError && e.status === 400);
  }
  assert.throws(() => parseRequest("x".repeat(4_000_001)), (e) => e.status === 413);
});

function fakeClient(result, capture = {}) {
  return { beta: { messages: { stream(params) { capture.params = params; return { finalMessage: async () => { if (result instanceof Error) throw result; return result; } }; } } } };
}
const msg = (over = {}) => ({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Dana." }], usage: { input_tokens: 10, output_tokens: 2 }, ...over });

test("sends the fixed model with fallbacks, and returns the text", async () => {
  const cap = {};
  const out = await askClaude(fakeClient(msg(), cap), good);
  assert.equal(out.text, "Dana.");
  assert.equal(cap.params.model, MODEL);
  assert.equal(cap.params.fallbacks, "default");
  assert.deepEqual(cap.params.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(cap.params.output_config.format, undefined);
});

test("asks for the plan's JSON shape on planning requests", async () => {
  const cap = {};
  await askClaude(fakeClient(msg(), cap), { ...good, kind: "planning" });
  assert.deepEqual(cap.params.output_config.format, { type: "json_schema", schema: PLAN_SCHEMA });
});

test("explains refusals and key problems", async () => {
  await assert.rejects(askClaude(fakeClient(msg({ stop_reason: "refusal", content: [] })), good), (e) => e.status === 422);
  const authErr = new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "bad key" } }, "bad key", new Headers());
  await assert.rejects(askClaude(fakeClient(authErr), good), (e) => e.status === 502 && /sign-in/.test(e.message));
});
