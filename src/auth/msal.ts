import { BrowserAuthError, CacheLookupPolicy, PublicClientApplication, type AccountInfo } from "@azure/msal-browser";
import type { AppConfig } from "./config";
import { BASE } from "./config";
import { DATA_SCOPES } from "@/data/graphBackend";

/**
 * Microsoft 365 sign-in, the same way the Relationship Tracker does it. People use their
 * normal FSI work account; the token lets the app act as that person against SharePoint, so
 * it can only reach what that person can.
 */
const REDIRECT_KEY = "fsi-auth-redirect-at";

export class Auth {
  private pca: PublicClientApplication;
  account: AccountInfo | null = null;

  constructor(cfg: AppConfig) {
    this.pca = new PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
        redirectUri: new URL(BASE, window.location.origin).href,
        postLogoutRedirectUri: new URL(BASE, window.location.origin).href,
      },
      // localStorage keeps people signed in across visits.
      cache: { cacheLocation: "localStorage" },
    });
  }

  /** Finishes a sign-in redirect if one is in progress; returns the signed-in account. */
  async init(): Promise<AccountInfo | null> {
    await this.pca.initialize();
    const result = await this.pca.handleRedirectPromise();
    this.account = result?.account ?? this.pca.getActiveAccount() ?? this.pca.getAllAccounts()[0] ?? null;
    if (this.account) this.pca.setActiveAccount(this.account);
    return this.account;
  }

  signIn() {
    // Redirect rather than popup: popups are unreliable on phones.
    return this.pca.loginRedirect({ scopes: DATA_SCOPES, prompt: "select_account" });
  }

  signOut() {
    return this.pca.logoutRedirect({ account: this.account });
  }

  token = async (scopes: string[]): Promise<string> => {
    if (!this.account) throw new Error("Not signed in.");
    try {
      // Cached token or refresh token only. MSAL's hidden-frame fallback needs a separate
      // redirect bridge page and otherwise times out, so a full redirect replaces it.
      const r = await this.pca.acquireTokenSilent({
        scopes, account: this.account, cacheLookupPolicy: CacheLookupPolicy.AccessTokenAndRefreshToken,
      });
      sessionStorage.removeItem(REDIRECT_KEY);
      return r.accessToken;
    } catch (e) {
      // Network trouble is not a sign-in problem; let the caller show it.
      if (e instanceof BrowserAuthError && e.errorCode === "no_network_connectivity") throw e;
      // Stop instead of looping if a redirect just came back without a usable token.
      const last = Number(sessionStorage.getItem(REDIRECT_KEY) ?? 0);
      if (Date.now() - last < 60_000) {
        sessionStorage.removeItem(REDIRECT_KEY);
        throw new Error(
          `Microsoft sign-in did not return access for this app (${(e as Error).message}). ` +
            "Ask a Microsoft 365 admin to check the app registration's permissions and admin consent.",
        );
      }
      sessionStorage.setItem(REDIRECT_KEY, String(Date.now()));
      await this.pca.acquireTokenRedirect({ scopes, account: this.account });
      // The page navigates away; this promise never settles.
      return new Promise<string>(() => {});
    }
  };
}
