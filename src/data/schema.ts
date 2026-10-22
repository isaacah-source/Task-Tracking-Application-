// How each table maps onto a SharePoint list. Every list keeps SharePoint's built-in Title
// column (set to the record's name or a short label) plus one column per field. Column
// internal names carry an "fsi" prefix so they never collide with SharePoint's own hidden
// columns (Order, Author, Created, ...).

import type { DataSet, Row, TableName } from "@/domain/types";

/**
 * text: string ("" when empty)    note: long text
 * ref: id or null                 date: "YYYY-MM-DD" or null (stored as text, never shifts)
 * stamp: ISO timestamp or null
 * number, bool                    json: arrays, stored as text
 */
export type ColType = "text" | "note" | "ref" | "date" | "stamp" | "number" | "bool" | "json";

export interface ListDef<K extends TableName = TableName> {
  table: K;
  listName: string;
  description: string;
  /** Field copied into SharePoint's Title column, or a function building a label. */
  title: (row: Row<K>) => string;
  /** Field whose value is read back from Title (when the record has a name/title field). */
  titleField?: string;
  columns: Record<string, ColType>;
}

function def<K extends TableName>(d: ListDef<K>): ListDef<K> {
  return d;
}

export const LIST_PREFIX = "FSI ";

export const SCHEMA: { [K in TableName]: ListDef<K> } = {
  departments: def({
    table: "departments",
    listName: "FSI Departments",
    description: "Departments and sub-departments. Each project belongs to one.",
    title: (r) => r.name,
    titleField: "name",
    columns: { parentId: "ref", ownerId: "ref" },
  }),
  people: def({
    table: "people",
    listName: "FSI People",
    description: "FSI employees who use the app, with role and weekly capacity.",
    title: (r) => r.name,
    titleField: "name",
    columns: {
      email: "text", role: "text", departmentId: "ref", weeklyCapacityHours: "number", active: "bool", managerId: "ref",
      leadDepartmentIds: "json",
    },
  }),
  outputTypes: def({
    table: "outputTypes",
    listName: "FSI Output Types",
    description: "Kinds of output a project produces (papers, op-eds, convenings, ...).",
    title: (r) => r.name,
    titleField: "name",
    columns: { active: "bool", sortOrder: "number" },
  }),
  projects: def({
    table: "projects",
    listName: "FSI Projects",
    description: "Projects: the core unit of work.",
    title: (r) => r.title,
    titleField: "title",
    columns: {
      departmentId: "ref", ownerId: "ref", outputTypeIds: "json", milestone: "text",
      operationalDetails: "note", startDate: "date", dueDate: "date", status: "text", plannedBudget: "number",
      actualSpend: "number", createdAt: "text", createdById: "ref",
    },
  }),
  tasks: def({
    table: "tasks",
    listName: "FSI Tasks",
    description: "Tasks, events, and milestones inside projects.",
    title: (r) => r.title,
    titleField: "title",
    columns: {
      projectId: "ref", kind: "text", ownerId: "ref", startDate: "date", dueDate: "date",
      status: "text", effortHours: "number", estimatedCost: "number", notes: "note", sourceMeetingId: "ref",
      completedAt: "stamp",
    },
  }),
  dependencies: def({
    table: "dependencies",
    listName: "FSI Task Dependencies",
    description: "Which task has to finish before another can start.",
    title: (r) => `${r.predecessorId} -> ${r.successorId}`,
    columns: { predecessorId: "ref", successorId: "ref" },
  }),
  memberships: def({
    table: "memberships",
    listName: "FSI Project People",
    description: "FSI employees linked or invited to projects and events.",
    title: (r) => `${r.targetType} ${r.targetId}: person ${r.personId}`,
    columns: { targetType: "text", targetId: "ref", personId: "ref", status: "text", invitedById: "ref", invitedAt: "text" },
  }),
  projectLinks: def({
    table: "projectLinks",
    listName: "FSI Project Links",
    description: "Projects connected to other projects.",
    title: (r) => `${r.fromProjectId} <-> ${r.toProjectId}`,
    columns: { fromProjectId: "ref", toProjectId: "ref", note: "text" },
  }),
  stages: def({
    table: "stages",
    listName: "FSI Project Stages",
    description: "Ordered project stages; finishing one hands the project to the next owner.",
    title: (r) => r.name,
    titleField: "name",
    columns: {
      projectId: "ref", order: "number", ownerId: "ref", departmentId: "ref", status: "text",
      completedAt: "stamp", handoffNote: "note",
    },
  }),
  relationshipLinks: def({
    table: "relationshipLinks",
    listName: "FSI Project Relationships",
    description: "External contacts and organizations (from the Relationship Tracker) linked to projects.",
    title: (r) => r.name,
    titleField: "name",
    columns: { projectId: "ref", externalId: "text", kind: "text", organization: "text", group: "text", note: "text", syncedAt: "stamp" },
  }),
  budgetChanges: def({
    table: "budgetChanges",
    listName: "FSI Budget Log",
    description: "Every change to a project's planned budget or actual spend.",
    title: (r) => `${r.field} ${r.oldValue} -> ${r.newValue}`,
    columns: {
      projectId: "ref", field: "text", oldValue: "number", newValue: "number", reason: "note",
      changedById: "ref", changedByEmail: "text", changedAt: "text",
    },
  }),
  audit: def({
    table: "audit",
    listName: "FSI Audit Log",
    description: "Full change history. Date changes always carry a reason.",
    title: (r) => `${r.entityType} ${r.entityId} ${r.field}`,
    columns: {
      entityType: "text", entityId: "ref", projectId: "ref", field: "text", oldValue: "note", newValue: "note",
      reason: "note", changedById: "ref", changedByEmail: "text", changedAt: "text",
    },
  }),
  meetings: def({
    table: "meetings",
    listName: "FSI Meeting Notes",
    description: "Notes from daily, monthly, quarterly, and yearly meetings.",
    title: (r) => r.title,
    titleField: "title",
    columns: {
      meetingType: "text", date: "date", notes: "note", attendeeIds: "json", createdById: "ref", teamsMeetingId: "note", teamsJoinUrl: "note",
      transcript: "note",
    },
  }),
  deletions: def({
    table: "deletions",
    listName: "FSI Deletion Log",
    description: "Every deletion, with who and when. Admins only: turn on item-level permissions (see README).",
    title: (r) => r.summary,
    columns: {
      entityType: "text", entityId: "ref", summary: "note", projectId: "ref", departmentId: "ref", snapshot: "note",
      deletedById: "ref", deletedByEmail: "text", deletedAt: "text",
    },
  }),
};

/** Lists only admins read. Left out of the normal load so other people's browsers never fetch them. */
export const ADMIN_ONLY_TABLES: TableName[] = ["deletions"];

export const TABLES = Object.keys(SCHEMA) as TableName[];

export function columnName(field: string): string {
  return `fsi${field[0].toUpperCase()}${field.slice(1)}`;
}

export function displayName(field: string): string {
  const words = field.replace(/Id(s?)$/, "$1").replace(/([A-Z])/g, " $1").trim();
  return words[0].toUpperCase() + words.slice(1);
}

function encode(type: ColType, v: unknown): unknown {
  switch (type) {
    case "json":
      return JSON.stringify(v ?? []);
    case "number":
      return Number(v) || 0;
    case "bool":
      return !!v;
    case "ref":
    case "date":
    case "stamp":
      return v == null || v === "" ? null : String(v);
    default:
      return v == null ? "" : String(v);
  }
}

function decode(type: ColType, v: unknown): unknown {
  switch (type) {
    case "json":
      try {
        const parsed = typeof v === "string" && v ? JSON.parse(v) : [];
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    case "number":
      return Number(v) || 0;
    case "bool":
      return v === true || v === "true" || v === 1 || v === "1";
    case "ref":
    case "stamp":
      return v == null || v === "" ? null : String(v);
    case "date":
      return typeof v === "string" && v ? v.slice(0, 10) : null;
    default:
      return v == null ? "" : String(v);
  }
}

/** Record (or partial record) -> SharePoint fields. */
export function toFields<K extends TableName>(table: K, rec: Partial<Row<K>>, full = true): Record<string, unknown> {
  const d = SCHEMA[table] as ListDef<K>;
  const out: Record<string, unknown> = {};
  const r = rec as Record<string, unknown>;
  for (const [field, type] of Object.entries(d.columns)) {
    if (field in r) out[columnName(field)] = encode(type, r[field]);
  }
  if (full) out.Title = d.title(rec as Row<K>).slice(0, 255);
  else if (d.titleField && d.titleField in r) out.Title = String(r[d.titleField] ?? "").slice(0, 255);
  return out;
}

/** SharePoint fields -> record. */
export function fromFields<K extends TableName>(table: K, id: string, fields: Record<string, unknown>): Row<K> {
  const d = SCHEMA[table] as ListDef<K>;
  const out: Record<string, unknown> = { id };
  if (d.titleField) out[d.titleField] = fields.Title == null ? "" : String(fields.Title);
  for (const [field, type] of Object.entries(d.columns)) out[field] = decode(type, fields[columnName(field)]);
  return out as unknown as Row<K>;
}

export type { DataSet };
