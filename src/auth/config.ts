/**
 * Settings read at startup from config.json next to index.html, so one build can point at a
 * different tenant or site without rebuilding. See config.example.json.
 */
export interface AppConfig {
  /** Directory (tenant) ID from the Entra app registration. */
  tenantId: string;
  /** Application (client) ID from the Entra app registration. */
  clientId: string;
  /** The SharePoint site that holds the app's lists, e.g. https://org.sharepoint.com/sites/FSITaskTrackerApp */
  siteUrl: string;
  /** Emails allowed to run first-time setup. When omitted, anyone who can edit the site can. */
  setupAdmins?: string[];
  /** Run on built-in sample data with no sign-in. Nothing is saved. */
  demo?: boolean;
}

export const BASE = import.meta.env.BASE_URL;

export async function loadConfig(): Promise<AppConfig> {
  const demo = new URLSearchParams(window.location.search).has("demo");
  // Static hosts often answer a missing file with index.html, so a body that is not JSON
  // counts as "no config".
  const res = await fetch(`${BASE}config.json`, { cache: "no-store" }).catch(() => null);
  const cfg = res?.ok ? ((await res.json().catch(() => null)) as AppConfig | null) : null;
  if (demo || cfg?.demo || !cfg) return { tenantId: "", clientId: "", siteUrl: "", ...cfg, demo: true };
  if (!cfg.clientId || !cfg.tenantId || !cfg.siteUrl) {
    throw new Error("config.json is incomplete. Copy config.example.json to public/config.json and fill in tenantId, clientId, and siteUrl.");
  }
  return cfg;
}
