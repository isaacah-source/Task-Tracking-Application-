// The relay's logic, kept apart from the Azure wiring so it can be tested without Azure.
// The FSI Projects app sends a request built by src/integrations/ai/provider.ts; this checks
// it, sends it to Claude with FSI's key, and returns plain text.

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
/** Largest request accepted: the app's project history is usually well under 1 MB. */
export const MAX_BODY_CHARS = 4_000_000;

/** The shape the Planning page expects back from Claude. */
export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          items: { type: "array", items: { type: "string" } },
        },
        required: ["heading", "items"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "sections"],
  additionalProperties: false,
};

export class RelayError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Checks the app's request: `kind` is "analysis" or "planning", `system` a string, and
 * `messages` one user message with text. Anything else is refused, so the relay cannot be
 * used as a general Claude endpoint with other settings.
 */
export function parseRequest(text) {
  if (text.length > MAX_BODY_CHARS) throw new RelayError(413, "That request is too large.");
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new RelayError(400, "The request was not valid JSON.");
  }
  const { kind, system, messages } = body ?? {};
  if (kind !== "analysis" && kind !== "planning") throw new RelayError(400, "Unknown request kind.");
  if (typeof system !== "string" || !system.trim()) throw new RelayError(400, "Missing instructions.");
  const ok = Array.isArray(messages) && messages.length === 1 && messages[0]?.role === "user" && typeof messages[0]?.content === "string" && messages[0].content.trim();
  if (!ok) throw new RelayError(400, "The request needs one question.");
  return { kind, system, messages: [{ role: "user", content: messages[0].content }] };
}

/** Sends a checked request to Claude and returns its text (JSON text for a plan). */
export async function askClaude(client, { kind, system, messages }) {
  let msg;
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      // If Claude declines on safety grounds, the API retries on its recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: kind === "planning"
        ? { effort: "high", format: { type: "json_schema", schema: PLAN_SCHEMA } }
        : { effort: "medium" },
      system,
      messages,
    });
    msg = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new RelayError(502, "The Claude API key saved in Azure is missing or not valid.");
    if (e instanceof Anthropic.PermissionDeniedError) throw new RelayError(502, "The Claude API key saved in Azure is not allowed to use this model.");
    if (e instanceof Anthropic.RateLimitError) throw new RelayError(429, "Claude is busy or FSI's usage limit was reached. Try again in a minute.");
    if (e instanceof Anthropic.BadRequestError) throw new RelayError(502, `Claude could not take this request: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new RelayError(502, `Claude returned an error (${e.status ?? "no status"}). Try again shortly.`);
    throw e;
  }
  if (msg.stop_reason === "refusal") {
    throw new RelayError(422, "Claude declined to answer this request. Try rewording it.");
  }
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) throw new RelayError(502, "Claude returned an empty answer. Try again.");
  return { text, truncated: msg.stop_reason === "max_tokens", usage: msg.usage };
}
