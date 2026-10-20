// The real Relationship Tracker: its Excel workbook in OneDrive or SharePoint, read and
// written through Microsoft Graph as the signed-in person. Contacts come from the Master tab
// (columns found by header text, as the tracker app does). Project involvement goes to an
// "FSI Projects" tab, which this app creates and owns; the Relationship Tracker app reads it
// to list each contact's FSI projects.

import type { ExternalContact, ExternalOrganization, ProjectInvolvement, RelationshipTracker } from "./adapter";
import { GRAPH, GraphError, type TokenFn } from "@/data/graphBackend";

/** Graph permission for files shared with the person, as the Relationship Tracker app uses. */
export const TRACKER_SCOPES = ["Files.ReadWrite.All"];

export const MASTER_SHEET = "Master";
export const PROJECTS_SHEET = "FSI Projects";
export const PROJECT_HEADERS = [
  "Contact ID", "Contact", "Project ID", "Project", "Project Status", "Project Owner", "Role", "Active", "Project Link", "Updated At",
] as const;

type Cell = string | number | boolean | null;
type Fetch = typeof fetch;

/** Converts a sharing link into the id the /shares endpoint takes ("u!" + base64url). */
export function encodeShareUrl(url: string): string {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(url.trim())));
  return "u!" + b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** "B3" style address -> zero-based column and row of its top-left cell. */
export function rangeStart(address: string): { col: number; row: number } {
  const m = /\$?([A-Z]+)\$?(\d+)/.exec(address.split("!").pop() ?? "A1");
  if (!m) return { col: 0, row: 0 };
  const col = m[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { col, row: Number(m[2]) - 1 };
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Reads contacts from Master tab rows. The header row is the first one holding "Unique ID". */
export function parseMaster(rows: Cell[][]): ExternalContact[] {
  if (!rows.length) return [];
  const headerAt = Math.max(0, rows.findIndex((r) => r.map(norm).includes("unique id")));
  const header = rows[headerAt].map(norm);
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const c = {
    id: col("unique id"),
    name: col("name"),
    org: col("organization"),
    type: col("relationship type"),
    title: col("title"),
    email: col("email"),
  };
  if (c.id < 0 || c.name < 0) throw new Error('The tracker\'s Master tab has no "Unique ID" or "Name" column.');
  const text = (r: Cell[], i: number) => (i < 0 || r[i] == null ? "" : String(r[i]).trim());
  return rows
    .slice(headerAt + 1)
    .filter((r) => text(r, c.id) && text(r, c.name))
    .map((r) => ({
      externalId: text(r, c.id),
      name: text(r, c.name),
      title: text(r, c.title),
      organization: text(r, c.org),
      relationshipType: text(r, c.type),
      email: text(r, c.email),
    }));
}

/** Organizations, taken from the contacts' Organization column. */
export function organizationsFrom(contacts: ExternalContact[]): ExternalOrganization[] {
  const byOrg = new Map<string, { name: string; types: Map<string, number> }>();
  for (const c of contacts) {
    if (!c.organization) continue;
    const key = norm(c.organization);
    const o = byOrg.get(key) ?? { name: c.organization, types: new Map() };
    if (c.relationshipType) o.types.set(c.relationshipType, (o.types.get(c.relationshipType) ?? 0) + 1);
    byOrg.set(key, o);
  }
  return [...byOrg.entries()]
    .map(([key, o]) => ({
      externalId: `org:${key}`,
      name: o.name,
      // The type most of its people carry.
      relationshipType: [...o.types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Merges involvement into the FSI Projects tab rows: updates the row for the same contact and
 * project, appends new ones. Returns the full table (header first).
 */
export function mergeInvolvement(existing: Cell[][], items: ProjectInvolvement[], nowIso: string): Cell[][] {
  const out: Cell[][] = [[...PROJECT_HEADERS]];
  const index = new Map<string, number>();
  for (const r of existing.slice(1)) {
    if (!r.some((v) => v !== "" && v != null)) continue;
    const row = PROJECT_HEADERS.map((_, i) => r[i] ?? "");
    index.set(`${row[0]}|${row[2]}`, out.length);
    out.push(row);
  }
  for (const i of items) {
    const row: Cell[] = [
      i.externalId, i.contactName, i.projectId, i.projectTitle, i.projectStatus, i.ownerEmail, i.role, i.active ? "Yes" : "No", i.projectUrl, nowIso,
    ];
    const at = index.get(`${i.externalId}|${i.projectId}`);
    if (at === undefined) {
      index.set(`${i.externalId}|${i.projectId}`, out.length);
      out.push(row);
    } else {
      out[at] = row;
    }
  }
  return out;
}

export class WorkbookRelationshipTracker implements RelationshipTracker {
  readonly name = "Relationship Tracker";
  private item: Promise<{ driveId: string; itemId: string }> | null = null;
  private contacts: { at: number; rows: Promise<ExternalContact[]> } | null = null;

  constructor(
    private folderUrl: string,
    private workbookName: string | undefined,
    private token: TokenFn,
    private fetchFn: Fetch = (...a) => fetch(...a),
    private now: () => Date = () => new Date(),
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const h: Record<string, string> = { Authorization: `Bearer ${await this.token(TRACKER_SCOPES)}`, ...headers };
      if (body !== undefined) h["Content-Type"] = "application/json";
      const res = await this.fetchFn(`${GRAPH}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 3) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get("Retry-After")) || 2 ** attempt) * 1000));
        continue;
      }
      const err = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      const code = err.error?.code ?? "";
      if (res.status === 403 || res.status === 401 || code === "accessDenied") {
        throw new GraphError(res.status, code, "Your Microsoft account cannot open the Relationship Tracker workbook. Ask its owner to share the folder with you (edit access to link contacts).");
      }
      if (res.status === 404) throw new GraphError(404, code, "The Relationship Tracker workbook was not found. Its folder may have moved; an admin can update the tracker folder link.");
      throw new GraphError(res.status, code, err.error?.message || `Microsoft Graph error ${res.status}`);
    }
  }

  /** Finds the workbook from the folder's sharing link (or a link to the file itself). */
  private open() {
    this.item ??= (async () => {
      type Item = { id: string; name: string; file?: unknown; parentReference: { driveId: string } };
      const shared = await this.call<Item>("GET", `/shares/${encodeShareUrl(this.folderUrl)}/driveItem`, undefined, { Prefer: "redeemSharingLink" });
      const driveId = shared.parentReference.driveId;
      if (shared.file) return { driveId, itemId: shared.id };
      const list = await this.call<{ value: Item[] }>("GET", `/drives/${driveId}/items/${shared.id}/children?$top=200&$select=id,name,file,parentReference`);
      const books = list.value.filter((i) => i.file && /\.xlsx$/i.test(i.name) && !i.name.startsWith("~$"));
      const pick = this.workbookName
        ? books.find((b) => b.name.toLowerCase() === this.workbookName!.toLowerCase())
        : books.length === 1 ? books[0] : books.find((b) => /relationship/i.test(b.name));
      if (!pick) {
        throw new Error(this.workbookName
          ? `No workbook named "${this.workbookName}" in the tracker folder.`
          : `The tracker folder has ${books.length} workbooks; an admin needs to set the workbook name.`);
      }
      return { driveId, itemId: pick.id };
    })();
    // Let a failed lookup be retried next time.
    this.item.catch(() => (this.item = null));
    return this.item;
  }

  private async sheetPath(sheet: string) {
    const { driveId, itemId } = await this.open();
    return `/drives/${driveId}/items/${itemId}/workbook/worksheets/${encodeURIComponent(sheet)}`;
  }

  /** A tab's cells, padded so index 0 is row 1, column A. Null when the tab does not exist. */
  private async read(sheet: string): Promise<Cell[][] | null> {
    try {
      const r = await this.call<{ address: string; values: Cell[][] }>("GET", `${await this.sheetPath(sheet)}/usedRange(valuesOnly=true)?$select=address,values`);
      const { col, row } = rangeStart(r.address);
      const rows: Cell[][] = Array.from({ length: row }, () => []);
      for (const v of r.values) rows.push([...Array(col).fill(""), ...v]);
      if (rows.length === 1 && rows[0].every((v) => v === "" || v == null)) return [];
      return rows;
    } catch (e) {
      // The workbook itself was found by open(), so a 404 here means the tab is missing.
      if (e instanceof GraphError && e.status === 404) return null;
      throw e;
    }
  }

  /** Contacts from the Master tab. Reused for a minute so one sync reads the workbook once. */
  listContacts(): Promise<ExternalContact[]> {
    if (!this.contacts || Date.now() - this.contacts.at > 60_000) {
      const rows = (async () => {
        const master = await this.read(MASTER_SHEET);
        if (!master) throw new Error('The tracker workbook has no "Master" tab.');
        return parseMaster(master);
      })();
      this.contacts = { at: Date.now(), rows };
      // A failed read is retried next time.
      rows.catch(() => (this.contacts = null));
    }
    return this.contacts.rows;
  }

  async listOrganizations(): Promise<ExternalOrganization[]> {
    return organizationsFrom(await this.listContacts());
  }

  async pushInvolvement(items: ProjectInvolvement[]): Promise<{ accepted: number }> {
    if (!items.length) return { accepted: 0 };
    let existing = await this.read(PROJECTS_SHEET);
    if (existing === null) {
      const { driveId, itemId } = await this.open();
      await this.call("POST", `/drives/${driveId}/items/${itemId}/workbook/worksheets/add`, { name: PROJECTS_SHEET });
      existing = [];
    }
    const table = mergeInvolvement(existing, items, this.now().toISOString());
    const address = `A1:${columnLetter(PROJECT_HEADERS.length - 1)}${table.length}`;
    await this.call("PATCH", `${await this.sheetPath(PROJECTS_SHEET)}/range(address='${address}')`, { values: table });
    return { accepted: items.length };
  }
}

/** Stands in when no tracker folder is configured, with a message saying how to connect it. */
export class UnconfiguredRelationshipTracker implements RelationshipTracker {
  readonly name = "Relationship Tracker (not connected)";
  private fail(): never {
    throw new Error("The Relationship Tracker is not connected yet. An admin sets the tracker folder link (see README, \"Relationship Tracker\").");
  }
  async listContacts(): Promise<ExternalContact[]> {
    this.fail();
  }
  async listOrganizations(): Promise<ExternalOrganization[]> {
    this.fail();
  }
  async pushInvolvement(): Promise<{ accepted: number }> {
    this.fail();
  }
}
