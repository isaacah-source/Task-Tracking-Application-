// Employee load. Each open task's estimated hours are spread evenly over the weekdays
// between its start (or today) and its due date; summing those slices for a person gives
// their booked hours for any window, which we compare to their weekly capacity.

import type { Dependency, ID, Person, Project, Task } from "./types";
import { addDays, daysBetween, isWeekday, workdaysBetween } from "./dates";
import { isBlocked } from "./dependencies";

/** The weekdays a task's effort is spread across, from today's point of view. */
export function effortSpan(task: Pick<Task, "startDate" | "dueDate">, todayIso: string): { from: string; to: string } {
  // Late work is all due now.
  if (task.dueDate && task.dueDate < todayIso) return { from: todayIso, to: todayIso };
  const from = task.startDate && task.startDate > todayIso ? task.startDate : todayIso;
  const to = task.dueDate ?? addDays(from, 27); // No due date: assume about four weeks.
  return { from, to: to < from ? from : to };
}

/** Hours of a task that fall inside [from, to]. */
export function hoursInWindow(
  task: Pick<Task, "startDate" | "dueDate" | "effortHours" | "status">,
  from: string,
  to: string,
  todayIso: string,
): number {
  if (task.status === "done" || !task.effortHours) return 0;
  const span = effortSpan(task, todayIso);
  const lo = span.from > from ? span.from : from;
  const hi = span.to < to ? span.to : to;
  if (hi < lo) return 0;
  // A span with no weekdays at all (weekend work) spreads over its calendar days instead.
  const countDays = countWeekdays(span.from, span.to) > 0 ? countWeekdays : countAllDays;
  return (task.effortHours * countDays(lo, hi)) / countDays(span.from, span.to);
}

function countWeekdays(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWeekday(d)) n++;
  return n;
}

function countAllDays(from: string, to: string): number {
  return daysBetween(from, to) + 1;
}

export function bookedHours(personId: ID, tasks: Task[], from: string, to: string, todayIso: string): number {
  return tasks
    .filter((t) => t.ownerId === personId)
    .reduce((sum, t) => sum + hoursInWindow(t, from, to, todayIso), 0);
}

/** Capacity for a window, pro-rated by weekdays (5 weekdays = one week of capacity). */
export function capacityForWindow(person: Pick<Person, "weeklyCapacityHours">, from: string, to: string): number {
  return (person.weeklyCapacityHours * workdaysBetween(from, to)) / 5;
}

export type LoadLevel = "light" | "steady" | "high" | "over";

export function loadLevel(utilization: number): LoadLevel {
  if (utilization > 1) return "over";
  if (utilization >= 0.85) return "high";
  if (utilization >= 0.4) return "steady";
  return "light";
}

export interface PersonLoad {
  person: Person;
  openTasks: Task[];
  activeProjects: Project[];
  hoursNext7: number;
  capacityNext7: number;
  hoursNext28: number;
  capacityNext28: number;
  /** hoursNext7 / capacityNext7 */
  utilization: number;
  level: LoadLevel;
  overdue: Task[];
  /** Open tasks due in the next 14 days, soonest first. */
  upcoming: Task[];
  blockedCount: number;
}

export function personLoad(
  person: Person,
  data: { tasks: Task[]; projects: Project[]; dependencies: Dependency[] },
  todayIso: string,
): PersonLoad {
  const openTasks = data.tasks.filter((t) => t.ownerId === person.id && t.status !== "done");
  const to7 = addDays(todayIso, 6);
  const to28 = addDays(todayIso, 27);
  const hoursNext7 = bookedHours(person.id, openTasks, todayIso, to7, todayIso);
  const hoursNext28 = bookedHours(person.id, openTasks, todayIso, to28, todayIso);
  const capacityNext7 = capacityForWindow(person, todayIso, to7);
  const capacityNext28 = capacityForWindow(person, todayIso, to28);
  const utilization = capacityNext7 > 0 ? hoursNext7 / capacityNext7 : hoursNext7 > 0 ? Infinity : 0;
  const projectIds = new Set(openTasks.map((t) => t.projectId));
  const activeProjects = data.projects.filter(
    (p) => p.status !== "done" && (p.ownerId === person.id || projectIds.has(p.id)),
  );
  const in14 = addDays(todayIso, 14);
  return {
    person,
    openTasks,
    activeProjects,
    hoursNext7,
    capacityNext7,
    hoursNext28,
    capacityNext28,
    utilization,
    level: loadLevel(utilization),
    overdue: openTasks.filter((t) => t.dueDate && t.dueDate < todayIso),
    upcoming: openTasks
      .filter((t) => t.dueDate && t.dueDate >= todayIso && t.dueDate <= in14)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)),
    blockedCount: openTasks.filter((t) => isBlocked(t, data.tasks, data.dependencies)).length,
  };
}
