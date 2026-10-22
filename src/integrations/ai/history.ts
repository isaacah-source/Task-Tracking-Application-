// Structured history for the Claude planning and analysis features. Turns the raw tables
// into a compact summary: what each project is, how its dates moved and why, how its
// budget moved, and how long similar work took. The same summary feeds the rule-based
// planner used until Claude is connected.

import type { DataSet, ID, Project, Task } from "@/domain/types";
import { STATUS_LABELS } from "@/domain/types";
import { daysBetween } from "@/domain/dates";
import { blockedTaskIds } from "@/domain/dependencies";
import { dueFlag } from "@/domain/flags";

export interface DateSlip {
  entity: string;
  field: string;
  from: string;
  to: string;
  days: number;
  reason: string;
  by: string;
  at: string;
}

export interface ProjectHistory {
  id: ID;
  title: string;
  department: string;
  owner: string;
  outputTypes: string[];
  status: string;
  milestone: string;
  startDate: string | null;
  dueDate: string | null;
  plannedBudget: number;
  actualSpend: number;
  budgetChanges: { field: string; from: number; to: number; reason: string; at: string }[];
  dateSlips: DateSlip[];
  totalSlipDays: number;
  tasks: {
    title: string; kind: string; owner: string; status: string; startDate: string | null; dueDate: string | null;
    effortHours: number; estimatedCost: number; blocked: boolean; flag: string | null; waitsOn: string[];
  }[];
  stages: { name: string; owner: string; status: string }[];
}

export interface OutputTypeStats {
  outputType: string;
  finished: number;
  avgDurationDays: number | null;
  avgSlipDays: number;
  avgBudgetVariancePct: number | null;
}

export interface History {
  today: string;
  projects: ProjectHistory[];
  byOutputType: OutputTypeStats[];
  people: { name: string; department: string; weeklyCapacityHours: number; openTasks: number }[];
}

export function buildHistory(data: DataSet, today: string): History {
  const name = (id: ID | null) => data.people.find((p) => p.id === id)?.name ?? "Unassigned";
  const dept = (id: ID | null) => data.departments.find((d) => d.id === id)?.name ?? "";
  const otName = (id: ID) => data.outputTypes.find((o) => o.id === id)?.name ?? id;
  const blocked = blockedTaskIds(data.tasks, data.dependencies);
  const taskTitle = new Map(data.tasks.map((t) => [t.id, t.title]));

  const slipsFor = (p: Project, tasks: Task[]): DateSlip[] => {
    const ids = new Set([p.id, ...tasks.map((t) => t.id)]);
    return data.audit
      .filter((a) => a.projectId === p.id && ids.has(a.entityId) && (a.field === "dueDate" || a.field === "startDate") && a.oldValue && a.newValue)
      .map((a) => ({
        entity: a.entityType === "project" ? "project" : `task "${taskTitle.get(a.entityId) ?? a.entityId}"`,
        field: a.field,
        from: a.oldValue,
        to: a.newValue,
        days: daysBetween(a.oldValue, a.newValue),
        reason: a.reason,
        by: a.changedByEmail,
        at: a.changedAt.slice(0, 10),
      }));
  };

  const projects: ProjectHistory[] = data.projects.map((p) => {
    const tasks = data.tasks.filter((t) => t.projectId === p.id);
    const dateSlips = slipsFor(p, tasks);
    return {
      id: p.id,
      title: p.title,
      department: dept(p.departmentId),
      owner: name(p.ownerId),
      outputTypes: p.outputTypeIds.map(otName),
      status: STATUS_LABELS[p.status],
      milestone: p.milestone,
      startDate: p.startDate,
      dueDate: p.dueDate,
      plannedBudget: p.plannedBudget,
      actualSpend: p.actualSpend,
      budgetChanges: data.budgetChanges
        .filter((b) => b.projectId === p.id)
        .map((b) => ({ field: b.field, from: b.oldValue, to: b.newValue, reason: b.reason, at: b.changedAt.slice(0, 10) })),
      dateSlips,
      totalSlipDays: dateSlips.filter((s) => s.entity === "project" && s.field === "dueDate").reduce((s, x) => s + x.days, 0),
      tasks: tasks.map((t) => ({
        title: t.title,
        kind: t.kind,
        owner: name(t.ownerId),
        status: STATUS_LABELS[t.status],
        startDate: t.startDate,
        dueDate: t.dueDate,
        effortHours: t.effortHours,
        estimatedCost: t.estimatedCost,
        blocked: blocked.has(t.id),
        flag: dueFlag(t.dueDate, t.status, today),
        waitsOn: data.dependencies.filter((d) => d.successorId === t.id).map((d) => taskTitle.get(d.predecessorId) ?? d.predecessorId),
      })),
      stages: data.stages
        .filter((s) => s.projectId === p.id)
        .sort((a, b) => a.order - b.order)
        .map((s) => ({ name: s.name, owner: name(s.ownerId), status: s.status })),
    };
  });

  const byOutputType: OutputTypeStats[] = data.outputTypes.map((o) => {
    const ps = projects.filter((p) => data.projects.find((x) => x.id === p.id)!.outputTypeIds.includes(o.id));
    const finished = ps.filter((p) => p.status === STATUS_LABELS.done);
    const durations = finished.filter((p) => p.startDate && p.dueDate).map((p) => daysBetween(p.startDate!, p.dueDate!));
    const variances = ps.filter((p) => p.plannedBudget > 0 && p.actualSpend > 0 && p.status === STATUS_LABELS.done)
      .map((p) => ((p.actualSpend - p.plannedBudget) / p.plannedBudget) * 100);
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    return {
      outputType: o.name,
      finished: finished.length,
      avgDurationDays: avg(durations),
      avgSlipDays: avg(ps.map((p) => p.totalSlipDays)) ?? 0,
      avgBudgetVariancePct: avg(variances),
    };
  });

  return {
    today,
    projects,
    byOutputType,
    people: data.people.filter((p) => p.active).map((p) => ({
      name: p.name,
      department: dept(p.departmentId),
      weeklyCapacityHours: p.weeklyCapacityHours,
      openTasks: data.tasks.filter((t) => t.ownerId === p.id && t.status !== "done").length,
    })),
  };
}
