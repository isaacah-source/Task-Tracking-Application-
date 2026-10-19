// Record shapes for everything the app stores. Each type is one SharePoint list (see
// data/schema.ts). Ids are strings because SharePoint item ids arrive as strings.
// Dates are plain "YYYY-MM-DD" strings so a deadline never shifts with time zones;
// timestamps (createdAt, changedAt) are full ISO strings.

export type ID = string;

/** App role. Department owners get extra rights from Department.ownerId, not from a role. */
export type Role = "admin" | "staff" | "viewer";
export const ROLES: Role[] = ["admin", "staff", "viewer"];
export const ROLE_LABELS: Record<Role, string> = { admin: "Admin", staff: "Staff", viewer: "Viewer" };
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Everything, including departments, output types, and who has which role.",
  staff: "Create projects. Edit projects they own or belong to. Department owners also edit every project in their department.",
  viewer: "Read-only.",
};

/** Immediate work vs. long-term work. */
export type Horizon = "immediate" | "longTerm";
export const HORIZON_LABELS: Record<Horizon, string> = { immediate: "Immediate", longTerm: "Long term" };

export type Status = "notStarted" | "inProgress" | "done" | "onHold";
export const STATUS_LABELS: Record<Status, string> = {
  notStarted: "Not started",
  inProgress: "In progress",
  done: "Done",
  onHold: "On hold",
};
export const OPEN_STATUSES: Status[] = ["notStarted", "inProgress", "onHold"];

export type TaskKind = "task" | "event" | "milestone";
export const TASK_KIND_LABELS: Record<TaskKind, string> = { task: "Task", event: "Event", milestone: "Milestone" };

export type RelationshipGroup = "government" | "industry" | "research" | "media";
export const RELATIONSHIP_GROUPS: RelationshipGroup[] = ["government", "industry", "research", "media"];
export const RELATIONSHIP_GROUP_LABELS: Record<RelationshipGroup, string> = {
  government: "Government Partners",
  industry: "Industry Partners",
  research: "Research Partners",
  media: "Media",
};

export type MeetingType = "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "other";
export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  daily: "Daily meeting",
  weekly: "Weekly meeting",
  monthly: "Monthly review",
  quarterly: "Quarterly review",
  yearly: "Yearly review",
  other: "Other meeting",
};

export interface Department {
  id: ID;
  name: string;
  /** Set for a sub-department. */
  parentId: ID | null;
  /** Person who owns the department. */
  ownerId: ID | null;
}

export interface Person {
  id: ID;
  name: string;
  /** Microsoft 365 sign-in address. Matching is case-insensitive. */
  email: string;
  role: Role;
  departmentId: ID | null;
  /** Hours per week this person can give to project work. */
  weeklyCapacityHours: number;
  active: boolean;
}

export interface OutputType {
  id: ID;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface Project {
  id: ID;
  title: string;
  departmentId: ID;
  ownerId: ID;
  outputTypeIds: ID[];
  milestone: string;
  horizon: Horizon;
  operationalDetails: string;
  startDate: string | null;
  dueDate: string | null;
  status: Status;
  plannedBudget: number;
  actualSpend: number;
  createdAt: string;
  createdById: ID | null;
}

export interface Task {
  id: ID;
  projectId: ID;
  title: string;
  kind: TaskKind;
  ownerId: ID | null;
  horizon: Horizon;
  startDate: string | null;
  dueDate: string | null;
  status: Status;
  /** Estimated hours of effort. */
  effortHours: number;
  /** Expected cost in dollars, counted against the project budget while the task is open. */
  estimatedCost: number;
  notes: string;
  /** The meeting this task was assigned in, when it came from meeting notes mode. */
  sourceMeetingId: ID | null;
  completedAt: string | null;
}

/** Finish-to-start: the successor cannot start until the predecessor is done. */
export interface Dependency {
  id: ID;
  predecessorId: ID;
  successorId: ID;
}

export type MembershipStatus = "invited" | "accepted" | "declined";
/** Links an FSI employee to a project or to a task/event. */
export interface Membership {
  id: ID;
  targetType: "project" | "task";
  targetId: ID;
  personId: ID;
  status: MembershipStatus;
  invitedById: ID | null;
  invitedAt: string;
}

/** Two projects connected to each other (for example a paper and its launch event). */
export interface ProjectLink {
  id: ID;
  fromProjectId: ID;
  toProjectId: ID;
  note: string;
}

export type StageStatus = "pending" | "active" | "complete";
/**
 * One stage of a project's life. Completing the active stage hands the project to the next
 * stage's owner and department (for example Research complete, then Comms rollout).
 */
export interface Stage {
  id: ID;
  projectId: ID;
  order: number;
  name: string;
  ownerId: ID;
  departmentId: ID;
  status: StageStatus;
  completedAt: string | null;
  handoffNote: string;
}

/** An external contact or organization from the Relationship Tracker, linked to a project. */
export interface RelationshipLink {
  id: ID;
  projectId: ID;
  externalId: string;
  kind: "contact" | "organization";
  name: string;
  organization: string;
  group: RelationshipGroup;
  note: string;
  syncedAt: string | null;
}

export interface BudgetChange {
  id: ID;
  projectId: ID;
  field: "planned" | "actual";
  oldValue: number;
  newValue: number;
  reason: string;
  changedById: ID | null;
  changedByEmail: string;
  changedAt: string;
}

/**
 * One changed field. Date changes always carry a reason; changedById and changedByEmail
 * identify who made the change.
 */
export interface AuditEntry {
  id: ID;
  entityType: "project" | "task" | "stage" | "department" | "person" | "outputType" | "dependency" | "membership";
  entityId: ID;
  /** Project the change belongs to, for per-project history. */
  projectId: ID | null;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
  changedById: ID | null;
  changedByEmail: string;
  changedAt: string;
}

export interface MeetingNote {
  id: ID;
  title: string;
  meetingType: MeetingType;
  date: string;
  notes: string;
  attendeeIds: ID[];
  createdById: ID | null;
}

/** Everything the app holds, as loaded from SharePoint (or demo data). */
export interface DataSet {
  departments: Department[];
  people: Person[];
  outputTypes: OutputType[];
  projects: Project[];
  tasks: Task[];
  dependencies: Dependency[];
  memberships: Membership[];
  projectLinks: ProjectLink[];
  stages: Stage[];
  relationshipLinks: RelationshipLink[];
  budgetChanges: BudgetChange[];
  audit: AuditEntry[];
  meetings: MeetingNote[];
}

export type TableName = keyof DataSet;
export type Row<K extends TableName> = DataSet[K][number];

export function emptyDataSet(): DataSet {
  return {
    departments: [], people: [], outputTypes: [], projects: [], tasks: [], dependencies: [],
    memberships: [], projectLinks: [], stages: [], relationshipLinks: [], budgetChanges: [],
    audit: [], meetings: [],
  };
}
