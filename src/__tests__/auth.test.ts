import { beforeEach, describe, expect, it, vi } from "vitest";

const silent = vi.fn();
const redirect = vi.fn();

vi.mock("@azure/msal-browser", async (orig) => {
  const real = await orig<typeof import("@azure/msal-browser")>();
  class FakePCA {
    acquireTokenSilent = silent;
    acquireTokenRedirect = redirect;
  }
  return { ...real, PublicClientApplication: FakePCA };
});

const store = new Map<string, string>();
Object.assign(globalThis, {
  window: { location: { origin: "https://example.org" } },
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const { Auth } = await import("@/auth/msal");
const { BrowserAuthError, CacheLookupPolicy } = await import("@azure/msal-browser");

function signedIn() {
  const a = new Auth({ tenantId: "t", clientId: "c", siteUrl: "https://x/sites/y" });
  a.account = { homeAccountId: "h", environment: "e", tenantId: "t", username: "u@example.org", localAccountId: "l" };
  return a;
}

describe("Auth.token", () => {
  beforeEach(() => {
    silent.mockReset();
    redirect.mockReset();
    store.clear();
  });

  it("uses cached or refresh tokens only, never the hidden frame", async () => {
    silent.mockResolvedValue({ accessToken: "tok" });
    expect(await signedIn().token(["User.Read"])).toBe("tok");
    expect(silent.mock.calls[0][0].cacheLookupPolicy).toBe(CacheLookupPolicy.AccessTokenAndRefreshToken);
  });

  it("falls back to a full redirect when silent sign-in fails for any reason", async () => {
    silent.mockRejectedValue(new BrowserAuthError("timed_out", ""));
    void signedIn().token(["User.Read"]); // never settles: the page navigates away
    await vi.waitFor(() => expect(redirect).toHaveBeenCalledOnce());
  });

  it("stops instead of looping when a redirect just came back without a token", async () => {
    silent.mockRejectedValue(new BrowserAuthError("timed_out", ""));
    store.set("fsi-auth-redirect-at", String(Date.now()));
    await expect(signedIn().token(["User.Read"])).rejects.toThrow(/admin consent/);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("reports network trouble without redirecting", async () => {
    silent.mockRejectedValue(new BrowserAuthError("no_network_connectivity", ""));
    await expect(signedIn().token(["User.Read"])).rejects.toBeInstanceOf(BrowserAuthError);
    expect(redirect).not.toHaveBeenCalled();
  });
});
