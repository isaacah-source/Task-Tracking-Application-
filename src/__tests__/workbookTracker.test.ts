import { describe, expect, it } from "vitest";
import {
  PROJECT_HEADERS, WorkbookRelationshipTracker, columnLetter, mergeInvolvement, organizationsFrom, parseMaster, rangeStart,
} from "@/integrations/relationships/workbook";
import type { ProjectInvolvement } from "@/integrations/relationships/adapter";

// Header order and extra columns as in the real tracker workbook (columns are found by name).
const MASTER = [
  ["Unique ID", "Name", "Organization", "Relationship Type", "Status", "Relationship Owner", "Email", "Notes", "Title"],
  [101, "Jane Doe", "Sample Lab", "AI Labs", "Cultivating", "Ike Harris", "jane@example.org", "", "Head of Policy"],
  [102, "John Roe", "Sample Committee", "Congress", "", "", "", "", ""],
  ["", "Blank ID row", "", "", "", "", "", "", ""],
  [103, "Ann Poe", "Sample Lab", "Research/Institutional Partners", "", "", "", "", ""],
  [104, "Bo Lee", "sample lab", "AI Labs", "", "", "", "", ""],
];

const inv = (over: Partial<ProjectInvolvement> = {}): ProjectInvolvement => ({
  externalId: "101", contactName: "Jane Doe", projectId: "7", projectTitle: "Paper", projectStatus: "In progress",
  ownerEmail: "aaron@example.org", role: "Reviewer", active: true, projectUrl: "https://app/projects/7", ...over,
});

describe("reading the Master tab", () => {
  it("maps columns by header and skips rows without an ID", () => {
    const c = parseMaster(MASTER);
    expect(c.map((x) => x.externalId)).toEqual(["101", "102", "103", "104"]);
    expect(c[0]).toEqual({ externalId: "101", name: "Jane Doe", title: "Head of Policy", organization: "Sample Lab", relationshipType: "AI Labs", email: "jane@example.org" });
  });
  it("refuses a tab without its key columns", () => {
    expect(() => parseMaster([["Name"], ["x"]])).toThrow(/Unique ID/);
  });
  it("builds organizations from contacts, merging spellings, with their most common type", () => {
    const orgs = organizationsFrom(parseMaster(MASTER));
    expect(orgs).toEqual([
      { externalId: "org:sample committee", name: "Sample Committee", relationshipType: "Congress" },
      { externalId: "org:sample lab", name: "Sample Lab", relationshipType: "AI Labs" },
    ]);
  });
  it("handles ranges that do not start at A1", () => {
    expect(rangeStart("Master!B3:K40")).toEqual({ col: 1, row: 2 });
    expect(columnLetter(9)).toBe("J");
    expect(columnLetter(27)).toBe("AB");
  });
});

describe("writing the FSI Projects tab", () => {
  it("adds headers and appends new rows", () => {
    const t = mergeInvolvement([], [inv()], "2026-10-20T12:00:00.000Z");
    expect(t[0]).toEqual([...PROJECT_HEADERS]);
    expect(t[1]).toEqual(["101", "Jane Doe", "7", "Paper", "In progress", "aaron@example.org", "Reviewer", "Yes", "https://app/projects/7", "2026-10-20T12:00:00.000Z"]);
  });
  it("updates the row for the same contact and project instead of adding another", () => {
    const first = mergeInvolvement([], [inv(), inv({ externalId: "102", contactName: "John Roe" })], "t1");
    const next = mergeInvolvement(first, [inv({ active: false })], "t2");
    expect(next).toHaveLength(3);
    expect(next[1][7]).toBe("No");
    expect(next[1][9]).toBe("t2");
    expect(next[2][0]).toBe("102");
  });
});

/** A fake of the Graph calls the adapter makes. */
function fakeGraph(opts: { master?: unknown[][]; masterAddress?: string; projectsSheet?: boolean } = {}) {
  const calls: { method: string; url: string; body?: any; auth?: string }[] = [];
  let projects: unknown[][] | null = opts.projectsSheet ? [] : null;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = String(url).replace("https://graph.microsoft.com/v1.0", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", url: u, body, auth: (init?.headers as Record<string, string>).Authorization });
    if (u.startsWith("/shares/")) return json({ id: "FOLDER", name: "Tracker", folder: {}, parentReference: { driveId: "D" } });
    if (u.includes("/items/FOLDER/children")) {
      return json({ value: [
        { id: "X1", name: "Notes.docx", file: {}, parentReference: { driveId: "D" } },
        { id: "WB", name: "FSI_Relationship_Tracker.xlsx", file: {}, parentReference: { driveId: "D" } },
        { id: "X2", name: "Old copy.xlsx", file: {}, parentReference: { driveId: "D" } },
      ] });
    }
    if (u.includes("/worksheets/Master/usedRange")) return json({ address: opts.masterAddress ?? "Master!A1:I6", values: opts.master ?? MASTER });
    if (u.includes("/worksheets/FSI%20Projects/usedRange")) {
      return projects === null ? json({ error: { code: "ItemNotFound" } }, 404) : json({ address: "'FSI Projects'!A1:A1", values: projects.length ? projects : [[""]] });
    }
    if (u.endsWith("/worksheets/add")) {
      projects = [];
      return json({ name: body.name }, 201);
    }
    if (u.includes("/worksheets/FSI%20Projects/range")) {
      projects = body.values;
      return json({});
    }
    return json({ error: { code: "itemNotFound" } }, 404);
  }) as typeof fetch;
  return { calls, fetchFn, projects: () => projects };
}

const token = async (scopes: string[]) => `t:${scopes.join(",")}`;

describe("WorkbookRelationshipTracker", () => {
  it("finds the tracker workbook in the shared folder and reads contacts", async () => {
    const g = fakeGraph();
    const t = new WorkbookRelationshipTracker("https://org.sharepoint.com/:f:/s/x", undefined, token, g.fetchFn);
    const contacts = await t.listContacts();
    expect(contacts).toHaveLength(4);
    expect(g.calls.some((c) => c.url.includes("/items/WB/workbook/worksheets/Master"))).toBe(true);
    expect(g.calls[0].auth).toBe("Bearer t:Files.ReadWrite.All");
  });

  it("uses the configured workbook name when the folder has several", async () => {
    const g = fakeGraph();
    const t = new WorkbookRelationshipTracker("https://x", "old copy.xlsx", token, g.fetchFn);
    await t.listContacts();
    expect(g.calls.some((c) => c.url.includes("/items/X2/workbook"))).toBe(true);
  });

  it("reads a Master tab that does not start in A1", async () => {
    const g = fakeGraph({ masterAddress: "Master!B2:J7" });
    const contacts = await new WorkbookRelationshipTracker("https://x", undefined, token, g.fetchFn).listContacts();
    expect(contacts[0].name).toBe("Jane Doe");
  });

  it("creates the FSI Projects tab on first push, then updates rows in place", async () => {
    const g = fakeGraph();
    const t = new WorkbookRelationshipTracker("https://x", undefined, token, g.fetchFn, () => new Date("2026-10-20T12:00:00Z"));
    await t.pushInvolvement([inv()]);
    expect(g.calls.some((c) => c.method === "POST" && c.url.endsWith("/worksheets/add") && c.body.name === "FSI Projects")).toBe(true);
    expect(g.projects()).toHaveLength(2);
    await t.pushInvolvement([inv({ active: false })]);
    expect(g.projects()).toHaveLength(2);
    expect(g.projects()![1][7]).toBe("No");
    const write = g.calls.filter((c) => c.method === "PATCH").at(-1)!;
    expect(write.url).toContain("range(address='A1:J2')");
  });

  it("explains access problems in plain language", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: { code: "accessDenied" } }), { status: 403 })) as typeof fetch;
    await expect(new WorkbookRelationshipTracker("https://x", undefined, token, fetchFn).listContacts()).rejects.toThrow(/share the folder/);
  });
});
