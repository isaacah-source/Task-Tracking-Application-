// SharePoint Lists through Microsoft Graph, called as the signed-in person. The app can only
// reach the site if that person can; removing someone from the site removes their access.

import type { DataSet, ID, Row, TableName } from "@/domain/types";
import { emptyDataSet } from "@/domain/types";
import type { Backend, NewRow } from "./backend";
import { ADMIN_ONLY_TABLES, SCHEMA, TABLES, columnName, displayName, fromFields, toFields, type ColType } from "./schema";

export const GRAPH = "https://graph.microsoft.com/v1.0";

/** Scopes for everyday use: read and write list items. */
export const DATA_SCOPES = ["User.Read", "Sites.ReadWrite.All"];
/** Extra scope asked for only when an admin runs setup (creating lists and columns). */
export const SETUP_SCOPES = ["Sites.Manage.All"];

export type TokenFn = (scopes: string[]) => Promise<string>;
type Fetch = typeof fetch;

export class GraphError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Plain-language messages for the failures people actually hit. */
export function explain(status: number, code: string, message: string): string {
  if (status === 401) return "Your Microsoft sign-in expired. Sign in again.";
  if (status === 403 || code === "accessDenied") {
    return "Your Microsoft account cannot open the FSI Task Tracker site, or has read-only access. Ask the site owner to add you (as a member to make changes).";
  }
  if (status === 404) return "Something the app needs was not found on the SharePoint site. It may have been deleted, or setup has not been run yet.";
  if (status === 429 || status === 503) return "Microsoft is busy. Wait a few seconds and try again.";
  if (status === 400 && /not recognized/i.test(message)) {
    return "The SharePoint lists need an update for this version of the app. Ask an admin to click \"Update SharePoint lists\" on the Admin page.";
  }
  return message || `Microsoft Graph error ${status}`;
}

/** "https://host/sites/Name" -> Graph path "/sites/host:/sites/Name". */
export function sitePath(siteUrl: string): string {
  const u = new URL(siteUrl);
  const path = u.pathname.replace(/\/+$/, "");
  return path ? `/sites/${u.hostname}:${path}` : `/sites/${u.hostname}`;
}

export function columnDefinition(field: string, type: ColType): Record<string, unknown> {
  const base = { name: columnName(field), displayName: displayName(field) };
  switch (type) {
    case "number":
      return { ...base, number: {} };
    case "bool":
      return { ...base, boolean: {} };
    case "note":
    case "json":
      return { ...base, text: { allowMultipleLines: true, textType: "plain", linesForEditing: 6 } };
    default:
      return { ...base, text: {} };
  }
}

export class GraphListsBackend implements Backend {
  readonly kind = "sharepoint" as const;
  private siteId: Promise<string> | null = null;
  private listIds: Map<string, string> | null = null;

  constructor(private siteUrl: string, private token: TokenFn, private fetchFn: Fetch = (...a) => fetch(...a)) {}

  private async call<T>(method: string, path: string, body?: unknown, scopes = DATA_SCOPES): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.token(scopes)}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await this.fetchFn(path.startsWith("http") ? path : `${GRAPH}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
      // Throttling: honor Retry-After, up to three times.
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 3) {
        const wait = Number(res.headers.get("Retry-After")) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      const err = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      const code = err.error?.code ?? "";
      throw new GraphError(res.status, code, explain(res.status, code, err.error?.message ?? ""));
    }
  }

  private site(): Promise<string> {
    this.siteId ??= this.call<{ id: string }>("GET", `${sitePath(this.siteUrl)}?$select=id`).then((s) => s.id);
    return this.siteId;
  }

  private async lists(refresh = false): Promise<Map<string, string>> {
    if (this.listIds && !refresh) return this.listIds;
    const siteId = await this.site();
    const r = await this.call<{ value: { id: string; displayName: string }[] }>(
      "GET", `/sites/${siteId}/lists?$select=id,displayName&$top=500`,
    );
    this.listIds = new Map(r.value.map((l) => [l.displayName, l.id]));
    return this.listIds;
  }

  private async listPath(table: TableName): Promise<string> {
    const name = SCHEMA[table].listName;
    const id = (await this.lists()).get(name);
    if (!id) throw new GraphError(404, "listMissing", `The "${name}" list is missing. An admin needs to run setup on the Admin page.`);
    return `/sites/${await this.site()}/lists/${id}`;
  }

  async loadTable<K extends TableName>(table: K): Promise<Row<K>[]> {
    return this.readAll(table);
  }

  private async readAll<K extends TableName>(table: K): Promise<Row<K>[]> {
    const base = await this.listPath(table);
    const rows: Row<K>[] = [];
    let next: string | undefined = `${base}/items?$expand=fields&$top=999`;
    while (next) {
      const page: { value: { id: string; fields: Record<string, unknown> }[]; "@odata.nextLink"?: string } =
        await this.call("GET", next);
      for (const item of page.value) rows.push(fromFields(table, item.id, item.fields));
      next = page["@odata.nextLink"];
    }
    return rows;
  }

  async load(): Promise<DataSet> {
    const data = emptyDataSet();
    await Promise.all(
      TABLES.filter((t) => !ADMIN_ONLY_TABLES.includes(t)).map(async (t) => {
        (data as unknown as Record<string, unknown>)[t] = await this.readAll(t);
      }),
    );
    return data;
  }

  async create<K extends TableName>(table: K, row: NewRow<K>): Promise<Row<K>> {
    // Empty values are left out: a new item starts empty anyway, and this way a column added
    // in a later version only has to exist once something is actually stored in it.
    const fields = Object.fromEntries(Object.entries(toFields(table, row as Partial<Row<K>>)).filter(([, v]) => v !== null));
    const r = await this.call<{ id: string; fields: Record<string, unknown> }>(
      "POST", `${await this.listPath(table)}/items`, { fields },
    );
    return fromFields(table, r.id, r.fields ?? toFields(table, row as Partial<Row<K>>));
  }

  async update<K extends TableName>(table: K, id: ID, patch: Partial<Row<K>>): Promise<void> {
    const fields = toFields(table, patch, false);
    if (!Object.keys(fields).length) return;
    await this.call("PATCH", `${await this.listPath(table)}/items/${id}/fields`, fields);
  }

  async remove(table: TableName, id: ID): Promise<void> {
    await this.call("DELETE", `${await this.listPath(table)}/items/${id}`);
  }

  async missingLists(): Promise<string[]> {
    const have = await this.lists(true);
    return TABLES.map((t) => SCHEMA[t].listName).filter((n) => !have.has(n));
  }

  async missingColumns(): Promise<string[]> {
    const siteId = await this.site();
    const have = await this.lists(true);
    const out = await Promise.all(TABLES.map(async (t) => {
      const d = SCHEMA[t];
      const id = have.get(d.listName);
      if (!id) return null;
      const cols = await this.call<{ value: { name: string }[] }>("GET", `/sites/${siteId}/lists/${id}/columns?$select=name`);
      const names = new Set(cols.value.map((c) => c.name));
      const missing = Object.keys(d.columns).filter((f) => !names.has(columnName(f))).map(displayName);
      return missing.length ? `${d.listName}: ${missing.join(", ")}` : null;
    }));
    return out.filter((x): x is string => !!x);
  }

  async setup(): Promise<void> {
    const siteId = await this.site();
    const have = await this.lists(true);
    for (const t of TABLES) {
      const d = SCHEMA[t];
      const columns = Object.entries(d.columns).map(([f, type]) => columnDefinition(f, type));
      const existing = have.get(d.listName);
      if (!existing) {
        await this.call("POST", `/sites/${siteId}/lists`, {
          displayName: d.listName,
          description: d.description,
          list: { template: "genericList" },
          columns,
        }, SETUP_SCOPES);
        continue;
      }
      // Existing list: add any columns a newer version of the app introduced.
      const cols = await this.call<{ value: { name: string }[] }>(
        "GET", `/sites/${siteId}/lists/${existing}/columns?$select=name`, undefined, SETUP_SCOPES,
      );
      const names = new Set(cols.value.map((c) => c.name));
      for (const c of columns) {
        if (!names.has(c.name as string)) await this.call("POST", `/sites/${siteId}/lists/${existing}/columns`, c, SETUP_SCOPES);
      }
    }
    await this.lists(true);
  }
}
