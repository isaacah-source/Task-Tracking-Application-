import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from "@azure/msal-browser";
import type { AppConfig } from "./config";
import { BASE } from "./config";
import { DATA_SCOPES } from "@/data/graphBackend";

/**
 * Microsoft 365 sign-in, the same way the Relationship Tracker does it. People use their
 * normal FSI work account; the token lets the app act as that person against SharePoint, so
 * it can only reach what that person can.
 */
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
      return (await this.pca.acquireTokenSilent({ scopes, account: this.account })).accessToken;
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) {
        await this.pca.acquireTokenRedirect({ scopes, account: this.account });
      }
      throw e;
    }
  };
}
