import { describe, expect, it } from "vitest";
import { buildSeed } from "@/data/seed";
import { buildDisplay, defaultDisplayOptions, optionsFromQuery, optionsToQuery, PRESETS, type DisplayOptions } from "@/domain/display";

const TODAY = "2026-10-19";
const data = buildSeed(TODAY);
const opts = (o: Partial<DisplayOptions> = {}): DisplayOptions => ({ ...defaultDisplayOptions(), ...o });
const titles = (r: ReturnType<typeof buildDisplay>) => r.tasks.map((t) => t.title);

describe("meeting display", () => {
  it("shows open work across the org by default", () => {
    const r = buildDisplay(data, opts(), TODAY);
    expect(r.tasks.every((t) => t.status !== "done")).toBe(true);
    expect(r.projects).toHaveLength(data.projects.length);
  });

  it("limits a department meeting to that department and its sub-departments, open and done", () => {
    const research = buildDisplay(data, opts({ scope: "department", departmentId: "2", status: "all" }), TODAY);
    expect(new Set(research.projects.map((p) => p.title))).toEqual(new Set([
      "U.S.-China Strategic AI: Paper 1", "Frontier AI crisis wargame", "Compute export controls explainer",
    ]));
    expect(titles(research)).toContain("Literature review"); // done
    const ops = buildDisplay(data, opts({ scope: "department", departmentId: "3" }), TODAY);
    expect(ops.projects.map((p) => p.title)).toContain("Fellowship hiring round"); // in Resourcing, under Ops
  });

  it("shows done work only when asked", () => {
    const r = buildDisplay(data, opts({ status: "closed" }), TODAY);
    expect(r.tasks.length).toBeGreaterThan(0);
    expect(r.tasks.every((t) => t.status === "done")).toBe(true);
  });

  it("filters by people and by kind", () => {
    const r = buildDisplay(data, opts({ scope: "people", personIds: ["4"], kinds: ["task"] }), TODAY);
    expect(r.tasks.every((t) => t.ownerId === "4" && t.kind === "task")).toBe(true);
    expect(titles(r)).toContain("Book venue");
  });

  it("keeps overdue open work in a next-N-days window and drops later work", () => {
    const r = buildDisplay(data, opts({ window: "next7", includeUndated: false }), TODAY);
    expect(titles(r)).toContain("Draft sections 1-3"); // overdue
    expect(titles(r)).toContain("Briefing 2: compute governance"); // due in 3 days
    expect(titles(r)).not.toContain("Wargame day"); // 70 days out
  });

  it("matches tasks whose dates overlap a custom range", () => {
    const r = buildDisplay(data, opts({ status: "all", window: "custom", from: "2026-11-15", to: "2026-11-30" }), TODAY);
    expect(titles(r)).toContain("Recruit players"); // Oct 26 to Nov 23
    expect(titles(r)).not.toContain("Book venue");
  });

  it("shows only overdue work for the overdue window", () => {
    const r = buildDisplay(data, opts({ window: "overdue" }), TODAY);
    expect(titles(r).sort()).toEqual(["Book venue", "Draft sections 1-3"]);
  });

  it("groups by person with unassigned last, and counts flags", () => {
    const r = buildDisplay(data, opts({ groupBy: "person" }), TODAY);
    const labels = r.groups.map((g) => g.label);
    expect(labels).toEqual([...labels].sort((a, b) => (a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b))));
    expect(r.stats.overdue).toBe(2);
    expect(r.stats.open).toBe(r.stats.total);
  });

  it("keeps task order within a project so the timeline reads left to right", () => {
    const r = buildDisplay(data, opts({ status: "all", groupBy: "project" }), TODAY);
    const paper = r.groups.find((g) => g.label.startsWith("U.S.-China"))!.tasks.map((t) => t.title);
    expect(paper.indexOf("Draft sections 1-3")).toBeLessThan(paper.indexOf("External review"));
  });

  it("lists unfinished projects first, soonest due first", () => {
    const r = buildDisplay(data, opts({ scope: "department", departmentId: "2", status: "all" }), TODAY);
    expect(r.groups.map((g) => g.label)).toEqual([
      "U.S.-China Strategic AI: Paper 1", "Frontier AI crisis wargame", "Compute export controls explainer",
    ]);
  });

  it("groups by line of effort", () => {
    const r = buildDisplay(data, opts({ status: "all", groupBy: "lineOfEffort" }), TODAY);
    expect(r.groups.map((g) => g.label)).toContain("U.S.-China AI competition");
    const g = r.groups.find((x) => x.label === "U.S.-China AI competition")!;
    expect(new Set(g.tasks.map((t) => t.projectId))).toEqual(new Set(["1", "2", "7"]));
  });

  it("round-trips choices through the page address", () => {
    const o = opts({ title: "Research weekly", scope: "people", personIds: ["3", "5"], kinds: ["task", "event"], showGantt: false, window: "custom", from: "2026-11-01", to: "2026-11-30" });
    expect(optionsFromQuery(optionsToQuery(o))).toEqual(o);
    expect(optionsToQuery(defaultDisplayOptions())).toBe("");
  });

  it("has presets that apply cleanly", () => {
    for (const p of PRESETS) expect(() => buildDisplay(data, opts({ ...p.options, departmentId: "2" }), TODAY)).not.toThrow();
  });
});
