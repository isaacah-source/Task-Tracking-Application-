// Ownership transitions. A project moves through ordered stages; each stage names who owns
// the project during it. Completing the active stage activates the next one and hands the
// project to that stage's owner and department.

import type { ID, Project, Stage, Task } from "./types";

export function stagesFor(projectId: ID, stages: Stage[]): Stage[] {
  return stages.filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order);
}

export function activeStage(projectId: ID, stages: Stage[]): Stage | null {
  return stagesFor(projectId, stages).find((s) => s.status === "active") ?? null;
}

export interface Handoff {
  /** Stage updates to save. */
  stageUpdates: { id: ID; status: Stage["status"]; completedAt: string | null }[];
  /** Project fields to save, when the owner or department changes. */
  projectUpdate: Partial<Pick<Project, "ownerId" | "departmentId" | "status">>;
  completed: Stage;
  next: Stage | null;
}

/**
 * Completes the active stage. Throws a plain-language error when the stage given is not the
 * active one. When it was the last stage, the project is marked done.
 */
export function completeStage(project: Project, stageId: ID, stages: Stage[], nowIso: string): Handoff {
  const ordered = stagesFor(project.id, stages);
  const idx = ordered.findIndex((s) => s.id === stageId);
  if (idx < 0) throw new Error("That stage does not belong to this project.");
  const stage = ordered[idx];
  if (stage.status !== "active") {
    throw new Error(stage.status === "complete" ? `"${stage.name}" is already complete.` : `"${stage.name}" has not started. Finish the current stage first.`);
  }
  const next = ordered.slice(idx + 1).find((s) => s.status === "pending") ?? null;
  const stageUpdates: Handoff["stageUpdates"] = [{ id: stage.id, status: "complete", completedAt: nowIso }];
  const projectUpdate: Handoff["projectUpdate"] = {};
  if (next) {
    stageUpdates.push({ id: next.id, status: "active", completedAt: null });
    if (next.ownerId !== project.ownerId) projectUpdate.ownerId = next.ownerId;
    if (next.departmentId !== project.departmentId) projectUpdate.departmentId = next.departmentId;
  } else {
    projectUpdate.status = "done";
  }
  return { stageUpdates, projectUpdate, completed: stage, next };
}

/**
 * The active stage whose handoff milestone is this task, when the task is done. Completing
 * that task hands the project on automatically.
 */
export function stageTriggeredBy(task: Task, stages: Stage[]): Stage | null {
  if (task.status !== "done") return null;
  return stagesFor(task.projectId, stages).find((s) => s.status === "active" && s.handoffTaskId === task.id) ?? null;
}

/** The project's earliest open milestone task, or null. */
export function nextMilestone(projectId: ID, tasks: Task[]): Task | null {
  return tasks
    .filter((t) => t.projectId === projectId && t.kind === "milestone" && t.status !== "done")
    .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"))[0] ?? null;
}

/** Which stage should be active when stages are first added: the first unfinished one. */
export function initialActiveStage(ordered: Stage[]): Stage | null {
  if (ordered.some((s) => s.status === "active")) return null;
  return ordered.find((s) => s.status === "pending") ?? null;
}
