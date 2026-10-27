import { describe, expect, it } from "vitest";
import type { Person, Project, Task } from "@/domain/types";
import { checkAssignment, suggestOwners, type AssignmentProposal } from "@/domain/conflicts";

const TODAY = "2026-10-19"; // a Monday

const person = (id: string, over: Partial<Person> = {}): Person => ({
  id, name: `P${id}`, email: `${id}@example.org`, role: "staff", departmentId: null, weeklyCapacityHours: 40, active: true, managerId: null, leadDepartmentIds: [], ...over,
});
const project = (over: Partial<Project> = {}): Project => ({
  id: "pr", title: "Paper", lineOfEffortId: null, departmentId: "d", ownerId: "1", outputTypeIds: [],
  operationalDetails: "", startDate: null, dueDate: null, status: "inProgress", plannedBudget: 10000, actualSpend: 0,
  createdAt: "", createdById: null, ...over,
});
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, projectId: "pr", title: `T${id}`, kind: "task", ownerId: "1", startDate: null, dueDate: null,
  status: "notStarted", effortHours: 0, estimatedCost: 0, notes: "", sourceMeetingId: null, parentTaskId: null, durationDays: 0, completedAt: null, ...over,
});
const proposal = (over: Partial<AssignmentProposal> = {}): AssignmentProposal => ({
  title: "New", ownerId: "1", projectId: "pr", startDate: TODAY, dueDate: "2026-10-23", effortHours: 0, estimatedCost: 0, predecessorIds: [], ...over,
});
const ctx = (tasks: Task[] = [], over: { people?: Person[]; projects?: Project[] } = {}) => ({
  people: over.people ?? [person("1"), person("2")],
  projects: over.projects ?? [project()],
  tasks,
  dependencies: [],
});

const kinds = (c: ReturnType<typeof checkAssignment>) => c.map((x) => `${x.kind}:${x.severity}`);

describe("checkAssignment", () => {
  it("finds nothing for a clean assignment", () => {
    expect(checkAssignment(proposal({ effortHours: 4, estimatedCost: 100 }), ctx(), TODAY)).toEqual([]);
  });

  it("flags a due date in the past and start after due", () => {
    const c = checkAssignment(proposal({ startDate: "2026-10-20", dueDate: "2026-10-15" }), ctx(), TODAY);
    expect(kinds(c)).toContain("timing:conflict");
    expect(kinds(c)).toContain("input:conflict");
  });

  describe("timing", () => {
    it("warns about deadlines within two days", () => {
      const c = checkAssignment(proposal(), ctx([task("a", { dueDate: "2026-10-22" })]), TODAY);
      expect(kinds(c)).toEqual(["timing:warning"]);
      expect(c[0].message).toMatch(/1 other deadline/);
    });
    it("calls three or more nearby deadlines a conflict", () => {
      const tasks = ["2026-10-21", "2026-10-23", "2026-10-25"].map((d, i) => task(String(i), { dueDate: d }));
      expect(kinds(checkAssignment(proposal(), ctx(tasks), TODAY))).toEqual(["timing:conflict"]);
    });
    it("ignores finished work and other people", () => {
      const tasks = [task("a", { dueDate: "2026-10-23", status: "done" }), task("b", { dueDate: "2026-10-23", ownerId: "2" })];
      expect(checkAssignment(proposal(), ctx(tasks), TODAY)).toEqual([]);
    });
    it("warns when the owner is at an event in the window", () => {
      const ev = task("e", { kind: "event", startDate: "2026-10-21", dueDate: "2026-10-21" });
      const c = checkAssignment(proposal(), ctx([ev]), TODAY);
      expect(c.map((x) => x.message).join()).toMatch(/is at "Te"/);
    });
  });

  describe("resourcing", () => {
    it("flags work over capacity", () => {
      // Mon-Fri, 40 h/week capacity: 30 existing + 15 new = 45 > 40.
      const existing = task("a", { startDate: TODAY, dueDate: "2026-10-30", effortHours: 60 }); // 30 h in this week
      const c = checkAssignment(proposal({ effortHours: 15 }), ctx([existing]), TODAY);
      const r = c.find((x) => x.kind === "resourcing")!;
      expect(r.severity).toBe("conflict");
      expect(r.message).toMatch(/over by 5 h/);
    });
    it("warns near capacity", () => {
      const c = checkAssignment(proposal({ effortHours: 35 }), ctx(), TODAY);
      expect(kinds(c)).toEqual(["resourcing:warning"]);
    });
    it("flags inactive owners", () => {
      const c = checkAssignment(proposal(), ctx([], { people: [person("1", { active: false })] }), TODAY);
      expect(kinds(c)).toEqual(["resourcing:conflict"]);
    });
  });

  describe("money", () => {
    it("flags going over the planned budget, counting open task costs", () => {
      const tasks = [task("a", { estimatedCost: 3000 }), task("b", { estimatedCost: 9999, status: "done" })];
      const c = checkAssignment(proposal({ estimatedCost: 2500 }), ctx(tasks, { projects: [project({ actualSpend: 5000 })] }), TODAY);
      const m = c.find((x) => x.kind === "money")!;
      expect(m.severity).toBe("conflict");
      expect(m.message).toMatch(/\$10,500 .* \$10,000 planned \(over by \$500\)/);
    });
    it("warns at 90% of budget", () => {
      const c = checkAssignment(proposal({ estimatedCost: 9200 }), ctx(), TODAY);
      expect(kinds(c)).toEqual(["money:warning"]);
    });
    it("warns when the project has no budget", () => {
      const c = checkAssignment(proposal({ estimatedCost: 50 }), ctx([], { projects: [project({ plannedBudget: 0 })] }), TODAY);
      expect(c[0].message).toMatch(/no planned budget/);
    });
  });

  it("flags starting before a predecessor is due", () => {
    const pre = task("a", { dueDate: "2026-10-22", ownerId: "2" });
    const c = checkAssignment(proposal({ predecessorIds: ["a"] }), ctx([pre]), TODAY);
    expect(kinds(c)).toEqual(["ordering:conflict"]);
    expect(c[0].message).toMatch(/Earliest start: Oct 22/);
  });

  it("warns when due after the project ends", () => {
    const c = checkAssignment(proposal(), ctx([], { projects: [project({ dueDate: "2026-10-21" })] }), TODAY);
    expect(kinds(c)).toEqual(["timing:warning"]);
  });
});

describe("suggestOwners", () => {
  it("suggests people with room, most room first", () => {
    const busy = task("a", { ownerId: "2", startDate: TODAY, dueDate: "2026-10-23", effortHours: 30 });
    const people = [person("1"), person("2"), person("3", { weeklyCapacityHours: 20 }), person("4", { role: "viewer" })];
    const s = suggestOwners(proposal({ effortHours: 8 }), ctx([busy], { people }), TODAY);
    expect(s.map((x) => x.person.id)).toEqual(["3", "2"]);
  });
});
