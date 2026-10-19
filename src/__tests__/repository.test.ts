import { beforeEach, describe, expect, it } from "vitest";
import { MemoryBackend } from "@/data/memoryBackend";
import { PermissionError, ReasonRequiredError, Repository, RuleError } from "@/data/repository";
import { buildSeed, STANDARD_DEPARTMENTS, STANDARD_OUTPUT_TYPES } from "@/data/seed";
import { emptyDataSet, type DataSet, type Person } from "@/domain/types";

const TODAY = "2026-10-19";
const NOW = () => new Date("2026-10-19T14:00:00Z");

async function repoAs(personName: string, data: DataSet = buildSeed(TODAY)) {
  const backend = new MemoryBackend(data);
  const me = data.people.find((p) => p.name === personName) ?? null;
  const repo = new Repository(backend, me, me?.email ?? "nobody@example.org", NOW);
  await repo.refresh();
  return { repo, backend };
}

describe("projects", () => {
  let repo: Repository;
  beforeEach(async () => ({ repo } = await repoAs("Aaron")));

  it("creates a project with stages and logs it", async () => {
    const p = await repo.createProject(
      {
        title: "  New paper ", departmentId: "2", ownerId: "3", outputTypeIds: ["1"], milestone: "", horizon: "immediate",
        operationalDetails: "", startDate: "2026-11-01", dueDate: "2026-12-01", status: "notStarted", plannedBudget: 0, actualSpend: 0,
      },
      [{ name: "Research", ownerId: "3", departmentId: "2" }, { name: "Comms rollout", ownerId: "2", departmentId: "1" }],
    );
    expect(p.title).toBe("New paper");
    const stages = repo.data.stages.filter((s) => s.projectId === p.id);
    expect(stages.map((s) => s.status)).toEqual(["active", "pending"]);
    expect(repo.data.audit.some((a) => a.entityId === p.id && a.field === "created")).toBe(true);
  });

  it("requires a name, department, and owner", async () => {
    await expect(
      repo.createProject({
        title: "", departmentId: "x", ownerId: "x", outputTypeIds: [], milestone: "", horizon: "immediate", operationalDetails: "",
        startDate: null, dueDate: null, status: "notStarted", plannedBudget: 0, actualSpend: 0,
      }),
    ).rejects.toMatchObject({ problems: ["Give the project a name.", "Choose a department.", "Choose an owner."] });
  });

  it("refuses a date change without a reason", async () => {
    await expect(repo.updateProject("1", { dueDate: "2026-12-01" })).rejects.toBeInstanceOf(ReasonRequiredError);
    await expect(repo.updateProject("1", { dueDate: "2026-12-01" }, "   ")).rejects.toBeInstanceOf(ReasonRequiredError);
  });

  it("records date changes with reason and who made them", async () => {
    const before = repo.project("1").dueDate;
    await repo.updateProject("1", { dueDate: "2026-12-01", milestone: "Draft done" }, "Reviewer asked for more time");
    const entries = repo.data.audit.filter((a) => a.entityId === "1" && a.entityType === "project" && a.changedAt.startsWith("2026-10-19"));
    const due = entries.find((a) => a.field === "dueDate")!;
    expect(due).toMatchObject({ oldValue: before, newValue: "2026-12-01", reason: "Reviewer asked for more time", changedById: "3", changedByEmail: "aaron@example.org" });
    expect(entries.find((a) => a.field === "milestone")!.reason).toBe("");
  });

  it("does not log fields that did not change", async () => {
    const n = repo.data.audit.length;
    await repo.updateProject("1", { title: repo.project("1").title });
    expect(repo.data.audit.length).toBe(n);
  });

  it("logs budget changes to the budget log", async () => {
    await repo.updateProject("1", { plannedBudget: 15000, actualSpend: 5000 }, "Added a second reviewer");
    const log = repo.data.budgetChanges.filter((b) => b.projectId === "1");
    expect(log.map((b) => [b.field, b.oldValue, b.newValue, b.reason])).toEqual([
      ["planned", 12000, 15000, "Added a second reviewer"],
      ["actual", 4800, 5000, "Added a second reviewer"],
    ]);
  });

  it("refuses a start date after the due date", async () => {
    await expect(repo.updateProject("1", { startDate: "2027-06-01" }, "x")).rejects.toBeInstanceOf(RuleError);
  });

  it("deletes a project with its tasks, links, and stages", async () => {
    const { repo: admin } = await repoAs("Ike Harris");
    await admin.deleteProject("1");
    expect(admin.data.tasks.some((t) => t.projectId === "1")).toBe(false);
    expect(admin.data.dependencies.some((d) => ["1", "2", "3", "4", "5", "6"].includes(d.successorId))).toBe(false);
    expect(admin.data.stages.some((s) => s.projectId === "1")).toBe(false);
    expect(admin.data.projectLinks.some((l) => l.fromProjectId === "1")).toBe(false);
  });
});

describe("permissions", () => {
  it("lets a department owner edit any project in the department", async () => {
    const { repo } = await repoAs("Aaron"); // owns Research
    await repo.updateProject("3", { milestone: "x" }); // Dana's wargame, in Research
    expect(repo.project("3").milestone).toBe("x");
  });
  it("covers sub-departments", async () => {
    const { repo } = await repoAs("Jeremy"); // owns Ops, which holds Resourcing
    await repo.updateProject("6", { milestone: "x" });
    expect(repo.project("6").milestone).toBe("x");
  });
  it("lets members edit", async () => {
    const { repo } = await repoAs("Priya Raman (sample)"); // accepted member of project 1
    await repo.updateProject("1", { milestone: "x" });
  });
  it("blocks staff outside the project", async () => {
    const { repo } = await repoAs("Marcus Lee (sample)"); // invited, not accepted
    await expect(repo.updateProject("1", { milestone: "x" })).rejects.toBeInstanceOf(PermissionError);
  });
  it("blocks viewers from everything", async () => {
    const { repo } = await repoAs("Board Observer (sample)");
    await expect(repo.updateProject("1", { milestone: "x" })).rejects.toBeInstanceOf(PermissionError);
    await expect(repo.createMeeting({ title: "x", meetingType: "daily", date: TODAY, notes: "", attendeeIds: [] })).rejects.toBeInstanceOf(PermissionError);
  });
  it("keeps admin settings to admins", async () => {
    const { repo } = await repoAs("Aaron");
    await expect(repo.saveDepartment({ name: "Policy", parentId: null, ownerId: null })).rejects.toBeInstanceOf(PermissionError);
    await expect(repo.saveOutputType({ name: "Podcasts", active: true, sortOrder: 6 })).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("tasks and dependencies", () => {
  let repo: Repository;
  beforeEach(async () => ({ repo } = await repoAs("Aaron")));

  it("will not start a blocked task", async () => {
    // External review (4) waits on drafting (2, 3), both open.
    await expect(repo.updateTask("4", { status: "inProgress" })).rejects.toMatchObject({
      problems: [expect.stringMatching(/waiting on "Draft sections 1-3", "Draft sections 4-6"/)],
    });
  });

  it("starts it once predecessors finish, and stamps completion", async () => {
    await repo.updateTask("2", { status: "done" });
    await repo.updateTask("3", { status: "done" });
    await repo.updateTask("4", { status: "inProgress" });
    expect(repo.task("2").completedAt).toBe("2026-10-19T14:00:00.000Z");
    expect(repo.task("4").status).toBe("inProgress");
  });

  it("requires a reason for task date changes", async () => {
    await expect(repo.updateTask("5", { dueDate: "2026-11-15" })).rejects.toBeInstanceOf(ReasonRequiredError);
  });

  it("refuses dates that break the order", async () => {
    // Copyedit (5) may not run past the milestone (6) that waits on it.
    await expect(repo.updateTask("5", { dueDate: "2026-12-30" }, "late")).rejects.toBeInstanceOf(RuleError);
  });

  it("shifts downstream work with one reason", async () => {
    const moved = await repo.shiftWithDownstream("5", "2026-11-20", "Layout vendor delayed");
    expect(moved).toBeGreaterThan(0);
    expect(repo.task("5").dueDate).toBe("2026-11-20");
    expect(repo.task("6").startDate! >= "2026-11-20").toBe(true);
    const reasons = repo.data.audit.filter((a) => a.reason.startsWith("Layout vendor delayed"));
    expect(reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("adds dependencies and rejects loops", async () => {
    await expect(repo.addDependency("6", "1")).rejects.toBeInstanceOf(RuleError);
    const t = await repo.createTask({
      projectId: "1", title: "Press list", kind: "task", ownerId: "3", horizon: "immediate", startDate: "2026-11-20", dueDate: "2026-11-25",
      status: "notStarted", effortHours: 2, estimatedCost: 0, notes: "",
    });
    await repo.addDependency("6", t.id);
    expect(repo.data.dependencies.some((d) => d.predecessorId === "6" && d.successorId === t.id)).toBe(true);
  });

  it("checks ordering when a task is created with predecessors", async () => {
    await expect(
      repo.createTask({
        projectId: "1", title: "Too early", kind: "task", ownerId: "3", horizon: "immediate", startDate: TODAY, dueDate: TODAY,
        status: "notStarted", effortHours: 1, estimatedCost: 0, notes: "",
      }, ["5"]),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it("removes a task's links when it is deleted", async () => {
    await repo.deleteTask("4");
    expect(repo.data.dependencies.some((d) => d.predecessorId === "4" || d.successorId === "4")).toBe(false);
  });
});

describe("stage handoff", () => {
  it("hands the project to the next stage's owner and department", async () => {
    const { repo } = await repoAs("Aaron");
    const { next } = await repo.completeStage("1", "1", "Research complete; Comms takes over");
    expect(next?.name).toBe("Comms rollout");
    expect(repo.project("1")).toMatchObject({ ownerId: "2", departmentId: "1" });
    expect(repo.data.stages.find((s) => s.id === "2")!.status).toBe("active");
    expect(repo.data.audit.some((a) => a.field === "ownerId" && a.reason.includes("Stage handoff"))).toBe(true);
  });
  it("refuses to complete a stage out of order", async () => {
    const { repo } = await repoAs("Aaron");
    await expect(repo.completeStage("1", "2")).rejects.toThrow(/has not started/);
  });
  it("marks the project done after the last stage", async () => {
    const { repo } = await repoAs("Ike Harris");
    await repo.completeStage("1", "1");
    await repo.completeStage("1", "2");
    expect(repo.project("1").status).toBe("done");
  });
});

describe("people on projects", () => {
  it("invites others and lets them accept", async () => {
    const { repo, backend } = await repoAs("Aaron");
    const m = await repo.invite("project", "1", "4");
    expect(m.status).toBe("invited");
    const jeremy = repo.data.people.find((p) => p.name === "Jeremy") as Person;
    const r2 = new Repository(backend, jeremy, jeremy.email, NOW);
    await r2.refresh();
    await r2.respond(m.id, "accepted");
    expect(r2.data.memberships.find((x) => x.id === m.id)!.status).toBe("accepted");
  });
  it("joining yourself is accepted at once", async () => {
    const { repo } = await repoAs("Aaron");
    expect((await repo.invite("task", "17", "3")).status).toBe("invited"); // already invited in seed
    expect((await repo.invite("project", "4", "3")).status).toBe("accepted");
  });
});

describe("admin", () => {
  it("adds sub-departments and refuses loops", async () => {
    const { repo } = await repoAs("Ike Harris");
    await repo.saveDepartment({ name: "Digital", parentId: "1", ownerId: "2" });
    const digital = repo.data.departments.find((d) => d.name === "Digital")!;
    await expect(repo.saveDepartment({ name: "Comms", parentId: digital.id, ownerId: "2" }, "1")).rejects.toThrow(/under itself/);
  });
  it("will not delete a department in use", async () => {
    const { repo } = await repoAs("Ike Harris");
    await expect(repo.deleteDepartment("2")).rejects.toBeInstanceOf(RuleError);
  });
  it("keeps output types that projects use", async () => {
    const { repo } = await repoAs("Ike Harris");
    await expect(repo.deleteOutputType("1")).rejects.toBeInstanceOf(RuleError);
    await repo.saveOutputType({ name: "Podcasts", active: true, sortOrder: 6 });
    expect(repo.data.outputTypes.map((o) => o.name)).toContain("Podcasts");
  });
  it("validates people", async () => {
    const { repo } = await repoAs("Ike Harris");
    await expect(repo.savePerson({ name: "X", email: "AARON@example.org", role: "staff", departmentId: null, weeklyCapacityHours: 30, active: true }))
      .rejects.toMatchObject({ problems: ["Someone already uses that email."] });
    await expect(repo.savePerson({ ...repo.me!, role: "staff" }, repo.me!.id)).rejects.toThrow(/own admin role/);
  });
  it("bootstraps an empty site", async () => {
    const backend = new MemoryBackend(emptyDataSet());
    const repo = new Repository(backend, null, "first@example.org", NOW);
    await repo.bootstrap("First Admin", "First@Example.org", { departments: STANDARD_DEPARTMENTS, outputTypes: STANDARD_OUTPUT_TYPES });
    const data = await backend.load();
    expect(data.people).toMatchObject([{ email: "first@example.org", role: "admin" }]);
    expect(data.departments.map((d) => d.name)).toEqual(STANDARD_DEPARTMENTS);
    expect(data.outputTypes).toHaveLength(5);
  });
});
