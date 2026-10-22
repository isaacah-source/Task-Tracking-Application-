// Meeting display: picks which projects and tasks to put on screen for a meeting, and how
// to group them. The choices round-trip through the page address so a set-up display can
// be bookmarked or shared.

import type { DataSet, ID, Project, Task, TaskKind } from "./types";
import { TASK_KIND_LABELS } from "./types";
import { addDays, endOfMonth, endOfQuarter, formatDate, startOfMonth, startOfQuarter } from "./dates";
import { blockedTaskIds, topoOrder } from "./dependencies";
import { dueFlag } from "./flags";
import { departmentTree } from "./permissions";

export type DisplayScope = "org" | "department" | "projects" | "people";
export type DisplayStatus = "open" | "closed" | "all";
export type DisplayWindow = "any" | "overdue" | "next7" | "next30" | "thisMonth" | "thisQuarter" | "custom";
export type DisplayGroup = "project" | "person" | "department" | "none";

export interface DisplayOptions {
  title: string;
  scope: DisplayScope;
  departmentId: ID | null;
  projectIds: ID[];
  personIds: ID[];
  status: DisplayStatus;
  kinds: TaskKind[];
  window: DisplayWindow;
  from: string | null;
  to: string | null;
  /** Keep tasks with no dates when a time window is set. */
  includeUndated: boolean;
  groupBy: DisplayGroup;
  showSummary: boolean;
  showGantt: boolean;
  showTable: boolean;
  /** Meeting note this display is transcribing into through Teams, if any. */
  meetingId: ID | null;
}

export const SCOPE_LABELS: Record<DisplayScope, string> = {
  org: "Whole organization",
  department: "One department",
  projects: "Chosen projects",
  people: "Chosen people",
};
export const STATUS_CHOICES: Record<DisplayStatus, string> = { open: "Open only", closed: "Done only", all: "Open and done" };
export const WINDOW_LABELS: Record<DisplayWindow, string> = {
  any: "Any time",
  overdue: "Overdue only",
  next7: "Overdue and next 7 days",
  next30: "Overdue and next 30 days",
  thisMonth: "This month",
  thisQuarter: "This quarter",
  custom: "Dates I choose",
};
export const GROUP_LABELS: Record<DisplayGroup, string> = { project: "By project", person: "By person", department: "By department", none: "One list" };

export function defaultDisplayOptions(): DisplayOptions {
  return {
    title: "", scope: "org", departmentId: null, projectIds: [], personIds: [], status: "open", kinds: ["task", "event", "milestone"],
    window: "any", from: null, to: null, includeUndated: true, groupBy: "project", showSummary: true, showGantt: true, showTable: true,
    meetingId: null,
  };
}

/** Ready-made set-ups for common meetings. */
export const PRESETS: { label: string; description: string; options: Partial<DisplayOptions> }[] = [
  {
    label: "Department meeting",
    description: "One department's projects, every task open and done, by project, with timelines.",
    options: { scope: "department", status: "all", window: "any", groupBy: "project", showGantt: true },
  },
  {
    label: "Whole-org meeting",
    description: "Open work across FSI that is overdue or due in the next 30 days, by person.",
    options: { scope: "org", status: "open", window: "next30", includeUndated: false, groupBy: "person", showGantt: true },
  },
  {
    label: "Weekly check-in",
    description: "Open work overdue or due this week, by person, as a list.",
    options: { scope: "org", status: "open", window: "next7", includeUndated: false, groupBy: "person", showGantt: false },
  },
];

/** The date range a window covers, or null for no limit. "overdue" ends yesterday. */
export function windowRange(o: Pick<DisplayOptions, "window" | "from" | "to">, today: string): { from: string | null; to: string | null } | null {
  switch (o.window) {
    case "any": return null;
    case "overdue": return { from: null, to: addDays(today, -1) };
    case "next7": return { from: null, to: addDays(today, 7) };
    case "next30": return { from: null, to: addDays(today, 30) };
    case "thisMonth": return { from: startOfMonth(today), to: endOfMonth(today) };
    case "thisQuarter": return { from: startOfQuarter(today), to: endOfQuarter(today) };
    case "custom": return { from: o.from, to: o.to };
  }
}

/** Whether a task's dates overlap a range. Tasks without dates never match a range. */
function inRange(t: Task, r: { from: string | null; to: string | null }): boolean {
  const start = t.startDate ?? t.dueDate;
  const end = t.dueDate ?? t.startDate;
  if (!start || !end) return false;
  return (!r.from || end >= r.from) && (!r.to || start <= r.to);
}

export interface DisplayGroupResult {
  key: string;
  label: string;
  tasks: Task[];
}

export interface DisplayResult {
  projects: Project[];
  tasks: Task[];
  groups: DisplayGroupResult[];
  stats: { total: number; open: number; done: number; overdue: number; dueSoon: number; blocked: number };
  /** Plain-language description of what is shown, for the display's heading. */
  description: string;
}

export function buildDisplay(data: Pick<DataSet, "projects" | "tasks" | "dependencies" | "departments" | "people">, o: DisplayOptions, today: string): DisplayResult {
  const depts = o.scope === "department" && o.departmentId ? departmentTree(o.departmentId, data.departments) : null;
  const projects = data.projects.filter((p) => {
    if (o.scope === "department") return !!depts && depts.has(p.departmentId);
    if (o.scope === "projects") return o.projectIds.includes(p.id);
    return true;
  });
  const projectIds = new Set(projects.map((p) => p.id));
  const range = windowRange(o, today);

  const tasks = data.tasks.filter((t) => {
    if (!projectIds.has(t.projectId)) return false;
    if (o.scope === "people" && !(t.ownerId && o.personIds.includes(t.ownerId))) return false;
    if (!o.kinds.includes(t.kind)) return false;
    if (o.status === "open" && t.status === "done") return false;
    if (o.status === "closed" && t.status !== "done") return false;
    if (o.window === "overdue") return t.status !== "done" && !!t.dueDate && t.dueDate < today;
    if (!range) return true;
    if (!t.startDate && !t.dueDate) return o.includeUndated;
    // "Next N days" windows also keep overdue open work.
    if ((o.window === "next7" || o.window === "next30") && t.status !== "done" && t.dueDate && t.dueDate < today) return true;
    return inRange(t, range);
  });

  const ordered = topoOrder(tasks, data.dependencies);
  const name = (id: ID | null) => data.people.find((p) => p.id === id)?.name ?? "Unassigned";
  const projectOf = (t: Task) => data.projects.find((p) => p.id === t.projectId);
  const groups = new Map<string, DisplayGroupResult>();
  const add = (key: string, label: string, t: Task) => {
    const g = groups.get(key) ?? { key, label, tasks: [] };
    g.tasks.push(t);
    groups.set(key, g);
  };
  for (const t of ordered) {
    if (o.groupBy === "project") add(t.projectId, projectOf(t)?.title ?? "Project", t);
    else if (o.groupBy === "person") add(t.ownerId ?? "none", name(t.ownerId), t);
    else if (o.groupBy === "department") {
      const d = data.departments.find((x) => x.id === projectOf(t)?.departmentId);
      add(d?.id ?? "none", d?.name ?? "No department", t);
    } else add("all", "All tasks", t);
  }
  // Projects: unfinished first, soonest due first. Everything else: by name. "None" goes last.
  const projectRank = (id: string) => {
    const p = data.projects.find((x) => x.id === id);
    return `${p?.status === "done" ? 1 : 0}${p?.dueDate ?? "9999-12-31"}`;
  };
  const sortedGroups = [...groups.values()].sort((a, b) =>
    a.key === "none" ? 1 : b.key === "none" ? -1
      : o.groupBy === "project" ? projectRank(a.key).localeCompare(projectRank(b.key)) || a.label.localeCompare(b.label)
      : a.label.localeCompare(b.label),
  );

  const blocked = blockedTaskIds(data.tasks, data.dependencies);
  const stats = {
    total: tasks.length,
    open: tasks.filter((t) => t.status !== "done").length,
    done: tasks.filter((t) => t.status === "done").length,
    overdue: tasks.filter((t) => dueFlag(t.dueDate, t.status, today) === "overdue").length,
    dueSoon: tasks.filter((t) => dueFlag(t.dueDate, t.status, today) === "dueSoon").length,
    blocked: tasks.filter((t) => blocked.has(t.id)).length,
  };

  return { projects, tasks, groups: sortedGroups, stats, description: describe(data, o, today) };
}

function describe(data: Pick<DataSet, "projects" | "departments" | "people">, o: DisplayOptions, today: string): string {
  const parts: string[] = [];
  if (o.scope === "department") parts.push(data.departments.find((d) => d.id === o.departmentId)?.name ?? "No department chosen");
  else if (o.scope === "projects") parts.push(`${o.projectIds.length} chosen project${o.projectIds.length === 1 ? "" : "s"}`);
  else if (o.scope === "people") parts.push(o.personIds.map((id) => data.people.find((p) => p.id === id)?.name).filter(Boolean).join(", ") || "No one chosen");
  else parts.push("Whole organization");
  parts.push(STATUS_CHOICES[o.status].toLowerCase());
  if (o.kinds.length < 3) parts.push(o.kinds.map((k) => TASK_KIND_LABELS[k].toLowerCase() + "s").join(" and "));
  const r = windowRange(o, today);
  if (o.window === "custom" && r) parts.push(`${r.from ? formatDate(r.from) : "any start"} to ${r.to ? formatDate(r.to) : "any end"}`);
  else if (o.window !== "any") parts.push(WINDOW_LABELS[o.window].toLowerCase());
  return parts.join(" · ");
}

// ---- Page address <-> options ----

const LIST_KEYS = ["projectIds", "personIds", "kinds"] as const;
const BOOL_KEYS = ["includeUndated", "showSummary", "showGantt", "showTable"] as const;

export function optionsToQuery(o: DisplayOptions): string {
  const q = new URLSearchParams();
  const d = defaultDisplayOptions();
  for (const [k, v] of Object.entries(o) as [keyof DisplayOptions, unknown][]) {
    if (JSON.stringify(v) === JSON.stringify(d[k])) continue;
    if (Array.isArray(v)) q.set(k, v.join(","));
    else if (typeof v === "boolean") q.set(k, v ? "1" : "0");
    else if (v != null) q.set(k, String(v));
  }
  return q.toString();
}

export function optionsFromQuery(search: string): DisplayOptions {
  const q = new URLSearchParams(search);
  const o = defaultDisplayOptions() as unknown as Record<string, unknown>;
  for (const [k, v] of q) {
    if (!(k in o)) continue;
    if ((LIST_KEYS as readonly string[]).includes(k)) o[k] = v ? v.split(",").filter(Boolean) : [];
    else if ((BOOL_KEYS as readonly string[]).includes(k)) o[k] = v === "1";
    else o[k] = v || null;
  }
  const out = o as unknown as DisplayOptions;
  out.title = out.title ?? "";
  return out;
}
