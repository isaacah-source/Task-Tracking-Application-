import { describe, expect, it } from "vitest";
import type { Dependency, Task } from "@/domain/types";
import {
  blockedTaskIds, blockers, cascadeShift, dependencyProblems, earliestStart, isBlocked, orderingProblems, topoOrder, wouldCreateCycle,
} from "@/domain/dependencies";

const t = (id: string, over: Partial<Task> = {}): Task => ({
  id, projectId: "p", title: `T${id}`, kind: "task", ownerId: null, startDate: null, dueDate: null,
  status: "notStarted", effortHours: 0, estimatedCost: 0, notes: "", sourceMeetingId: null, parentTaskId: null, completedAt: null, ...over,
});
const dep = (p: string, s: string, id = `${p}-${s}`): Dependency => ({ id, predecessorId: p, successorId: s });

describe("cycles", () => {
  const deps = [dep("a", "b"), dep("b", "c")];
  it("rejects a self link", () => expect(wouldCreateCycle(deps, "a", "a")).toBe(true));
  it("rejects a link that closes a loop", () => expect(wouldCreateCycle(deps, "c", "a")).toBe(true));
  it("allows a link that does not", () => expect(wouldCreateCycle(deps, "a", "c")).toBe(false));
  it("handles diamonds without false alarms", () => {
    const d = [dep("a", "b"), dep("a", "c"), dep("b", "d"), dep("c", "d")];
    expect(wouldCreateCycle(d, "a", "d")).toBe(false);
    expect(wouldCreateCycle(d, "d", "a")).toBe(true);
  });
});

describe("blocked tasks", () => {
  const tasks = [t("a", { status: "done" }), t("b"), t("c")];
  const deps = [dep("a", "b"), dep("b", "c")];
  it("is free once every predecessor is done", () => expect(isBlocked(tasks[1], tasks, deps)).toBe(false));
  it("is blocked while a predecessor is open", () => {
    expect(isBlocked(tasks[2], tasks, deps)).toBe(true);
    expect(blockers(tasks[2], tasks, deps).map((x) => x.id)).toEqual(["b"]);
  });
  it("lists every blocked task", () => expect([...blockedTaskIds(tasks, deps)]).toEqual(["c"]));
  it("never flags a finished task as blocked", () => {
    expect(isBlocked(t("c", { status: "done" }), tasks, deps)).toBe(false);
  });
});

describe("ordering rules", () => {
  const a = t("a", { startDate: "2026-01-01", dueDate: "2026-01-10" });
  const b = t("b", { startDate: "2026-01-11", dueDate: "2026-01-20" });
  const deps = [dep("a", "b")];

  it("accepts dates that respect the link", () => expect(orderingProblems(b, [a, b], deps)).toEqual([]));
  it("refuses starting before the predecessor is due", () => {
    const p = orderingProblems({ ...b, startDate: "2026-01-05" }, [a, b], deps);
    expect(p).toHaveLength(1);
    expect(p[0].message).toMatch(/before "Ta" is due/);
  });
  it("refuses moving a predecessor past its successor's start", () => {
    const p = orderingProblems({ ...a, dueDate: "2026-01-15" }, [a, b], deps);
    expect(p[0].message).toMatch(/after "Tb" starts/);
  });
  it("refuses starting work while a predecessor is open", () => {
    const p = orderingProblems({ ...b, status: "inProgress" }, [a, b], deps);
    expect(p[0].message).toMatch(/waiting on "Ta"/);
  });
  it("allows it once the predecessor is done", () => {
    expect(orderingProblems({ ...b, status: "inProgress" }, [{ ...a, status: "done" }, b], deps)).toEqual([]);
  });
  it("uses the due date when there is no start date", () => {
    const p = orderingProblems({ ...b, startDate: null, dueDate: "2026-01-09" }, [a, b], deps);
    expect(p.length).toBeGreaterThan(0);
  });
});

describe("new links", () => {
  it("rejects duplicates, loops, and bad dates", () => {
    const a = t("a", { dueDate: "2026-02-10" });
    const b = t("b", { startDate: "2026-02-01" });
    expect(dependencyProblems(a, b, [])).toEqual([expect.stringMatching(/before "Ta" is due/)]);
    expect(dependencyProblems(a, t("c"), [dep("a", "c")])).toContain("These tasks are already linked.");
    expect(dependencyProblems(t("c"), a, [dep("a", "c")])[0]).toMatch(/loop/);
  });
  it("rejects making in-progress work wait on unfinished work", () => {
    expect(dependencyProblems(t("a"), t("b", { status: "inProgress" }), [])[0]).toMatch(/under way/);
  });
});

describe("order and shifting", () => {
  const tasks = [
    t("c", { dueDate: "2026-03-01" }),
    t("a", { dueDate: "2026-01-01" }),
    t("b", { dueDate: "2026-02-01" }),
    t("x", { dueDate: "2025-12-01" }),
  ];
  const deps = [dep("a", "b"), dep("b", "c")];
  it("puts predecessors first, then due date", () => {
    expect(topoOrder(tasks, deps).map((x) => x.id)).toEqual(["x", "a", "b", "c"]);
  });
  it("finds the earliest start", () => expect(earliestStart("b", tasks, deps)).toBe("2026-01-01"));

  it("pushes downstream work later and keeps durations", () => {
    const ts = [
      t("a", { startDate: "2026-01-01", dueDate: "2026-01-10" }),
      t("b", { startDate: "2026-01-10", dueDate: "2026-01-15" }),
      t("c", { startDate: "2026-01-16", dueDate: "2026-01-20" }),
    ];
    const moves = cascadeShift("a", "2026-01-14", ts, deps);
    expect(moves).toEqual([
      { taskId: "b", startDate: "2026-01-14", dueDate: "2026-01-19" },
      { taskId: "c", startDate: "2026-01-19", dueDate: "2026-01-23" },
    ]);
  });
  it("moves nothing when there is room", () => {
    const ts = [t("a", { dueDate: "2026-01-10" }), t("b", { startDate: "2026-01-20", dueDate: "2026-01-25" })];
    expect(cascadeShift("a", "2026-01-12", ts, [dep("a", "b")])).toEqual([]);
  });
});
