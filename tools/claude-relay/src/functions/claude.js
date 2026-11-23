// POST /api/claude: the FSI Projects app's Planning and Ask pages call this.
//
// App settings (Azure portal > the Function App > Settings > Environment variables):
//   FSI_TENANT_ID                 Directory (tenant) ID, the same one the app uses
//   FSI_CLIENT_ID                 Application (client) ID of the FSI Projects app registration
// Signing in to Claude with workload identity federation (no stored secret):
//   ANTHROPIC_FEDERATION_RULE_ID  fdrl_... from the Claude Console's Workload identity page
//   ANTHROPIC_ORGANIZATION_ID     the Claude organization's ID
//   ANTHROPIC_SERVICE_ACCOUNT_ID  svac_... (optional)
//   ANTHROPIC_WORKSPACE_ID        wrkspc_... (only when the rule covers several workspaces)
//   ANTHROPIC_IDENTITY_AUDIENCE   api://<app id> of the "Claude API audience" app registration
// or, instead, an API key:
//   ANTHROPIC_API_KEY
// Also: Identity > System assigned turned on, and the app's address
// (https://isaacah-source.github.io) under API > CORS.

import { app } from "@azure/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { claudeClient, missingSettings } from "../credentials.js";
import { askClaude, parseRequest, RelayError } from "../relay.js";

const TENANT = process.env.FSI_TENANT_ID ?? "";
const CLIENT = process.env.FSI_CLIENT_ID ?? "";
// Microsoft's signing keys for the FSI tenant, fetched once and cached.
const keys = TENANT ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`)) : null;
const missing = missingSettings();
const claude = missing.length ? null : claudeClient();

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
    if (!claude) return reply(500, { error: `The Claude relay is missing settings in Azure: ${missing.join(", ")}.` });
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
