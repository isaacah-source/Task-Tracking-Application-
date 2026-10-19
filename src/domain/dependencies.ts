// Task ordering. A dependency says the successor cannot start until the predecessor is
// done (finish-to-start). These functions answer: would a new link create a loop, which
// tasks are blocked right now, and do a task's dates respect its links.

import type { Dependency, ID, Task } from "./types";
import { addDays, formatShort } from "./dates";

export function predecessorIds(taskId: ID, deps: Dependency[]): ID[] {
  return deps.filter((d) => d.successorId === taskId).map((d) => d.predecessorId);
}

export function successorIds(taskId: ID, deps: Dependency[]): ID[] {
  return deps.filter((d) => d.predecessorId === taskId).map((d) => d.successorId);
}

/** True when adding predecessor -> successor would make a task (indirectly) wait on itself. */
export function wouldCreateCycle(deps: Dependency[], predecessorId: ID, successorId: ID): boolean {
  if (predecessorId === successorId) return true;
  // A loop exists if the predecessor is already reachable from the successor.
  const seen = new Set<ID>();
  const stack = [successorId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === predecessorId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...successorIds(cur, deps));
  }
  return false;
}

/** Open predecessors holding a task back. Empty means the task is free to start. */
export function blockers(task: Task, tasks: Task[], deps: Dependency[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return predecessorIds(task.id, deps)
    .map((id) => byId.get(id))
    .filter((t): t is Task => !!t && t.status !== "done");
}

export function isBlocked(task: Task, tasks: Task[], deps: Dependency[]): boolean {
  return task.status !== "done" && blockers(task, tasks, deps).length > 0;
}

/** Ids of every blocked task, for list views. */
export function blockedTaskIds(tasks: Task[], deps: Dependency[]): Set<ID> {
  return new Set(tasks.filter((t) => isBlocked(t, tasks, deps)).map((t) => t.id));
}

/**
 * Tasks in an order that respects every dependency (predecessors first). Ties keep due-date
 * order. Tasks caught in a loop (which the app prevents) go last.
 */
export function topoOrder(tasks: Task[], deps: Dependency[]): Task[] {
  const ids = new Set(tasks.map((t) => t.id));
  const relevant = deps.filter((d) => ids.has(d.predecessorId) && ids.has(d.successorId));
  const indegree = new Map<ID, number>(tasks.map((t) => [t.id, 0]));
  for (const d of relevant) indegree.set(d.successorId, (indegree.get(d.successorId) ?? 0) + 1);
  const byDue = (a: Task, b: Task) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title);
  const ready = tasks.filter((t) => indegree.get(t.id) === 0).sort(byDue);
  const out: Task[] = [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  while (ready.length) {
    const t = ready.shift()!;
    out.push(t);
    for (const d of relevant.filter((x) => x.predecessorId === t.id)) {
      const n = (indegree.get(d.successorId) ?? 0) - 1;
      indegree.set(d.successorId, n);
      if (n === 0) {
        ready.push(byId.get(d.successorId)!);
        ready.sort(byDue);
      }
    }
  }
  const placed = new Set(out.map((t) => t.id));
  return [...out, ...tasks.filter((t) => !placed.has(t.id))];
}

/** The earliest date a task may start: the latest due date among its predecessors. */
export function earliestStart(taskId: ID, tasks: Task[], deps: Dependency[]): string | null {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let latest: string | null = null;
  for (const id of predecessorIds(taskId, deps)) {
    const due = byId.get(id)?.dueDate;
    if (due && (!latest || due > latest)) latest = due;
  }
  return latest;
}

export interface OrderingProblem {
  taskId: ID;
  message: string;
}

/**
 * Checks a task (as it would be after an edit) against its links. Returns plain-language
 * problems; an empty list means the change is allowed.
 *
 * Rules:
 * - A task cannot move to In progress or Done while a predecessor is still open.
 * - A task cannot start before a predecessor's due date.
 * - A task cannot be due after a successor's start date.
 */
export function orderingProblems(next: Task, tasks: Task[], deps: Dependency[]): OrderingProblem[] {
  const others = tasks.filter((t) => t.id !== next.id);
  const all = [...others, next];
  const byId = new Map(all.map((t) => [t.id, t]));
  const problems: OrderingProblem[] = [];

  if (next.status === "inProgress" || next.status === "done") {
    const open = blockers(next, all, deps);
    if (open.length) {
      problems.push({
        taskId: next.id,
        message: `"${next.title}" is waiting on ${open.map((t) => `"${t.title}"`).join(", ")}. Finish ${open.length === 1 ? "that" : "those"} first.`,
      });
    }
  }

  const start = next.startDate ?? next.dueDate;
  for (const pid of predecessorIds(next.id, deps)) {
    const p = byId.get(pid);
    if (p?.dueDate && start && start < p.dueDate) {
      problems.push({
        taskId: next.id,
        message: `"${next.title}" starts ${formatShort(start)}, before "${p.title}" is due (${formatShort(p.dueDate)}).`,
      });
    }
  }

  for (const sid of successorIds(next.id, deps)) {
    const s = byId.get(sid);
    const sStart = s?.startDate ?? s?.dueDate;
    if (s && sStart && next.dueDate && next.dueDate > sStart) {
      problems.push({
        taskId: next.id,
        message: `"${next.title}" would be due ${formatShort(next.dueDate)}, after "${s.title}" starts (${formatShort(sStart)}). Move "${s.title}" first.`,
      });
    }
  }
  return problems;
}

/** Checks a new dependency before it is saved. */
export function dependencyProblems(predecessor: Task, successor: Task, deps: Dependency[]): string[] {
  const problems: string[] = [];
  if (deps.some((d) => d.predecessorId === predecessor.id && d.successorId === successor.id)) {
    problems.push("These tasks are already linked.");
  }
  if (wouldCreateCycle(deps, predecessor.id, successor.id)) {
    problems.push(`That would make "${successor.title}" wait on itself through a loop of links.`);
  }
  const sStart = successor.startDate ?? successor.dueDate;
  if (predecessor.dueDate && sStart && sStart < predecessor.dueDate) {
    problems.push(`"${successor.title}" starts ${formatShort(sStart)}, before "${predecessor.title}" is due (${formatShort(predecessor.dueDate)}). Change the dates first.`);
  }
  if (successor.status !== "notStarted" && successor.status !== "onHold" && predecessor.status !== "done") {
    problems.push(`"${successor.title}" is already under way, so it cannot wait on an unfinished task.`);
  }
  return problems;
}

/**
 * Proposed date shifts that push every downstream task later so ordering holds after a
 * task's due date moves. Keeps each successor's duration. Returns only tasks that move.
 */
export function cascadeShift(changedId: ID, newDue: string, tasks: Task[], deps: Dependency[]): { taskId: ID; startDate: string | null; dueDate: string | null }[] {
  const work = new Map(tasks.map((t) => [t.id, { ...t }]));
  const changed = work.get(changedId);
  if (!changed) return [];
  changed.dueDate = newDue;
  const moved = new Map<ID, { startDate: string | null; dueDate: string | null }>();
  for (const t of topoOrder([...work.values()], deps)) {
    const es = earliestStart(t.id, [...work.values()], deps);
    const start = t.startDate ?? t.dueDate;
    if (t.id === changedId || !es || !start || start >= es) continue;
    const shift = Math.round((Date.parse(es) - Date.parse(start)) / 86_400_000);
    const cur = work.get(t.id)!;
    cur.startDate = cur.startDate ? addDays(cur.startDate, shift) : null;
    cur.dueDate = cur.dueDate ? addDays(cur.dueDate, shift) : null;
    moved.set(t.id, { startDate: cur.startDate, dueDate: cur.dueDate });
  }
  return [...moved].map(([taskId, v]) => ({ taskId, ...v }));
}
