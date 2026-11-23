import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeClient, missingSettings } from "./credentials.js";
import { askClaude, RelayError } from "./relay.js";

const env = {
  FSI_TENANT_ID: "tid", FSI_CLIENT_ID: "cid",
  ANTHROPIC_FEDERATION_RULE_ID: "fdrl_1", ANTHROPIC_ORGANIZATION_ID: "org-uuid", ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_1",
  ANTHROPIC_IDENTITY_AUDIENCE: "api://claude-aud",
  IDENTITY_ENDPOINT: "http://localhost:8081/msi/token", IDENTITY_HEADER: "secret-header",
};

// A Claude reply as the streaming API sends it.
function sse() {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return [
    ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } }),
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "All good." } }),
    ev("content_block_stop", { index: 0 }),
    ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } }),
    ev("message_stop", {}),
  ].join("");
}

function fakeNet() {
  const calls = [];
  const fetchFn = async (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = new Headers(init.headers);
    calls.push({ url, headers, body: init.body });
    if (url.pathname === "/msi/token") return Response.json({ access_token: "azure-jwt" });
    if (url.pathname === "/v1/oauth/token") return Response.json({ access_token: "sk-ant-oat01-abc", token_type: "Bearer", expires_in: 3600 });
    if (url.pathname === "/v1/messages") return new Response(sse(), { headers: { "content-type": "text/event-stream" } });
    return new Response("not found", { status: 404 });
  };
  return { calls, fetchFn };
}

test("federation: Azure identity token is exchanged for a Claude token, then used", async () => {
  const net = fakeNet();
  const out = await askClaude(claudeClient(env, net.fetchFn), { kind: "analysis", system: "s", messages: [{ role: "user", content: "q" }] });
  assert.equal(out.text, "All good.");
  const [msi, exchange, messages] = net.calls;
  assert.equal(msi.url.searchParams.get("resource"), "api://claude-aud");
  assert.equal(msi.headers.get("x-identity-header"), "secret-header");
  const ex = exchange.body instanceof URLSearchParams ? Object.fromEntries(exchange.body) : JSON.parse(String(exchange.body));
  assert.equal(ex.assertion, "azure-jwt");
  assert.equal(ex.federation_rule_id, "fdrl_1");
  assert.equal(ex.organization_id, "org-uuid");
  assert.equal(messages.headers.get("authorization"), "Bearer sk-ant-oat01-abc");
  assert.equal(messages.headers.get("x-api-key"), null);
});

test("federation: a missing managed identity gives a plain message", async () => {
  const net = fakeNet();
  const { IDENTITY_ENDPOINT, IDENTITY_HEADER, ...noIdentity } = env;
  await assert.rejects(
    askClaude(claudeClient(noIdentity, net.fetchFn), { kind: "analysis", system: "s", messages: [{ role: "user", content: "q" }] }),
    (e) => e instanceof RelayError && /managed identity is off/.test(e.message),
  );
});

test("lists missing settings for federation, or accepts an API key instead", () => {
  assert.deepEqual(missingSettings(env), []);
  assert.deepEqual(missingSettings({ FSI_TENANT_ID: "t", FSI_CLIENT_ID: "c" }), ["ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_IDENTITY_AUDIENCE"]);
  assert.deepEqual(missingSettings({ FSI_TENANT_ID: "t", FSI_CLIENT_ID: "c", ANTHROPIC_API_KEY: "k" }), []);
});
