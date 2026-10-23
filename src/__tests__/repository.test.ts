import { beforeEach, describe, expect, it } from "vitest";
import { MemoryBackend } from "@/data/memoryBackend";
import { PermissionError, ReasonRequiredError, Repository, RuleError, meetingOrigin } from "@/data/repository";
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
        title: "  New paper ", lineOfEffortId: "1", departmentId: "2", ownerId: "3", outputTypeIds: ["1"],
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
        title: "", lineOfEffortId: null, departmentId: "x", ownerId: "x", outputTypeIds: [], operationalDetails: "",
        startDate: null, dueDate: null, status: "notStarted", plannedBudget: 0, actualSpend: 0,
      }),
    ).rejects.toMatchObject({ problems: ["Give the project a name.", "Choose a line of effort.", "Choose a department.", "Choose an owner."] });
  });

  it("refuses a date change without a reason", async () => {
    await expect(repo.updateProject("1", { dueDate: "2026-12-01" })).rejects.toBeInstanceOf(ReasonRequiredError);
    await expect(repo.updateProject("1", { dueDate: "2026-12-01" }, "   ")).rejects.toBeInstanceOf(ReasonRequiredError);
  });

  it("records date changes with reason and who made them", async () => {
    const before = repo.project("1").dueDate;
    await repo.updateProject("1", { dueDate: "2026-12-01", operationalDetails: "Draft done" }, "Reviewer asked for more time");
    const entries = repo.data.audit.filter((a) => a.entityId === "1" && a.entityType === "project" && a.changedAt.startsWith("2026-10-19"));
    const due = entries.find((a) => a.field === "dueDate")!;
    expect(due).toMatchObject({ oldValue: before, newValue: "2026-12-01", reason: "Reviewer asked for more time", changedById: "3", changedByEmail: "aaron@example.org" });
    expect(entries.find((a) => a.field === "operationalDetails")!.reason).toBe("");
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
    await repo.updateProject("3", { operationalDetails: "x" }); // Dana's wargame, in Research
    expect(repo.project("3").operationalDetails).toBe("x");
  });
  it("covers sub-departments", async () => {
    const { repo } = await repoAs("Jeremy"); // owns Ops, which holds Resourcing
    await repo.updateProject("6", { operationalDetails: "x" });
    expect(repo.project("6").operationalDetails).toBe("x");
  });
  it("lets members edit", async () => {
    const { repo } = await repoAs("Priya Raman (sample)"); // accepted member of project 1
    await repo.updateProject("1", { operationalDetails: "x" });
  });
  it("blocks staff outside the project", async () => {
    const { repo } = await repoAs("Marcus Lee (sample)"); // invited, not accepted
    await expect(repo.updateProject("1", { operationalDetails: "x" })).rejects.toBeInstanceOf(PermissionError);
  });
  it("blocks viewers from everything", async () => {
    const { repo } = await repoAs("Board Observer (sample)");
    await expect(repo.updateProject("1", { operationalDetails: "x" })).rejects.toBeInstanceOf(PermissionError);
    await expect(repo.createMeeting({ title: "x", meetingType: "daily", date: TODAY, notes: "", attendeeIds: [], departmentId: null })).rejects.toBeInstanceOf(PermissionError);
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
      projectId: "1", title: "Press list", kind: "task", ownerId: "3", startDate: "2026-11-20", dueDate: "2026-11-25",
      status: "notStarted", effortHours: 2, estimatedCost: 0, notes: "",
    });
    await repo.addDependency("6", t.id);
    expect(repo.data.dependencies.some((d) => d.predecessorId === "6" && d.successorId === t.id)).toBe(true);
  });

  it("checks ordering when a task is created with predecessors", async () => {
    await expect(
      repo.createTask({
        projectId: "1", title: "Too early", kind: "task", ownerId: "3", startDate: TODAY, dueDate: TODAY,
        status: "notStarted", effortHours: 1, estimatedCost: 0, notes: "",
      }, ["5"]),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it("removes a task's links when it is deleted", async () => {
    const { repo: lead } = await repoAs("Priya Raman (sample)"); // Research Task Lead
    await lead.deleteTask("4");
    expect(lead.data.dependencies.some((d) => d.predecessorId === "4" || d.successorId === "4")).toBe(false);
  });
});

describe("deleting", () => {
  // Project 1 and 3 are Research; project 2 is Comms; project 6 is Ops > Resourcing.
  it("refuses staff, department owners, and viewers", async () => {
    for (const name of ["Dana Ortiz (sample)", "Aaron", "Board Observer (sample)"]) {
      const { repo } = await repoAs(name);
      await expect(repo.deleteTask("4")).rejects.toBeInstanceOf(PermissionError);
      await expect(repo.deleteProject("1")).rejects.toBeInstanceOf(PermissionError);
    }
  });

  it("lets a Department Task Lead delete only in their departments", async () => {
    const { repo } = await repoAs("Priya Raman (sample)"); // Research
    await repo.deleteTask("9"); // wargame task, Research
    await expect(repo.deleteTask("7")).rejects.toBeInstanceOf(PermissionError); // op-ed task, Comms
    await expect(repo.removeDependency("7")).rejects.toBeInstanceOf(PermissionError); // Comms link
    expect(repo.canDelete(repo.project("1"))).toBe(true);
    expect(repo.canDelete(repo.project("2"))).toBe(false);
  });

  it("covers sub-departments of a lead's department", async () => {
    const { repo } = await repoAs("Taylor Brooks (sample)"); // Ops, which holds Resourcing
    await repo.deleteProject("6");
    expect(repo.data.projects.some((p) => p.id === "6")).toBe(false);
  });

  it("lets admins delete anywhere", async () => {
    const { repo } = await repoAs("Ike Harris");
    await repo.deleteTask("7");
    await repo.removeMembership("1");
  });

  it("logs every kind of deletion with time and user, in the deletion log only", async () => {
    const { repo } = await repoAs("Priya Raman (sample)");
    const auditBefore = repo.data.audit.length;
    await repo.removeDependency("1");
    await repo.removeMembership("2");
    await repo.unlinkProjects("1");
    await repo.unlinkRelationship("1");
    await repo.removeStage("2");
    await repo.deleteTask("5");
    await repo.deleteProject("3");
    expect(repo.data.deletions.map((d) => d.entityType)).toEqual([
      "dependency", "membership", "projectLink", "relationshipLink", "stage", "task", "project",
    ]);
    for (const d of repo.data.deletions) {
      expect(d).toMatchObject({ deletedById: "6", deletedByEmail: "priya@example.org", deletedAt: "2026-10-19T14:00:00.000Z" });
      expect(d.summary).not.toBe("");
      expect(() => JSON.parse(d.snapshot)).not.toThrow();
    }
    const project = repo.data.deletions.at(-1)!;
    expect(project.summary).toBe('Project "Frontier AI crisis wargame" with 4 tasks');
    expect(JSON.parse(project.snapshot).tasks).toHaveLength(4);
    // Deletions stay out of the audit log that everyone can read.
    expect(repo.data.audit.length).toBe(auditBefore);
  });

  it("writes the log entry before deleting, so a failed log stops the deletion", async () => {
    const data = buildSeed(TODAY);
    const backend = new MemoryBackend(data);
    const realCreate = backend.create.bind(backend);
    backend.create = (async (table: string, row: unknown) => {
      if (table === "deletions") throw new Error("SharePoint unavailable");
      return realCreate(table as never, row as never);
    }) as typeof backend.create;
    const me = data.people.find((p) => p.name === "Ike Harris")!;
    const repo = new Repository(backend, me, me.email, NOW);
    await repo.refresh();
    await expect(repo.deleteTask("4")).rejects.toThrow("SharePoint unavailable");
    expect((await backend.load()).tasks.some((t) => t.id === "4")).toBe(true);
  });

  it("keeps the log out of the normal load and gives it only to admins", async () => {
    const { repo, backend } = await repoAs("Ike Harris");
    await repo.deleteTask("4");
    expect((await backend.load()).deletions).toEqual([]);
    expect(await repo.loadDeletions()).toHaveLength(1);
    const { repo: lead } = await repoAs("Priya Raman (sample)");
    await expect(lead.loadDeletions()).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("Department Task Leads and reporting lines", () => {
  it("lets a lead edit projects in their departments", async () => {
    const { repo } = await repoAs("Marcus Lee (sample)"); // Comms lead
    await repo.updateProject("2", { operationalDetails: "x" });
    await expect(repo.updateProject("3", { operationalDetails: "x" })).rejects.toBeInstanceOf(PermissionError);
  });

  it("requires departments for a lead and refuses reporting loops", async () => {
    const { repo } = await repoAs("Ike Harris");
    const dana = repo.data.people.find((p) => p.name === "Dana Ortiz (sample)")!;
    await expect(repo.savePerson({ ...dana, role: "deptLead", leadDepartmentIds: [] }, dana.id)).rejects.toThrow(/Choose the departments/);
    const aaron = repo.data.people.find((p) => p.name === "Aaron")!;
    await expect(repo.savePerson({ ...aaron, managerId: dana.id }, aaron.id)).rejects.toThrow(/reporting loop/);
  });

  it("drops lead departments when the role changes", async () => {
    const { repo } = await repoAs("Ike Harris");
    const priya = repo.data.people.find((p) => p.name === "Priya Raman (sample)")!;
    const saved = await repo.savePerson({ ...priya, role: "staff" }, priya.id);
    expect(saved.leadDepartmentIds).toEqual([]);
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
  it("hands off automatically when the milestone task, even in another project, is completed", async () => {
    const { repo } = await repoAs("Ike Harris");
    await repo.updateStage("1", { handoffTaskId: "18", handoffDate: "2026-11-01" }); // a task in the hiring project
    const { handedOff } = await repo.updateTask("18", { status: "done" });
    expect(handedOff.map((s) => s.name)).toEqual(["Research"]);
    expect(repo.data.stages.find((s) => s.id === "2")!.status).toBe("active");
    expect(repo.project("1")).toMatchObject({ ownerId: "2", departmentId: "1" });
    expect(repo.data.stages.find((s) => s.id === "1")!.handoffNote).toMatch(/automatically: "Post fellowship call" was completed/);
  });
  it("does nothing until the milestone task is done", async () => {
    const { repo } = await repoAs("Ike Harris");
    await repo.updateStage("1", { handoffTaskId: "18" });
    const { handedOff } = await repo.updateTask("18", { notes: "halfway" });
    expect(handedOff).toEqual([]);
    expect(repo.data.stages.find((s) => s.id === "1")!.status).toBe("active");
  });
  it("hands off at once when the chosen milestone is already done, and keeps going down the chain", async () => {
    const { repo } = await repoAs("Ike Harris");
    const mk = (title: string) => repo.createTask({
      projectId: "5", title, kind: "milestone", ownerId: "4", startDate: null, dueDate: null, status: "notStarted", effortHours: 0, estimatedCost: 0, notes: "",
    });
    const a = await mk("A");
    const b = await mk("B");
    await repo.updateTask(b.id, { status: "done" });
    await repo.updateStage("2", { handoffTaskId: b.id });
    expect(repo.data.stages.find((s) => s.id === "2")!.status).toBe("pending"); // not active yet
    await repo.updateStage("1", { handoffTaskId: a.id });
    await repo.updateTask(a.id, { status: "done" });
    expect(repo.data.stages.filter((s) => s.projectId === "1").map((s) => s.status)).toEqual(["complete", "complete"]);
    expect(repo.project("1").status).toBe("done");
    // Choosing a task that is already done hands off right away.
    await repo.updateStage("3", { handoffTaskId: "1" });
    expect(repo.data.stages.find((s) => s.id === "3")!.status).toBe("complete");
  });
  it("refuses a handoff milestone task that does not exist", async () => {
    const { repo } = await repoAs("Aaron");
    await expect(repo.updateStage("1", { handoffTaskId: "999" })).rejects.toThrow(/no longer exists/);
  });
  it("clears a stage's handoff milestone when that task is deleted", async () => {
    const { repo } = await repoAs("Ike Harris");
    await repo.deleteTask("6");
    expect(repo.data.stages.find((s) => s.id === "1")!.handoffTaskId).toBeNull();
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
    await expect(repo.savePerson({ name: "X", email: "AARON@example.org", role: "staff", departmentId: null, weeklyCapacityHours: 30, active: true, managerId: null, leadDepartmentIds: [] }))
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

describe("meeting note visibility", () => {
  const titles = (r: Repository) => r.visibleMeetings().map((m) => m.title).sort();
  it("shows admins every note", async () => {
    const { repo } = await repoAs("Ike Harris");
    expect(titles(repo)).toEqual(["Comms planning", "Daily stand-up", "Ops monthly review", "Research weekly"]);
  });
  it("shows others their department's notes and meetings they were in", async () => {
    const { repo } = await repoAs("Dana Ortiz (sample)"); // Research, not at the stand-up
    expect(titles(repo)).toEqual(["Research weekly"]);
    const aaron = (await repoAs("Aaron")).repo; // Research, at the stand-up
    expect(titles(aaron)).toEqual(["Daily stand-up", "Research weekly"]);
  });
  it("lets a parent department see its sub-departments' notes, not the other way round", async () => {
    const { repo } = await repoAs("Jeremy"); // Ops
    await repo.createMeeting({ title: "Resourcing check-in", meetingType: "weekly", date: TODAY, notes: "", attendeeIds: [], departmentId: "5" });
    expect(titles(repo)).toContain("Resourcing check-in");
    const susan = (await repoAs("Susan Malandrino", repo.data)).repo; // Comms
    expect(titles(susan)).not.toContain("Resourcing check-in");
  });
  it("refuses changes to a note that is not shared with the person", async () => {
    const { repo } = await repoAs("Dana Ortiz (sample)");
    await expect(repo.updateMeeting("3", { notes: "x" })).rejects.toBeInstanceOf(PermissionError);
    await expect(repo.saveTranscript("3", "x")).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("lines of effort", () => {
  const input = { name: "AI incident reporting", departmentId: "2", description: "", ownerId: null, active: true };
  it("lets admins, department owners, and the department's Task Lead add them, and nobody else", async () => {
    expect((await (await repoAs("Ike Harris")).repo.saveLineOfEffort(input)).name).toBe("AI incident reporting");
    expect((await (await repoAs("Aaron")).repo.saveLineOfEffort({ ...input, name: "B" })).departmentId).toBe("2"); // owns Research
    expect((await (await repoAs("Priya Raman (sample)")).repo.saveLineOfEffort({ ...input, name: "C" })).departmentId).toBe("2"); // Research lead
    await expect((await repoAs("Dana Ortiz (sample)")).repo.saveLineOfEffort({ ...input, name: "D" })).rejects.toBeInstanceOf(PermissionError);
    await expect((await repoAs("Susan Malandrino")).repo.saveLineOfEffort({ ...input, name: "E" })).rejects.toBeInstanceOf(PermissionError);
  });
  it("needs a name that is not already taken", async () => {
    const { repo } = await repoAs("Ike Harris");
    await expect(repo.saveLineOfEffort({ ...input, name: " talent PIPELINE " })).rejects.toMatchObject({ problems: ["Another line of effort already has that name."] });
  });
  it("requires every new project to sit under one, and keeps edits from clearing it", async () => {
    const { repo } = await repoAs("Aaron");
    await expect(repo.updateProject("1", { lineOfEffortId: null })).rejects.toBeInstanceOf(RuleError);
    await repo.updateProject("1", { lineOfEffortId: "2" });
    expect(repo.project("1").lineOfEffortId).toBe("2");
  });
  it("refuses to delete one that projects use, and logs a deletion", async () => {
    const { repo } = await repoAs("Ike Harris");
    await expect(repo.deleteLineOfEffort("1")).rejects.toMatchObject({ problems: [expect.stringMatching(/3 projects are under/)] });
    const l = await repo.saveLineOfEffort(input);
    await repo.deleteLineOfEffort(l.id);
    expect(repo.data.linesOfEffort.some((x) => x.id === l.id)).toBe(false);
    expect((await repo.loadDeletions()).some((d) => d.entityType === "lineOfEffort")).toBe(true);
  });
});

describe("deleting meeting notes", () => {
  it("is for admins only, keeps the tasks assigned in it, and logs the deletion", async () => {
    await expect((await repoAs("Aaron")).repo.deleteMeeting("2")).rejects.toBeInstanceOf(PermissionError);
    await expect((await repoAs("Priya Raman (sample)")).repo.deleteMeeting("2")).rejects.toBeInstanceOf(PermissionError);
    const { repo } = await repoAs("Ike Harris");
    await repo.updateTask("19", { sourceMeetingId: "2" });
    await repo.deleteMeeting("2");
    expect(repo.data.meetings.some((m) => m.id === "2")).toBe(false);
    expect(repo.task("19").sourceMeetingId).toBeNull();
    const log = (await repo.loadDeletions()).find((d) => d.entityType === "meeting")!;
    expect(log.summary).toMatch(/Research weekly/);
    expect(JSON.parse(log.snapshot).taskIds).toEqual(["19"]);
  });
});

describe("projects started in a meeting", () => {
  it("records the meeting on the project's history so the note can list it", async () => {
    const { repo } = await repoAs("Aaron");
    const m = repo.data.meetings.find((x) => x.id === "2")!;
    const p = await repo.createProject({
      title: "Paper 2", lineOfEffortId: "1", departmentId: "2", ownerId: "3", outputTypeIds: [], operationalDetails: "",
      startDate: null, dueDate: "2027-03-01", status: "notStarted", plannedBudget: 5000, actualSpend: 0,
    }, [], meetingOrigin(m));
    const created = repo.data.audit.find((a) => a.entityId === p.id && a.field === "created")!;
    expect(created.reason).toBe(`Created in meeting "Research weekly" on ${m.date} (meeting #2)`);
  });
});
