import { describe, expect, it } from "vitest";
import type { Task } from "@/domain/types";
import { dueFlag, inReview, reviewWindow } from "@/domain/flags";
import { bookedHours, hoursInWindow, loadLevel, personLoad } from "@/domain/load";
import { addDays, endOfQuarter, startOfWeek, workdaysBetween } from "@/domain/dates";
import { buildSeed } from "@/data/seed";

const TODAY = "2026-10-19"; // Monday

const task = (over: Partial<Task> = {}): Task => ({
  id: "t", projectId: "p", title: "T", kind: "task", ownerId: "1", horizon: "immediate", startDate: null, dueDate: null,
  status: "notStarted", effortHours: 10, estimatedCost: 0, notes: "", sourceMeetingId: null, completedAt: null, ...over,
});

describe("dates", () => {
  it("counts weekdays", () => {
    expect(workdaysBetween("2026-10-19", "2026-10-25")).toBe(5);
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19");
    expect(endOfQuarter("2026-11-03")).toBe("2026-12-31");
  });
});

describe("dueFlag", () => {
  it("flags overdue, due within a week, and nothing else", () => {
    expect(dueFlag("2026-10-18", "inProgress", TODAY)).toBe("overdue");
    expect(dueFlag(TODAY, "notStarted", TODAY)).toBe("dueSoon");
    expect(dueFlag("2026-10-26", "notStarted", TODAY)).toBe("dueSoon");
    expect(dueFlag("2026-10-27", "notStarted", TODAY)).toBe(null);
    expect(dueFlag("2026-10-01", "done", TODAY)).toBe(null);
    expect(dueFlag(null, "notStarted", TODAY)).toBe(null);
  });
});

describe("review windows", () => {
  it("covers the right ranges", () => {
    expect(reviewWindow("monthly", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(reviewWindow("quarterly", TODAY)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(reviewWindow("all", TODAY)).toBe(null);
  });
  it("always includes overdue work and shows finished work in longer reviews", () => {
    expect(inReview({ dueDate: "2025-01-01", status: "notStarted" }, "daily", TODAY)).toBe(true);
    expect(inReview({ dueDate: "2027-05-01", status: "notStarted" }, "quarterly", TODAY)).toBe(false);
    expect(inReview({ dueDate: "2026-10-05", status: "done", completedAt: "2026-10-06T10:00:00Z" }, "monthly", TODAY)).toBe(true);
    expect(inReview({ dueDate: "2026-10-05", status: "done", completedAt: "2026-10-06T10:00:00Z" }, "daily", TODAY)).toBe(false);
    expect(inReview({ dueDate: null, status: "inProgress" }, "daily", TODAY)).toBe(true);
  });
});

describe("hours", () => {
  it("spreads effort over weekdays", () => {
    const t = task({ startDate: TODAY, dueDate: "2026-10-30", effortHours: 10 }); // 10 weekdays
    expect(hoursInWindow(t, TODAY, "2026-10-25", TODAY)).toBeCloseTo(5);
  });
  it("puts all late work in today", () => {
    const t = task({ dueDate: "2026-10-01", effortHours: 6 });
    expect(hoursInWindow(t, TODAY, TODAY, TODAY)).toBe(6);
  });
  it("starts counting from the task's start date", () => {
    const t = task({ startDate: "2026-10-26", dueDate: "2026-10-30" });
    expect(hoursInWindow(t, TODAY, "2026-10-23", TODAY)).toBe(0);
  });
  it("handles weekend-only work", () => {
    const t = task({ startDate: "2026-10-24", dueDate: "2026-10-25", effortHours: 4 });
    expect(hoursInWindow(t, "2026-10-24", "2026-10-24", TODAY)).toBe(2);
  });
  it("ignores finished work and other owners", () => {
    const tasks = [task({ status: "done", dueDate: "2026-10-20" }), task({ ownerId: "2", dueDate: "2026-10-20" })];
    expect(bookedHours("1", tasks, TODAY, addDays(TODAY, 6), TODAY)).toBe(0);
  });
});

describe("personLoad", () => {
  it("summarizes a person from the sample data", () => {
    const data = buildSeed(TODAY);
    const aaron = data.people.find((p) => p.name === "Aaron")!;
    const l = personLoad(aaron, data, TODAY);
    expect(l.openTasks.map((t) => t.title)).toContain("Draft sections 1-3");
    expect(l.overdue.map((t) => t.title)).toEqual(["Draft sections 1-3"]);
    expect(l.blockedCount).toBeGreaterThan(0); // External review waits on drafting
    expect(l.hoursNext7).toBeGreaterThan(0);
    expect(l.capacityNext7).toBe(32);
  });
  it("grades utilization", () => {
    expect(loadLevel(0.2)).toBe("light");
    expect(loadLevel(0.6)).toBe("steady");
    expect(loadLevel(0.9)).toBe("high");
    expect(loadLevel(1.2)).toBe("over");
  });
});

describe("org chart reporting lines", async () => {
  const { effectiveManagers, roleLabel } = await import("@/domain/permissions");
  const data = buildSeed(TODAY);
  it("uses Reports to, then falls back to the department owner", () => {
    const people = data.people.map((p) => (p.name === "Dana Ortiz (sample)" ? { ...p, managerId: null } : p));
    const m = effectiveManagers(people, data.departments);
    expect(m.get("5")).toBe("3"); // Dana -> Research owner Aaron
    expect(m.get("9")).toBe("4"); // Taylor -> Jeremy (set)
    expect(m.get("1")).toBe(null); // Ike at the top
  });
  it("breaks reporting loops instead of hanging", () => {
    const people = data.people.map((p) => (p.id === "1" ? { ...p, managerId: "3" } : p));
    const m = effectiveManagers(people, data.departments);
    const seen = new Set<string>();
    let cur: string | null = "3";
    while (cur && !seen.has(cur)) (seen.add(cur), (cur = m.get(cur) ?? null));
    expect(cur).toBe(null);
  });
  it("labels leads with their departments", () => {
    expect(roleLabel(data.people.find((p) => p.id === "6")!, data.departments)).toBe("Department Task Lead (Research)");
  });
});
