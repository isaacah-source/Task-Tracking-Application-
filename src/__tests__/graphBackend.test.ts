import { describe, expect, it } from "vitest";
import { GraphListsBackend, sitePath } from "@/data/graphBackend";
import { SCHEMA, TABLES, columnName, fromFields, toFields } from "@/data/schema";
import { buildSeed } from "@/data/seed";

describe("schema mapping", () => {
  const seed = buildSeed("2026-10-19");
  it("round-trips every seeded record through SharePoint fields", () => {
    for (const t of TABLES) {
      for (const row of seed[t]) {
        const back = fromFields(t, row.id, toFields(t, row));
        expect(back).toEqual(row);
      }
    }
  });
  it("prefixes column names and fills Title", () => {
    const f = toFields("projects", seed.projects[0]);
    expect(f.Title).toBe(seed.projects[0].title);
    expect(f.fsiOutputTypeIds).toBe('["1"]');
    expect(columnName("order")).toBe("fsiOrder");
  });
  it("writes only given fields on update", () => {
    expect(toFields("tasks", { dueDate: "2026-11-01" }, false)).toEqual({ fsiDueDate: "2026-11-01" });
    expect(toFields("tasks", { title: "Renamed" }, false)).toEqual({ Title: "Renamed" });
  });
  it("tolerates junk from hand-edited lists", () => {
    const r = fromFields("projects", "9", { Title: "X", fsiOutputTypeIds: "not json", fsiPlannedBudget: "abc", fsiDueDate: "2026-11-01T00:00:00Z" });
    expect(r.outputTypeIds).toEqual([]);
    expect(r.plannedBudget).toBe(0);
    expect(r.dueDate).toBe("2026-11-01");
  });
});

describe("sitePath", () => {
  it("builds the Graph path for a site URL", () => {
    expect(sitePath("https://frontiersecurityinstitute11.sharepoint.com/sites/FSITaskTrackerApp/")).toBe(
      "/sites/frontiersecurityinstitute11.sharepoint.com:/sites/FSITaskTrackerApp",
    );
  });
});

/** A tiny fake of the Graph endpoints the backend uses. */
function fakeGraph() {
  const calls: { method: string; url: string; body?: any; scopes?: string }[] = [];
  const lists = new Map<string, { id: string; items: Map<string, Record<string, unknown>>; columns: string[] }>();
  let nextItem = 1;
  const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url).replace("https://graph.microsoft.com/v1.0", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: u, body });
    if (u.startsWith("/sites/host:")) return json({ id: "SITE" });
    if (u.startsWith("/sites/SITE/lists?")) return json({ value: [...lists].map(([displayName, l]) => ({ id: l.id, displayName })) });
    if (u === "/sites/SITE/lists" && method === "POST") {
      lists.set(body.displayName, { id: `L${lists.size + 1}`, items: new Map(), columns: body.columns.map((c: any) => c.name) });
      return json({ id: `L${lists.size}` }, 201);
    }
    const m = /^\/sites\/SITE\/lists\/(L\d+)\/(items|columns)(?:\/(\d+))?(\/fields)?/.exec(u);
    if (!m) return json({ error: { code: "itemNotFound", message: "nope" } }, 404);
    const list = [...lists.values()].find((l) => l.id === m[1])!;
    if (m[2] === "columns") {
      if (method === "POST") list.columns.push(body.name);
      return json({ value: list.columns.map((name) => ({ name })) });
    }
    if (method === "GET") return json({ value: [...list.items].map(([id, fields]) => ({ id, fields })) });
    if (method === "POST") {
      const id = String(nextItem++);
      list.items.set(id, body.fields);
      return json({ id, fields: body.fields }, 201);
    }
    if (method === "PATCH") {
      list.items.set(m[3], { ...list.items.get(m[3]), ...body });
      return json(body);
    }
    if (method === "DELETE") {
      list.items.delete(m[3]);
      return json(null, 204);
    }
    return json({}, 400);
  };
  return { calls, lists, fetchFn: fetchFn as typeof fetch };
}

describe("GraphListsBackend", () => {
  const token = async (scopes: string[]) => `token-for-${scopes.join(",")}`;

  it("creates every list at setup, asking for the manage scope", async () => {
    const g = fakeGraph();
    const b = new GraphListsBackend("https://host/sites/Tracker", token, g.fetchFn);
    expect((await b.missingLists()).length).toBe(TABLES.length);
    await b.setup();
    expect(await b.missingLists()).toEqual([]);
    const createProjects = g.calls.find((c) => c.method === "POST" && c.body?.displayName === SCHEMA.projects.listName)!;
    expect(createProjects.body.list).toEqual({ template: "genericList" });
    expect(createProjects.body.columns.map((c: any) => c.name)).toContain("fsiDueDate");
  });

  it("adds missing columns to an existing list", async () => {
    const g = fakeGraph();
    const b = new GraphListsBackend("https://host/sites/Tracker", token, g.fetchFn);
    await b.setup();
    g.lists.get(SCHEMA.tasks.listName)!.columns = ["fsiProjectId"];
    await b.setup();
    expect(g.lists.get(SCHEMA.tasks.listName)!.columns).toContain("fsiCompletedAt");
  });

  it("reports columns a newer app version needs before setup adds them", async () => {
    const g = fakeGraph();
    const b = new GraphListsBackend("https://host/sites/Tracker", token, g.fetchFn);
    await b.setup();
    expect(await b.missingColumns()).toEqual([]);
    const meetings = g.lists.get(SCHEMA.meetings.listName)!;
    meetings.columns = meetings.columns.filter((c) => !/^fsi(Teams|Transcript)/.test(c));
    expect(await b.missingColumns()).toEqual(["FSI Meeting Notes: Teams Meeting, Teams Join Url, Transcript"]);
    await b.setup();
    expect(await b.missingColumns()).toEqual([]);
  });

  it("creates, reads, updates, and deletes items", async () => {
    const g = fakeGraph();
    const b = new GraphListsBackend("https://host/sites/Tracker", token, g.fetchFn);
    await b.setup();
    const created = await b.create("departments", { name: "Comms", parentId: null, ownerId: "2" });
    expect(created).toEqual({ id: "1", name: "Comms", parentId: null, ownerId: "2" });
    // Empty values are left out of a new item, so a newer optional column need not exist yet.
    expect(Object.keys(g.calls.find((c) => c.method === "POST" && c.body?.fields)!.body.fields)).not.toContain("fsiParentId");
    await b.update("departments", created.id, { name: "Communications" });
    expect(g.calls.at(-1)).toMatchObject({ method: "PATCH", body: { Title: "Communications" } });
    expect((await b.load()).departments).toEqual([{ id: "1", name: "Communications", parentId: null, ownerId: "2" }]);
    await b.remove("departments", "1");
    expect((await b.load()).departments).toEqual([]);
  });

  it("explains failures in plain language", async () => {
    const b = new GraphListsBackend("https://host/sites/Tracker", token, async () => new Response(JSON.stringify({ error: { code: "accessDenied" } }), { status: 403 }));
    await expect(b.load()).rejects.toThrow(/Ask the site owner/);
  });

  it("says when setup has not been run", async () => {
    const g = fakeGraph();
    const b = new GraphListsBackend("https://host/sites/Tracker", token, g.fetchFn);
    await expect(b.load()).rejects.toThrow(/run setup/);
  });
});
