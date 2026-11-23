// POST /api/claude: the FSI Projects app's Planning and Ask pages call this.
//
// App settings (Azure portal > the Function App > Settings > Environment variables):
//   ANTHROPIC_API_KEY  FSI's Claude API key (never put it anywhere else)
//   FSI_TENANT_ID      Directory (tenant) ID, the same one the app uses
//   FSI_CLIENT_ID      Application (client) ID of the FSI Projects app registration
// Add the app's address (https://isaacah-source.github.io) under API > CORS.

import { app } from "@azure/functions";
import Anthropic from "@anthropic-ai/sdk";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { askClaude, parseRequest, RelayError } from "../relay.js";

const TENANT = process.env.FSI_TENANT_ID ?? "";
const CLIENT = process.env.FSI_CLIENT_ID ?? "";
// Microsoft's signing keys for the FSI tenant, fetched once and cached.
const keys = TENANT ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`)) : null;
// Reads ANTHROPIC_API_KEY.
const claude = new Anthropic();

const reply = (status, body) => ({ status, jsonBody: body });

/** Only people signed in to the FSI Projects app with an FSI account get through. */
async function signedInUser(request) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!m) throw new RelayError(401, "Sign in to FSI Projects first.");
  try {
    const { payload } = await jwtVerify(m[1], keys, {
      issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      audience: CLIENT,
    });
    return String(payload.preferred_username ?? payload.oid ?? "unknown");
  } catch {
    throw new RelayError(401, "Your FSI sign-in has expired or is not valid here. Reload the app and try again.");
  }
}

app.http("claude", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    if (!TENANT || !CLIENT || !process.env.ANTHROPIC_API_KEY) {
      return reply(500, { error: "The Claude relay is missing a setting in Azure (ANTHROPIC_API_KEY, FSI_TENANT_ID, or FSI_CLIENT_ID)." });
    }
    try {
      const who = await signedInUser(request);
      const req = parseRequest(await request.text());
      const out = await askClaude(claude, req);
      context.log(`${who} ${req.kind}: ${out.usage.input_tokens} tokens in, ${out.usage.output_tokens} out`);
      return reply(200, { text: out.text, truncated: out.truncated });
    } catch (e) {
      if (e instanceof RelayError) return reply(e.status, { error: e.message });
      context.error(e);
      return reply(500, { error: "The Claude relay hit an unexpected error. Try again." });
    }
  },
});
