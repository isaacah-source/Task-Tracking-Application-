// Conflict checks for a new assignment, run live in meeting notes mode (and when adding a
// task anywhere). Checks timing, resourcing, money, and task ordering against everything
// already committed.

import type { Dependency, ID, Person, Project, Task } from "./types";
import { addDays, daysBetween, formatShort } from "./dates";
import { bookedHours, capacityForWindow, effortSpan } from "./load";

export interface AssignmentProposal {
  title: string;
  ownerId: ID | null;
  projectId: ID | null;
  startDate: string | null;
  dueDate: string | null;
  effortHours: number;
  estimatedCost: number;
  predecessorIds: ID[];
}

export type ConflictKind = "timing" | "resourcing" | "money" | "ordering" | "input";
export type Severity = "warning" | "conflict";

export interface Conflict {
  kind: ConflictKind;
  severity: Severity;
  message: string;
}

export const CONFLICT_KIND_LABELS: Record<ConflictKind, string> = {
  timing: "Timing",
  resourcing: "Workload",
  money: "Budget",
  ordering: "Order",
  input: "Check",
};

/** Deadlines this close together for the same person count as a timing clash. */
export const DEADLINE_CLUSTER_DAYS = 2;

export interface ConflictContext {
  people: Person[];
  projects: Project[];
  tasks: Task[];
  dependencies: Dependency[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const hrs = (n: number) => `${Math.round(n * 10) / 10} h`;

export function checkAssignment(p: AssignmentProposal, ctx: ConflictContext, todayIso: string): Conflict[] {
  const out: Conflict[] = [];
  const owner = p.ownerId ? ctx.people.find((x) => x.id === p.ownerId) : undefined;
  const project = p.projectId ? ctx.projects.find((x) => x.id === p.projectId) : undefined;

  // ---- Input sanity ----
  if (p.startDate && p.dueDate && p.startDate > p.dueDate) {
    out.push({ kind: "input", severity: "conflict", message: "The start date is after the due date." });
  }
  if (p.dueDate && p.dueDate < todayIso) {
    out.push({ kind: "timing", severity: "conflict", message: `The due date (${formatShort(p.dueDate)}) has already passed.` });
  }
  if (owner && !owner.active) {
    out.push({ kind: "resourcing", severity: "conflict", message: `${owner.name} is marked inactive.` });
  }

  // ---- Timing: other deadlines and events for the same person ----
  if (owner && p.dueDate) {
    const open = ctx.tasks.filter((t) => t.ownerId === owner.id && t.status !== "done" && t.dueDate);
    const near = open.filter((t) => Math.abs(daysBetween(t.dueDate!, p.dueDate!)) <= DEADLINE_CLUSTER_DAYS && t.kind !== "event");
    if (near.length) {
      out.push({
        kind: "timing",
        severity: near.length >= 3 ? "conflict" : "warning",
        message: `${owner.name} has ${near.length} other deadline${near.length === 1 ? "" : "s"} within ${DEADLINE_CLUSTER_DAYS} days: ${near
          .slice(0, 3)
          .map((t) => `"${t.title}" (${formatShort(t.dueDate)})`)
          .join(", ")}${near.length > 3 ? ", ..." : ""}.`,
      });
    }
    const from = p.startDate ?? p.dueDate;
    const events = open.filter((t) => t.kind === "event" && (t.startDate ?? t.dueDate!) <= p.dueDate! && t.dueDate! >= from);
    for (const e of events) {
      out.push({ kind: "timing", severity: "warning", message: `${owner.name} is at "${e.title}" on ${formatShort(e.startDate ?? e.dueDate)}.` });
    }
  }

  // ---- Resourcing: hours booked vs. capacity over the task's window ----
  if (owner && p.effortHours > 0) {
    const span = effortSpan({ startDate: p.startDate, dueDate: p.dueDate }, todayIso);
    const existing = bookedHours(owner.id, ctx.tasks, span.from, span.to, todayIso);
    const capacity = capacityForWindow(owner, span.from, span.to);
    const total = existing + p.effortHours;
    const window = span.from === span.to ? formatShort(span.from) : `${formatShort(span.from)} and ${formatShort(span.to)}`;
    if (total > capacity) {
      out.push({
        kind: "resourcing",
        severity: "conflict",
        message: `${owner.name} would have about ${hrs(total)} of work ${span.from === span.to ? "on" : "between"} ${window}, against ${hrs(capacity)} available (over by ${hrs(total - capacity)}).`,
      });
    } else if (total >= capacity * 0.85) {
      out.push({
        kind: "resourcing",
        severity: "warning",
        message: `${owner.name} would be at ${Math.round((total / capacity) * 100)}% of capacity ${span.from === span.to ? "on" : "between"} ${window}.`,
      });
    }
  }

  // ---- Money: committed spend vs. planned budget ----
  if (project && p.estimatedCost > 0) {
    const committed =
      project.actualSpend +
      ctx.tasks.filter((t) => t.projectId === project.id && t.status !== "done").reduce((s, t) => s + (t.estimatedCost || 0), 0);
    const after = committed + p.estimatedCost;
    if (project.plannedBudget <= 0) {
      out.push({ kind: "money", severity: "warning", message: `"${project.title}" has no planned budget yet, so this ${money(p.estimatedCost)} is unplanned.` });
    } else if (after > project.plannedBudget) {
      out.push({
        kind: "money",
        severity: "conflict",
        message: `"${project.title}" would be over budget: ${money(after)} spent or committed against ${money(project.plannedBudget)} planned (over by ${money(after - project.plannedBudget)}).`,
      });
    } else if (after >= project.plannedBudget * 0.9) {
      out.push({
        kind: "money",
        severity: "warning",
        message: `"${project.title}" would reach ${Math.round((after / project.plannedBudget) * 100)}% of its budget (${money(after)} of ${money(project.plannedBudget)}).`,
      });
    }
  }

  // ---- Ordering: must not start before what it waits on is due ----
  const start = p.startDate ?? p.dueDate;
  for (const pid of p.predecessorIds) {
    const pre = ctx.tasks.find((t) => t.id === pid);
    if (pre?.dueDate && start && start < pre.dueDate) {
      out.push({
        kind: "ordering",
        severity: "conflict",
        message: `This would start ${formatShort(start)}, but it waits on "${pre.title}", due ${formatShort(pre.dueDate)}. Earliest start: ${formatShort(pre.dueDate)}.`,
      });
    }
  }

  // Project end date
  if (project?.dueDate && p.dueDate && p.dueDate > project.dueDate) {
    out.push({ kind: "timing", severity: "warning", message: `Due after the project's own due date (${formatShort(project.dueDate)}).` });
  }
  return out;
}

/** People with room in the window, best fit first. Used to suggest another owner. */
export function suggestOwners(p: AssignmentProposal, ctx: ConflictContext, todayIso: string, limit = 3): { person: Person; freeHours: number }[] {
  const span = effortSpan({ startDate: p.startDate, dueDate: p.dueDate ?? addDays(todayIso, 7) }, todayIso);
  return ctx.people
    .filter((x) => x.active && x.role !== "viewer" && x.id !== p.ownerId)
    .map((person) => ({
      person,
      freeHours: capacityForWindow(person, span.from, span.to) - bookedHours(person.id, ctx.tasks, span.from, span.to, todayIso),
    }))
    .filter((x) => x.freeHours >= p.effortHours)
    .sort((a, b) => b.freeHours - a.freeHours)
    .slice(0, limit);
}
