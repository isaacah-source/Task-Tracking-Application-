// Effort time and subtasks.

import type { ID, Task } from "./types";

/** Effort is kept in hours, in 15-minute steps. */
export const EFFORT_STEP_MINUTES = 15;

/** Rounds hours to the nearest 15 minutes; never negative. */
export function roundEffort(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 4) / 4;
}

/** 0.25 -> "15 min", 1.5 -> "1 h 30 min", 2 -> "2 h", 0 -> "". */
export function formatEffort(hours: number): string {
  const total = Math.round(roundEffort(hours) * 60);
  if (!total) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

export function subtasksOf(id: ID, tasks: Task[]): Task[] {
  return tasks.filter((t) => t.parentTaskId === id);
}

/**
 * Puts each subtask straight after its parent, keeping the given order otherwise. A subtask
 * whose parent is not in the list stands on its own.
 */
export function withSubtasks(tasks: Task[]): { task: Task; depth: 0 | 1 }[] {
  const ids = new Set(tasks.map((t) => t.id));
  const isChild = (t: Task) => !!t.parentTaskId && ids.has(t.parentTaskId);
  const out: { task: Task; depth: 0 | 1 }[] = [];
  for (const t of tasks) {
    if (isChild(t)) continue;
    out.push({ task: t, depth: 0 });
    for (const c of tasks) if (c.parentTaskId === t.id) out.push({ task: c, depth: 1 });
  }
  return out;
}
