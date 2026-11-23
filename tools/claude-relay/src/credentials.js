// How the relay signs in to Claude. Preferred: workload identity federation, where the
// Function App's Azure managed identity proves who it is and Anthropic issues short-lived
// tokens, so no secret is stored anywhere. Fallback: an API key in ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import { oidcFederationProvider } from "@anthropic-ai/sdk/lib/credentials/oidc-federation";

/** A problem getting credentials, worded for whoever reads the app's error message. */
export class CredentialError extends Error {}

/**
 * Fetches a token for `audience` (api://<app id>) from the Function App's managed identity.
 * Azure sets IDENTITY_ENDPOINT and IDENTITY_HEADER once the identity is turned on.
 */
export function azureManagedIdentityToken(audience, env = process.env, fetchFn = fetch) {
  return async () => {
    if (!env.IDENTITY_ENDPOINT || !env.IDENTITY_HEADER) {
      throw new CredentialError("The relay's Azure managed identity is off. Turn on Identity > System assigned in the Function App.");
    }
    const url = new URL(env.IDENTITY_ENDPOINT);
    url.searchParams.set("resource", audience);
    url.searchParams.set("api-version", "2019-08-01");
    // Only needed when the Function App has more than one user-assigned identity.
    if (env.AZURE_IDENTITY_CLIENT_ID) url.searchParams.set("client_id", env.AZURE_IDENTITY_CLIENT_ID);
    const res = await fetchFn(url, { headers: { "X-IDENTITY-HEADER": env.IDENTITY_HEADER } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.access_token) {
      throw new CredentialError(`Azure did not issue the relay an identity token for ${audience} (${res.status}). Check ANTHROPIC_IDENTITY_AUDIENCE.`);
    }
    return body.access_token;
  };
}

/** Which settings are missing for the chosen sign-in method; empty when ready. */
export function missingSettings(env = process.env) {
  const need = ["FSI_TENANT_ID", "FSI_CLIENT_ID"];
  if (!env.ANTHROPIC_API_KEY) need.push("ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_IDENTITY_AUDIENCE");
  return need.filter((k) => !env[k]);
}

/** The Claude client for this Function App's settings. */
export function claudeClient(env = process.env, fetchFn = fetch) {
  if (env.ANTHROPIC_API_KEY) return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, fetch: fetchFn });
  return new Anthropic({
    fetch: fetchFn,
    // The client caches the exchanged token and exchanges again shortly before it expires.
    credentials: oidcFederationProvider({
      identityTokenProvider: azureManagedIdentityToken(env.ANTHROPIC_IDENTITY_AUDIENCE, env, fetchFn),
      federationRuleId: env.ANTHROPIC_FEDERATION_RULE_ID,
      organizationId: env.ANTHROPIC_ORGANIZATION_ID,
      serviceAccountId: env.ANTHROPIC_SERVICE_ACCOUNT_ID || undefined,
      workspaceId: env.ANTHROPIC_WORKSPACE_ID || undefined,
      baseURL: "https://api.anthropic.com",
      fetch: fetchFn,
    }),
  });
}
