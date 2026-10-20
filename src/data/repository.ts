// Every change the app makes goes through here. The repository checks permissions and the
// business rules (date changes need a reason, dependencies keep their order, stages hand
// off in sequence), writes to the backend, and records the change in the audit log.
// It keeps a write-through copy of the data so rules always check the latest state.

import type {
  AuditEntry, DeletionEntry, DataSet, Department, ID, MeetingNote, Membership, MembershipStatus, OutputType, Person,
  Project, RelationshipLink, Row, Stage, TableName, Task,
} from "@/domain/types";
import { emptyDataSet, STATUS_LABELS } from "@/domain/types";
import type { Backend, NewRow } from "./backend";
import { canDeleteInDepartment, canEditProject, canWrite, isAdmin, wouldLoopReporting } from "@/domain/permissions";
import { cascadeShift, dependencyProblems, orderingProblems } from "@/domain/dependencies";
import { completeStage, stagesFor } from "@/domain/transitions";
import { isIsoDate } from "@/domain/dates";

/** A change broke a rule. `problems` are shown to the person as a list. */
export class RuleError extends Error {
  constructor(public problems: string[]) {
    super(problems.join(" "));
  }
}

/** A date changed without a reason. The UI catches this and asks for one. */
export class ReasonRequiredError extends Error {
  constructor(public fields: string[]) {
    super("Please say why the date is changing. The reason is saved with the change for future planning.");
  }
}

export class PermissionError extends Error {
  constructor(message = "You do not have permission to make this change.") {
    super(message);
  }
}

const DATE_FIELDS = new Set(["startDate", "dueDate"]);
const FIELD_LABELS: Record<string, string> = {
  startDate: "Start date", dueDate: "Due date", ownerId: "Owner", departmentId: "Department",
  plannedBudget: "Planned budget", actualSpend: "Actual spend", status: "Status", title: "Title",
  milestone: "Milestone", horizon: "Horizon", operationalDetails: "Operational details",
  outputTypeIds: "Output types", effortHours: "Effort (hours)", estimatedCost: "Estimated cost",
  kind: "Type", notes: "Notes",
};
export const fieldLabel = (f: string) => FIELD_LABELS[f] ?? f;

export type ProjectInput = Omit<Project, "id" | "createdAt" | "createdById">;
export type TaskInput = Omit<Task, "id" | "completedAt" | "sourceMeetingId"> & { sourceMeetingId?: ID | null };
export type StageInput = Pick<Stage, "name" | "ownerId" | "departmentId"> & { handoffNote?: string };

function stringify(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function changedKeys<T extends object>(before: T, patch: Partial<T>): (keyof T & string)[] {
  return (Object.keys(patch) as (keyof T & string)[]).filter((k) => stringify(before[k]) !== stringify(patch[k]));
}

export class Repository {
  data: DataSet = emptyDataSet();

  constructor(
    private backend: Backend,
    public me: Person | null,
    /** Sign-in email, kept on audit entries even before the person is in the People list. */
    public myEmail: string,
    private now: () => Date = () => new Date(),
  ) {}

  get backendKind() {
    return this.backend.kind;
  }

  async refresh(): Promise<DataSet> {
    this.data = await this.backend.load();
    if (this.me) this.me = this.data.people.find((p) => p.id === this.me!.id) ?? this.me;
    return this.data;
  }

  private nowIso() {
    return this.now().toISOString();
  }

  // ---- Write-through helpers ----

  private async create<K extends TableName>(table: K, row: NewRow<K>): Promise<Row<K>> {
    const created = await this.backend.create(table, row);
    (this.data[table] as Row<K>[]).push(created);
    return created;
  }

  private async update<K extends TableName>(table: K, id: ID, patch: Partial<Row<K>>): Promise<void> {
    if (!Object.keys(patch).length) return;
    await this.backend.update(table, id, patch);
    const rows = this.data[table] as Row<K>[];
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows[i] = { ...rows[i], ...patch };
  }

  private async remove(table: TableName, id: ID): Promise<void> {
    await this.backend.remove(table, id);
    const rows = this.data[table] as { id: ID }[];
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows.splice(i, 1);
  }

  private async log(
    entityType: AuditEntry["entityType"], entityId: ID, projectId: ID | null, field: string,
    oldValue: unknown, newValue: unknown, reason = "",
  ) {
    await this.create("audit", {
      entityType, entityId, projectId, field, oldValue: stringify(oldValue), newValue: stringify(newValue),
      reason, changedById: this.me?.id ?? null, changedByEmail: this.me?.email ?? this.myEmail, changedAt: this.nowIso(),
    });
  }

  // ---- Lookups and permission checks ----

  project(id: ID): Project {
    const p = this.data.projects.find((x) => x.id === id);
    if (!p) throw new RuleError(["That project no longer exists. Someone may have deleted it."]);
    return p;
  }

  task(id: ID): Task {
    const t = this.data.tasks.find((x) => x.id === id);
    if (!t) throw new RuleError(["That task no longer exists. Someone may have deleted it."]);
    return t;
  }

  canEdit(project: Project): boolean {
    return canEditProject(this.me, project, this.data);
  }

  private requireEdit(project: Project) {
    if (!this.canEdit(project)) throw new PermissionError("Only the project owner, its members, its department owner, or an admin can change this project.");
  }

  private requireWrite() {
    if (!canWrite(this.me)) throw new PermissionError("Your account is view-only.");
  }

  /** Deleting in a project: admins, and the Department Task Lead for its department. */
  canDelete(project: Project): boolean {
    return canDeleteInDepartment(this.me, project.departmentId, this.data.departments);
  }

  private requireDelete(project: Project) {
    if (!this.canDelete(project)) {
      throw new PermissionError("Only an admin or this department's Department Task Lead can delete. You can mark the item done or on hold instead.");
    }
  }

  /**
   * Writes one entry to the admin-only deletion log. Runs before anything is removed, so a
   * deletion that cannot be logged does not happen.
   */
  private async logDeletion(
    entityType: DeletionEntry["entityType"], entityId: ID, summary: string, projectId: ID | null, departmentId: ID | null, snapshot: unknown,
  ) {
    let json = JSON.stringify(snapshot);
    // SharePoint's long text columns hold about 63,000 characters.
    if (json.length > 60_000) json = `${json.slice(0, 60_000)}...(cut off)`;
    await this.create("deletions", {
      entityType, entityId, summary, projectId, departmentId, snapshot: json,
      deletedById: this.me?.id ?? null, deletedByEmail: this.me?.email ?? this.myEmail, deletedAt: this.nowIso(),
    });
  }

  /** The deletion log, newest first. Admins only. */
  async loadDeletions(): Promise<DeletionEntry[]> {
    this.requireAdmin();
    this.data.deletions = (await this.backend.loadTable("deletions")).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    return this.data.deletions;
  }

  private requireAdmin() {
    if (!isAdmin(this.me)) throw new PermissionError("Only admins can change this.");
  }

  private checkDates(rec: { startDate: string | null; dueDate: string | null }) {
    const problems: string[] = [];
    for (const f of ["startDate", "dueDate"] as const) {
      if (rec[f] != null && !isIsoDate(rec[f])) problems.push(`${fieldLabel(f)} is not a valid date.`);
    }
    if (rec.startDate && rec.dueDate && rec.startDate > rec.dueDate) problems.push("The start date is after the due date.");
    if (problems.length) throw new RuleError(problems);
  }

  // ---- Projects ----

  async createProject(input: ProjectInput, stages: StageInput[] = []): Promise<Project> {
    this.requireWrite();
    const problems: string[] = [];
    if (!input.title.trim()) problems.push("Give the project a name.");
    if (!this.data.departments.some((d) => d.id === input.departmentId)) problems.push("Choose a department.");
    if (!this.data.people.some((p) => p.id === input.ownerId)) problems.push("Choose an owner.");
    if (problems.length) throw new RuleError(problems);
    this.checkDates(input);
    const project = await this.create("projects", {
      ...input, title: input.title.trim(), createdAt: this.nowIso(), createdById: this.me?.id ?? null,
    });
    await this.log("project", project.id, project.id, "created", "", project.title);
    for (const s of stages) await this.addStage(project.id, s);
    return project;
  }

  /**
   * Saves project changes. A change to the start or due date needs `reason`; without one
   * this throws ReasonRequiredError. Budget changes go to the budget log with the reason.
   */
  async updateProject(id: ID, patch: Partial<ProjectInput>, reason = ""): Promise<void> {
    const before = this.project(id);
    this.requireEdit(before);
    const keys = changedKeys(before, patch);
    if (!keys.length) return;
    const dateKeys = keys.filter((k) => DATE_FIELDS.has(k));
    if (dateKeys.length && !reason.trim()) throw new ReasonRequiredError(dateKeys);
    if ("title" in patch && !patch.title?.trim()) throw new RuleError(["The project needs a name."]);
    this.checkDates({ ...before, ...patch });
    const changes = Object.fromEntries(keys.map((k) => [k, patch[k]])) as Partial<Project>;
    await this.update("projects", id, changes);
    for (const k of keys) {
      await this.log("project", id, id, k, before[k], patch[k], DATE_FIELDS.has(k) || k.endsWith("Budget") || k === "actualSpend" ? reason.trim() : "");
      if (k === "plannedBudget" || k === "actualSpend") {
        await this.create("budgetChanges", {
          projectId: id, field: k === "plannedBudget" ? "planned" : "actual", oldValue: before[k], newValue: Number(patch[k]) || 0,
          reason: reason.trim(), changedById: this.me?.id ?? null, changedByEmail: this.me?.email ?? this.myEmail, changedAt: this.nowIso(),
        });
      }
    }
  }

  async deleteProject(id: ID): Promise<void> {
    const p = this.project(id);
    this.requireDelete(p);
    const tasks = this.data.tasks.filter((x) => x.projectId === id);
    const taskIds = new Set(tasks.map((t) => t.id));
    const stages = this.data.stages.filter((x) => x.projectId === id);
    const memberships = this.data.memberships.filter((x) => (x.targetType === "project" && x.targetId === id) || (x.targetType === "task" && taskIds.has(x.targetId)));
    const links = this.data.projectLinks.filter((x) => x.fromProjectId === id || x.toProjectId === id);
    const relationships = this.data.relationshipLinks.filter((x) => x.projectId === id);
    const dependencies = this.data.dependencies.filter((d) => taskIds.has(d.predecessorId) || taskIds.has(d.successorId));
    await this.logDeletion(
      "project", id, `Project "${p.title}" with ${tasks.length} task${tasks.length === 1 ? "" : "s"}`, id, p.departmentId,
      { project: p, tasks, dependencies, stages, memberships, links, relationships },
    );
    for (const t of tasks) await this.removeTaskRecords(t.id);
    for (const s of stages) await this.remove("stages", s.id);
    for (const m of this.data.memberships.filter((x) => x.targetType === "project" && x.targetId === id)) await this.remove("memberships", m.id);
    for (const l of links) await this.remove("projectLinks", l.id);
    for (const r of relationships) await this.remove("relationshipLinks", r.id);
    await this.remove("projects", id);
  }

  // ---- Tasks ----

  async createTask(input: TaskInput, predecessorIds: ID[] = []): Promise<Task> {
    const project = this.project(input.projectId);
    this.requireEdit(project);
    if (!input.title.trim()) throw new RuleError(["Give the task a name."]);
    this.checkDates(input);
    // Check ordering as if the links already existed.
    const draft: Task = { ...input, id: "__new__", title: input.title.trim(), sourceMeetingId: input.sourceMeetingId ?? null, completedAt: null };
    const draftDeps = predecessorIds.map((p, i) => ({ id: `__d${i}`, predecessorId: p, successorId: draft.id }));
    const problems = orderingProblems(draft, this.data.tasks, [...this.data.dependencies, ...draftDeps]).map((x) => x.message);
    if (problems.length) throw new RuleError(problems);
    const task = await this.create("tasks", {
      ...input, title: input.title.trim(), sourceMeetingId: input.sourceMeetingId ?? null,
      completedAt: input.status === "done" ? this.nowIso() : null,
    });
    await this.log("task", task.id, task.projectId, "created", "", task.title);
    for (const p of predecessorIds) await this.create("dependencies", { predecessorId: p, successorId: task.id });
    return task;
  }

  /**
   * Saves task changes. Date changes need `reason`. Status and date changes must respect the
   * task's dependencies; otherwise this throws RuleError with the reasons.
   */
  async updateTask(id: ID, patch: Partial<Omit<Task, "id">>, reason = ""): Promise<void> {
    const before = this.task(id);
    this.requireEdit(this.project(before.projectId));
    const keys = changedKeys(before, patch);
    if (!keys.length) return;
    const dateKeys = keys.filter((k) => DATE_FIELDS.has(k));
    if (dateKeys.length && !reason.trim()) throw new ReasonRequiredError(dateKeys);
    const next: Task = { ...before, ...patch };
    this.checkDates(next);
    const problems = orderingProblems(next, this.data.tasks, this.data.dependencies).map((x) => x.message);
    if (problems.length) throw new RuleError(problems);
    const changes = Object.fromEntries(keys.map((k) => [k, patch[k]])) as Partial<Task>;
    if ("status" in changes) changes.completedAt = changes.status === "done" ? this.nowIso() : null;
    await this.update("tasks", id, changes);
    for (const k of keys) {
      const old = k === "status" ? STATUS_LABELS[before.status] : before[k];
      const nu = k === "status" ? STATUS_LABELS[next.status] : patch[k];
      await this.log("task", id, before.projectId, k, old, nu, DATE_FIELDS.has(k) ? reason.trim() : "");
    }
  }

  /**
   * Moves a task's due date and pushes every downstream task later by the same amount
   * where needed, all under one reason.
   */
  async shiftWithDownstream(id: ID, newDue: string, reason: string): Promise<number> {
    if (!reason.trim()) throw new ReasonRequiredError(["dueDate"]);
    const t = this.task(id);
    this.requireEdit(this.project(t.projectId));
    const moves = cascadeShift(id, newDue, this.data.tasks, this.data.dependencies);
    const why = `${reason.trim()} (moved with "${t.title}")`;
    // Move the furthest-downstream tasks first so every intermediate state stays valid.
    for (const m of [...moves].reverse()) {
      const before = this.task(m.taskId);
      await this.update("tasks", m.taskId, { startDate: m.startDate, dueDate: m.dueDate });
      if (before.startDate !== m.startDate) await this.log("task", m.taskId, before.projectId, "startDate", before.startDate, m.startDate, why);
      if (before.dueDate !== m.dueDate) await this.log("task", m.taskId, before.projectId, "dueDate", before.dueDate, m.dueDate, why);
    }
    await this.update("tasks", id, { dueDate: newDue });
    await this.log("task", id, t.projectId, "dueDate", t.dueDate, newDue, reason.trim());
    return moves.length;
  }

  async deleteTask(id: ID): Promise<void> {
    const t = this.task(id);
    const project = this.project(t.projectId);
    this.requireDelete(project);
    await this.logDeletion("task", id, `Task "${t.title}" in "${project.title}"`, project.id, project.departmentId, {
      task: t,
      dependencies: this.data.dependencies.filter((x) => x.predecessorId === id || x.successorId === id),
      memberships: this.data.memberships.filter((x) => x.targetType === "task" && x.targetId === id),
    });
    await this.removeTaskRecords(id);
  }

  /** Removes a task with its links and invitations. Callers check permission and log first. */
  private async removeTaskRecords(id: ID): Promise<void> {
    for (const d of this.data.dependencies.filter((x) => x.predecessorId === id || x.successorId === id)) await this.remove("dependencies", d.id);
    for (const m of this.data.memberships.filter((x) => x.targetType === "task" && x.targetId === id)) await this.remove("memberships", m.id);
    await this.remove("tasks", id);
  }

  // ---- Dependencies ----

  async addDependency(predecessorId: ID, successorId: ID): Promise<void> {
    const pre = this.task(predecessorId);
    const suc = this.task(successorId);
    this.requireEdit(this.project(suc.projectId));
    const problems = dependencyProblems(pre, suc, this.data.dependencies);
    if (problems.length) throw new RuleError(problems);
    const d = await this.create("dependencies", { predecessorId, successorId });
    await this.log("dependency", d.id, suc.projectId, "added", "", `"${pre.title}" before "${suc.title}"`);
  }

  async removeDependency(id: ID): Promise<void> {
    const d = this.data.dependencies.find((x) => x.id === id);
    if (!d) return;
    const suc = this.task(d.successorId);
    const project = this.project(suc.projectId);
    this.requireDelete(project);
    await this.logDeletion("dependency", id, `Link: "${this.task(d.predecessorId).title}" before "${suc.title}"`, project.id, project.departmentId, d);
    await this.remove("dependencies", id);
  }

  // ---- People on projects and events ----

  async invite(targetType: Membership["targetType"], targetId: ID, personId: ID): Promise<Membership> {
    this.requireWrite();
    const projectId = targetType === "project" ? targetId : this.task(targetId).projectId;
    const existing = this.data.memberships.find((m) => m.targetType === targetType && m.targetId === targetId && m.personId === personId);
    if (existing) {
      if (existing.status === "declined") await this.update("memberships", existing.id, { status: "invited", invitedAt: this.nowIso(), invitedById: this.me?.id ?? null });
      return existing;
    }
    // Adding yourself is joining, not an invitation.
    const status: MembershipStatus = personId === this.me?.id ? "accepted" : "invited";
    const m = await this.create("memberships", { targetType, targetId, personId, status, invitedById: this.me?.id ?? null, invitedAt: this.nowIso() });
    const who = this.data.people.find((p) => p.id === personId)?.name ?? personId;
    await this.log("membership", m.id, projectId, status === "invited" ? "invited" : "joined", "", who);
    return m;
  }

  async respond(membershipId: ID, status: MembershipStatus): Promise<void> {
    const m = this.data.memberships.find((x) => x.id === membershipId);
    if (!m) return;
    if (m.personId !== this.me?.id && !isAdmin(this.me)) throw new PermissionError("Only the invited person can answer an invitation.");
    await this.update("memberships", membershipId, { status });
  }

  async removeMembership(id: ID): Promise<void> {
    const m = this.data.memberships.find((x) => x.id === id);
    if (!m) return;
    const project = this.project(m.targetType === "project" ? m.targetId : this.task(m.targetId).projectId);
    this.requireDelete(project);
    const who = this.data.people.find((p) => p.id === m.personId)?.name ?? m.personId;
    const what = m.targetType === "project" ? project.title : this.task(m.targetId).title;
    await this.logDeletion("membership", id, `${who} removed from "${what}"`, project.id, project.departmentId, m);
    await this.remove("memberships", id);
  }

  // ---- Project links ----

  async linkProjects(fromProjectId: ID, toProjectId: ID, note = ""): Promise<void> {
    if (fromProjectId === toProjectId) throw new RuleError(["A project cannot link to itself."]);
    this.requireEdit(this.project(fromProjectId));
    const exists = this.data.projectLinks.some(
      (l) => (l.fromProjectId === fromProjectId && l.toProjectId === toProjectId) || (l.fromProjectId === toProjectId && l.toProjectId === fromProjectId),
    );
    if (exists) throw new RuleError(["These projects are already linked."]);
    await this.create("projectLinks", { fromProjectId, toProjectId, note });
  }

  async unlinkProjects(id: ID): Promise<void> {
    const l = this.data.projectLinks.find((x) => x.id === id);
    if (!l) return;
    const from = this.project(l.fromProjectId);
    const to = this.data.projects.find((p) => p.id === l.toProjectId);
    // A lead for either side may remove the link.
    if (!this.canDelete(from) && !(to && this.canDelete(to))) this.requireDelete(from);
    await this.logDeletion("projectLink", id, `Link between "${from.title}" and "${to?.title ?? "a deleted project"}"`, from.id, from.departmentId, l);
    await this.remove("projectLinks", id);
  }

  // ---- Stages and handoffs ----

  async addStage(projectId: ID, s: StageInput): Promise<Stage> {
    this.requireEdit(this.project(projectId));
    if (!s.name.trim()) throw new RuleError(["Name the stage."]);
    const existing = stagesFor(projectId, this.data.stages);
    const hasActive = existing.some((x) => x.status === "active");
    const allDone = existing.length > 0 && existing.every((x) => x.status === "complete");
    const order = existing.length ? Math.max(...existing.map((x) => x.order)) + 1 : 1;
    // The first stage starts active. A stage added after every other stage finished does not
    // reopen the project on its own.
    const status: Stage["status"] = !hasActive && !allDone ? "active" : "pending";
    const stage = await this.create("stages", {
      projectId, order, name: s.name.trim(), ownerId: s.ownerId, departmentId: s.departmentId, status, completedAt: null,
      handoffNote: s.handoffNote ?? "",
    });
    await this.log("stage", stage.id, projectId, "added", "", stage.name);
    return stage;
  }

  async updateStage(id: ID, patch: Partial<StageInput>): Promise<void> {
    const s = this.data.stages.find((x) => x.id === id);
    if (!s) return;
    this.requireEdit(this.project(s.projectId));
    await this.update("stages", id, patch);
  }

  async removeStage(id: ID): Promise<void> {
    const s = this.data.stages.find((x) => x.id === id);
    if (!s) return;
    const project = this.project(s.projectId);
    this.requireDelete(project);
    if (s.status !== "pending") throw new RuleError(["Only stages that have not started can be removed."]);
    await this.logDeletion("stage", id, `Stage "${s.name}" of "${project.title}"`, project.id, project.departmentId, s);
    await this.remove("stages", id);
  }

  /** Completes the active stage and hands the project to the next stage's owner. */
  async completeStage(projectId: ID, stageId: ID, note = ""): Promise<{ next: Stage | null }> {
    const project = this.project(projectId);
    this.requireEdit(project);
    const h = completeStage(project, stageId, this.data.stages, this.nowIso());
    for (const u of h.stageUpdates) await this.update("stages", u.id, { status: u.status, completedAt: u.completedAt });
    if (note.trim()) await this.update("stages", h.completed.id, { handoffNote: note.trim() });
    await this.log("stage", h.completed.id, projectId, "completed", h.completed.name, h.next ? `Handed to ${h.next.name}` : "Project done", note.trim());
    const keys = Object.keys(h.projectUpdate) as (keyof typeof h.projectUpdate)[];
    if (keys.length) {
      await this.update("projects", projectId, h.projectUpdate);
      for (const k of keys) await this.log("project", projectId, projectId, k, project[k], h.projectUpdate[k], `Stage handoff: ${h.completed.name} complete`);
    }
    return { next: h.next };
  }

  // ---- Relationships ----

  /** Links a tracker contact to a project. Returns the existing link if there already is one. */
  async linkRelationship(input: Omit<RelationshipLink, "id" | "syncedAt">): Promise<RelationshipLink> {
    this.requireEdit(this.project(input.projectId));
    const existing = this.data.relationshipLinks.find((r) => r.projectId === input.projectId && r.externalId === input.externalId);
    if (existing) return existing;
    return this.create("relationshipLinks", { ...input, syncedAt: null });
  }

  async unlinkRelationship(id: ID): Promise<void> {
    const r = this.data.relationshipLinks.find((x) => x.id === id);
    if (!r) return;
    const project = this.project(r.projectId);
    this.requireDelete(project);
    await this.logDeletion("relationshipLink", id, `${r.name} unlinked from "${project.title}"`, project.id, project.departmentId, r);
    await this.remove("relationshipLinks", id);
  }

  /** Used by the sync service to refresh names, organizations, and the sync time. */
  async updateRelationshipLink(id: ID, patch: Partial<Omit<RelationshipLink, "id">>): Promise<void> {
    await this.update("relationshipLinks", id, patch);
  }

  // ---- Meetings ----

  async createMeeting(input: Omit<MeetingNote, "id" | "createdById">): Promise<MeetingNote> {
    this.requireWrite();
    return this.create("meetings", { ...input, createdById: this.me?.id ?? null });
  }

  async updateMeeting(id: ID, patch: Partial<Omit<MeetingNote, "id">>): Promise<void> {
    this.requireWrite();
    await this.update("meetings", id, patch);
  }

  // ---- Admin: departments, output types, people ----

  async saveDepartment(input: Omit<Department, "id">, id?: ID): Promise<void> {
    this.requireAdmin();
    if (!input.name.trim()) throw new RuleError(["Name the department."]);
    if (id && input.parentId) {
      // Prevent making a department its own ancestor.
      let cur: ID | null = input.parentId;
      while (cur) {
        if (cur === id) throw new RuleError(["A department cannot sit under itself."]);
        cur = this.data.departments.find((d) => d.id === cur)?.parentId ?? null;
      }
    }
    if (id) {
      const before = this.data.departments.find((d) => d.id === id)!;
      await this.update("departments", id, input);
      for (const k of changedKeys(before as Omit<Department, "id">, input)) await this.log("department", id, null, k, before[k], input[k]);
    } else {
      const d = await this.create("departments", { ...input, name: input.name.trim() });
      await this.log("department", d.id, null, "created", "", d.name);
    }
  }

  async deleteDepartment(id: ID): Promise<void> {
    this.requireAdmin();
    const problems: string[] = [];
    if (this.data.projects.some((p) => p.departmentId === id)) problems.push("Move its projects to another department first.");
    if (this.data.departments.some((d) => d.parentId === id)) problems.push("Remove or move its sub-departments first.");
    if (problems.length) throw new RuleError(problems);
    const d = this.data.departments.find((x) => x.id === id);
    if (!d) return;
    await this.logDeletion("department", id, `Department "${d.name}"`, null, id, d);
    await this.remove("departments", id);
  }

  async saveOutputType(input: Omit<OutputType, "id">, id?: ID): Promise<void> {
    this.requireAdmin();
    if (!input.name.trim()) throw new RuleError(["Name the output type."]);
    if (id) await this.update("outputTypes", id, input);
    else await this.create("outputTypes", { ...input, name: input.name.trim() });
  }

  async deleteOutputType(id: ID): Promise<void> {
    this.requireAdmin();
    if (this.data.projects.some((p) => p.outputTypeIds.includes(id))) {
      throw new RuleError(["Projects still use this output type. Turn it off instead, so old projects keep their label."]);
    }
    const o = this.data.outputTypes.find((x) => x.id === id);
    if (!o) return;
    await this.logDeletion("outputType", id, `Output type "${o.name}"`, null, null, o);
    await this.remove("outputTypes", id);
  }

  async savePerson(input: Omit<Person, "id">, id?: ID): Promise<Person> {
    this.requireAdmin();
    const email = input.email.trim().toLowerCase();
    const problems: string[] = [];
    if (!input.name.trim()) problems.push("Enter a name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) problems.push("Enter a valid email address.");
    if (this.data.people.some((p) => p.email.toLowerCase() === email && p.id !== id)) problems.push("Someone already uses that email.");
    if (id === this.me?.id && input.role !== "admin") problems.push("You cannot remove your own admin role.");
    if (input.role === "deptLead" && !input.leadDepartmentIds.length) problems.push("Choose the departments this Department Task Lead keeps data for.");
    if (input.managerId && id && wouldLoopReporting(id, input.managerId, this.data.people)) {
      problems.push("That would make a reporting loop (someone would report to themselves through others).");
    }
    if (problems.length) throw new RuleError(problems);
    const clean = {
      ...input, name: input.name.trim(), email,
      leadDepartmentIds: input.role === "deptLead" ? input.leadDepartmentIds : [],
    };
    if (id) {
      const before = this.data.people.find((p) => p.id === id)!;
      await this.update("people", id, clean);
      for (const k of changedKeys(before as Omit<Person, "id">, clean)) await this.log("person", id, null, k, before[k], clean[k]);
      return { ...before, ...clean };
    }
    const p = await this.create("people", clean);
    await this.log("person", p.id, null, "added", "", p.name);
    return p;
  }

  /**
   * First-run setup: creates the lists, adds the person running it as the first admin, and
   * fills in the standard departments and output types if the lists are empty.
   */
  async bootstrap(name: string, email: string, seed: { departments: string[]; outputTypes: string[] }): Promise<void> {
    await this.backend.setup();
    await this.refresh();
    let me = this.data.people.find((p) => p.email.toLowerCase() === email.toLowerCase());
    if (!me) me = await this.create("people", { name, email: email.toLowerCase(), role: "admin", departmentId: null, weeklyCapacityHours: 32, active: true, managerId: null, leadDepartmentIds: [] });
    else if (me.role !== "admin") await this.update("people", me.id, { role: "admin" });
    this.me = { ...me, role: "admin" };
    if (!this.data.departments.length) for (const d of seed.departments) await this.create("departments", { name: d, parentId: null, ownerId: null });
    if (!this.data.outputTypes.length) {
      for (const [i, o] of seed.outputTypes.entries()) await this.create("outputTypes", { name: o, active: true, sortOrder: i + 1 });
    }
  }
}
