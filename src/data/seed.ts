// Sample data for demo mode and tests. Dates are relative to "today" so the demo always
// shows overdue and due-soon work. People other than the four department owners are
// fictional, and every address uses example.org.

import type { AuditEntry, BudgetChange, DataSet, Project, Stage, Task } from "@/domain/types";
import { emptyDataSet } from "@/domain/types";
import { addDays } from "@/domain/dates";

export const STANDARD_DEPARTMENTS = ["Comms", "Research", "Ops", "Leadership"];
export const STANDARD_OUTPUT_TYPES = [
  "Research Papers",
  "OpEds",
  "Convenings (Conferences, Dinners, etc.)",
  "Wargames",
  "Educational events and activities",
];

export function buildSeed(today: string): DataSet {
  const d = (n: number) => addDays(today, n);
  const ts = (n: number) => `${d(n)}T15:00:00.000Z`;
  const data = emptyDataSet();

  data.people = [
    { id: "1", name: "Ike Harris", email: "ike@example.org", role: "admin", departmentId: "4", weeklyCapacityHours: 30, active: true, managerId: null, leadDepartmentIds: [] },
    { id: "2", name: "Susan Malandrino", email: "susan@example.org", role: "staff", departmentId: "1", weeklyCapacityHours: 32, active: true, managerId: "1", leadDepartmentIds: [] },
    { id: "3", name: "Aaron", email: "aaron@example.org", role: "staff", departmentId: "2", weeklyCapacityHours: 32, active: true, managerId: "1", leadDepartmentIds: [] },
    { id: "4", name: "Jeremy", email: "jeremy@example.org", role: "staff", departmentId: "3", weeklyCapacityHours: 32, active: true, managerId: "1", leadDepartmentIds: [] },
    { id: "5", name: "Dana Ortiz (sample)", email: "dana@example.org", role: "staff", departmentId: "2", weeklyCapacityHours: 36, active: true, managerId: "3", leadDepartmentIds: [] },
    { id: "6", name: "Priya Raman (sample)", email: "priya@example.org", role: "deptLead", departmentId: "2", weeklyCapacityHours: 36, active: true, managerId: "3", leadDepartmentIds: ["2"] },
    { id: "7", name: "Marcus Lee (sample)", email: "marcus@example.org", role: "deptLead", departmentId: "1", weeklyCapacityHours: 36, active: true, managerId: "2", leadDepartmentIds: ["1"] },
    { id: "9", name: "Taylor Brooks (sample)", email: "taylor@example.org", role: "deptLead", departmentId: "3", weeklyCapacityHours: 36, active: true, managerId: "4", leadDepartmentIds: ["3"] },
    { id: "8", name: "Board Observer (sample)", email: "viewer@example.org", role: "viewer", departmentId: null, weeklyCapacityHours: 0, active: true, managerId: null, leadDepartmentIds: [] },
  ];

  data.departments = [
    { id: "1", name: "Comms", parentId: null, ownerId: "2" },
    { id: "2", name: "Research", parentId: null, ownerId: "3" },
    { id: "3", name: "Ops", parentId: null, ownerId: "4" },
    { id: "4", name: "Leadership", parentId: null, ownerId: "1" },
    { id: "5", name: "Resourcing", parentId: "3", ownerId: "4" },
  ];

  data.outputTypes = STANDARD_OUTPUT_TYPES.map((name, i) => ({ id: String(i + 1), name, active: true, sortOrder: i + 1 }));

  data.linesOfEffort = [
    { id: "1", name: "U.S.-China AI competition", departmentId: "2", ownerId: "3", active: true,
      description: "Research and outreach on strategic competition in frontier AI between the U.S. and China." },
    { id: "2", name: "Frontier AI crisis management", departmentId: "2", ownerId: "5", active: true,
      description: "How governments prepare for and respond to AI security crises." },
    { id: "3", name: "Congressional engagement", departmentId: "4", ownerId: "1", active: true,
      description: "Briefings and relationships with congressional staff on AI security." },
    { id: "4", name: "Supporter development", departmentId: "3", ownerId: "4", active: true,
      description: "Convenings and events that build FSI's community of supporters." },
    { id: "5", name: "Talent pipeline", departmentId: "5", ownerId: "4", active: true,
      description: "Recruiting and developing fellows and staff." },
  ];

  const project = (p: Partial<Project> & Pick<Project, "id" | "title" | "departmentId" | "ownerId">): Project => ({
    lineOfEffortId: null, outputTypeIds: [], operationalDetails: "", startDate: null, dueDate: null,
    status: "inProgress", plannedBudget: 0, actualSpend: 0, createdAt: ts(-60), createdById: "1", ...p,
  });

  data.projects = [
    project({
      id: "1", lineOfEffortId: "1", title: "U.S.-China Strategic AI: Paper 1", departmentId: "2", ownerId: "3", outputTypeIds: ["1"],
      startDate: d(-45), dueDate: d(30),
      operationalDetails: "Three authors. External review by two research partners before release. Comms takes over for rollout when research completes.",
      plannedBudget: 12000, actualSpend: 4800,
    }),
    project({
      id: "2", lineOfEffortId: "1", title: "Paper 1 launch op-ed", departmentId: "1", ownerId: "2", outputTypeIds: ["2"],
      startDate: d(31), dueDate: d(45), status: "notStarted",
      operationalDetails: "Pitch to three outlets in order. Coordinate timing with the paper release.", plannedBudget: 0,
    }),
    project({
      id: "3", lineOfEffortId: "2", title: "Frontier AI crisis wargame", departmentId: "2", ownerId: "5", outputTypeIds: ["4"],
      startDate: d(-20), dueDate: d(75),
      operationalDetails: "Twelve players, two cells. Venue in D.C. Needs facilitator contracts.", plannedBudget: 30000, actualSpend: 9500,
    }),
    project({
      id: "4", lineOfEffortId: "3", title: "Congressional staff AI security briefing series", departmentId: "4", ownerId: "1", outputTypeIds: ["5"],
      startDate: d(-30), dueDate: d(60),
      operationalDetails: "Monthly briefings for committee staff. Rotate topics across the research agenda.", plannedBudget: 6000, actualSpend: 2100,
    }),
    project({
      id: "5", lineOfEffortId: "4", title: "Fall supporters dinner", departmentId: "3", ownerId: "4", outputTypeIds: ["3"],
      startDate: d(-10), dueDate: d(21),
      operationalDetails: "40 guests. Private room. Catering contract signed.", plannedBudget: 15000, actualSpend: 13200,
    }),
    project({
      id: "6", lineOfEffortId: "5", title: "Fellowship hiring round", departmentId: "5", ownerId: "4", outputTypeIds: [],
      startDate: d(-5), dueDate: d(120), plannedBudget: 2000, actualSpend: 0, status: "inProgress",
    }),
    // History: finished work the planning function learns from.
    project({
      id: "7", lineOfEffortId: "1", title: "Compute export controls explainer", departmentId: "2", ownerId: "6", outputTypeIds: ["1"],
      startDate: d(-200), dueDate: d(-120), status: "done", plannedBudget: 8000, actualSpend: 9400,
    }),
    project({
      id: "8", lineOfEffortId: "4", title: "Spring AI security convening", departmentId: "3", ownerId: "4", outputTypeIds: ["3"],
      startDate: d(-180), dueDate: d(-150), status: "done", plannedBudget: 20000, actualSpend: 18700,
    }),
  ];

  const task = (t: Partial<Task> & Pick<Task, "id" | "projectId" | "title">): Task => ({
    kind: "task", ownerId: null, startDate: null, dueDate: null, status: "notStarted",
    effortHours: 0, estimatedCost: 0, notes: "", sourceMeetingId: null, completedAt: null, ...t,
  });

  data.tasks = [
    // Paper 1
    task({ id: "1", projectId: "1", title: "Literature review", ownerId: "6", startDate: d(-45), dueDate: d(-20), status: "done", effortHours: 40, completedAt: ts(-21) }),
    task({ id: "2", projectId: "1", title: "Draft sections 1-3", ownerId: "3", startDate: d(-20), dueDate: d(-2), status: "inProgress", effortHours: 30 }),
    task({ id: "3", projectId: "1", title: "Draft sections 4-6", ownerId: "5", startDate: d(-15), dueDate: d(4), status: "inProgress", effortHours: 30 }),
    task({ id: "4", projectId: "1", title: "External review", ownerId: "3", startDate: d(5), dueDate: d(18), effortHours: 10, estimatedCost: 3000 }),
    task({ id: "5", projectId: "1", title: "Copyedit and layout", ownerId: "7", startDate: d(19), dueDate: d(26), effortHours: 16, estimatedCost: 2500 }),
    task({ id: "6", projectId: "1", title: "Research complete", kind: "milestone", ownerId: "3", startDate: d(30), dueDate: d(30) }),
    // Op-ed
    task({ id: "7", projectId: "2", title: "Draft op-ed", ownerId: "7", startDate: d(31), dueDate: d(36), effortHours: 8 }),
    task({ id: "8", projectId: "2", title: "Pitch outlets", ownerId: "2", startDate: d(37), dueDate: d(44), effortHours: 4 }),
    // Wargame
    task({ id: "9", projectId: "3", title: "Scenario design", ownerId: "5", startDate: d(-20), dueDate: d(6), status: "inProgress", effortHours: 35 }),
    task({ id: "10", projectId: "3", title: "Book venue", ownerId: "4", startDate: d(-5), dueDate: d(-1), effortHours: 3, estimatedCost: 6000 }),
    task({ id: "11", projectId: "3", title: "Recruit players", ownerId: "1", startDate: d(7), dueDate: d(35), effortHours: 12 }),
    task({ id: "12", projectId: "3", title: "Wargame day", kind: "event", ownerId: "5", startDate: d(70), dueDate: d(70), effortHours: 10, estimatedCost: 9000 }),
    // Briefings
    task({ id: "13", projectId: "4", title: "Briefing 2: compute governance", kind: "event", ownerId: "1", startDate: d(3), dueDate: d(3), effortHours: 6, estimatedCost: 700 }),
    task({ id: "14", projectId: "4", title: "Prepare briefing 2 slides", ownerId: "6", startDate: d(-4), dueDate: d(2), status: "inProgress", effortHours: 10 }),
    // Dinner
    task({ id: "15", projectId: "5", title: "Send invitations", ownerId: "4", startDate: d(-10), dueDate: d(-3), status: "done", effortHours: 4, completedAt: ts(-4) }),
    task({ id: "16", projectId: "5", title: "Final headcount to caterer", ownerId: "4", startDate: d(10), dueDate: d(14), effortHours: 1 }),
    task({ id: "17", projectId: "5", title: "Supporters dinner", kind: "event", ownerId: "1", startDate: d(21), dueDate: d(21), effortHours: 4, estimatedCost: 1500 }),
    // Hiring
    task({ id: "18", projectId: "6", title: "Post fellowship call", ownerId: "4", startDate: d(-5), dueDate: d(5), status: "inProgress", effortHours: 4, estimatedCost: 500 }),
    task({ id: "19", projectId: "6", title: "Review applications", ownerId: "3", startDate: d(40), dueDate: d(70), effortHours: 20 }),
    // History
    task({ id: "20", projectId: "7", title: "Draft explainer", ownerId: "6", startDate: d(-200), dueDate: d(-140), status: "done", effortHours: 50, completedAt: ts(-135) }),
    task({ id: "21", projectId: "8", title: "Run convening", kind: "event", ownerId: "4", startDate: d(-150), dueDate: d(-150), status: "done", effortHours: 20, completedAt: ts(-150) }),
  ];

  data.dependencies = [
    { id: "1", predecessorId: "1", successorId: "2" },
    { id: "2", predecessorId: "2", successorId: "4" },
    { id: "3", predecessorId: "3", successorId: "4" },
    { id: "4", predecessorId: "4", successorId: "5" },
    { id: "5", predecessorId: "5", successorId: "6" },
    { id: "6", predecessorId: "6", successorId: "7" },
    { id: "7", predecessorId: "7", successorId: "8" },
    { id: "8", predecessorId: "9", successorId: "11" },
    { id: "9", predecessorId: "14", successorId: "13" },
    { id: "10", predecessorId: "16", successorId: "17" },
  ];

  data.memberships = [
    { id: "1", targetType: "project", targetId: "1", personId: "5", status: "accepted", invitedById: "3", invitedAt: ts(-45) },
    { id: "2", targetType: "project", targetId: "1", personId: "6", status: "accepted", invitedById: "3", invitedAt: ts(-45) },
    { id: "3", targetType: "project", targetId: "1", personId: "7", status: "invited", invitedById: "3", invitedAt: ts(-2) },
    { id: "4", targetType: "task", targetId: "17", personId: "2", status: "accepted", invitedById: "4", invitedAt: ts(-9) },
    { id: "5", targetType: "task", targetId: "17", personId: "3", status: "invited", invitedById: "4", invitedAt: ts(-9) },
  ];

  data.projectLinks = [
    { id: "1", fromProjectId: "1", toProjectId: "2", note: "Op-ed launches the paper" },
    { id: "2", fromProjectId: "1", toProjectId: "4", note: "Paper findings feed briefing 3" },
  ];

  const stage = (s: Partial<Stage> & Pick<Stage, "id" | "projectId" | "order" | "name" | "ownerId" | "departmentId">): Stage => ({
    status: "pending", completedAt: null, handoffNote: "", handoffDate: null, handoffTaskId: null, ...s,
  });
  data.stages = [
    stage({ id: "1", projectId: "1", order: 1, name: "Research", ownerId: "3", departmentId: "2", status: "active", handoffDate: d(30), handoffTaskId: "6" }),
    stage({ id: "2", projectId: "1", order: 2, name: "Comms rollout", ownerId: "2", departmentId: "1", handoffNote: "Comms owns release, press, and social once research is complete." }),
    stage({ id: "3", projectId: "3", order: 1, name: "Design", ownerId: "5", departmentId: "2", status: "active" }),
    stage({ id: "4", projectId: "3", order: 2, name: "Logistics", ownerId: "4", departmentId: "3" }),
    stage({ id: "5", projectId: "3", order: 3, name: "Results write-up", ownerId: "5", departmentId: "2" }),
  ];

  data.relationshipLinks = [
    { id: "1", projectId: "1", externalId: "C-1001", kind: "contact", name: "Sample Reviewer A", organization: "Sample University Lab", group: "research", note: "External reviewer", syncedAt: null },
    { id: "2", projectId: "3", externalId: "O-2001", kind: "organization", name: "Sample Defense Office", organization: "Sample Defense Office", group: "government", note: "Player cell", syncedAt: null },
    { id: "3", projectId: "2", externalId: "C-1004", kind: "contact", name: "Sample Editor", organization: "Sample Daily", group: "media", note: "First pitch", syncedAt: null },
  ];

  const audit = (a: Omit<AuditEntry, "id" | "changedByEmail"> & { id: string }): AuditEntry => ({
    ...a, changedByEmail: data.people.find((p) => p.id === a.changedById)?.email ?? "",
  });
  data.audit = [
    audit({ id: "1", entityType: "project", entityId: "7", projectId: "7", field: "dueDate", oldValue: d(-150), newValue: d(-120), reason: "Reviewer feedback needed a new section on chip smuggling", changedById: "6", changedAt: ts(-155) }),
    audit({ id: "2", entityType: "project", entityId: "8", projectId: "8", field: "dueDate", oldValue: d(-160), newValue: d(-150), reason: "Venue fell through; rebooked", changedById: "4", changedAt: ts(-175) }),
    audit({ id: "3", entityType: "task", entityId: "2", projectId: "1", field: "dueDate", oldValue: d(-8), newValue: d(-2), reason: "Author out sick for a week", changedById: "3", changedAt: ts(-9) }),
    audit({ id: "4", entityType: "project", entityId: "3", projectId: "3", field: "dueDate", oldValue: d(60), newValue: d(75), reason: "Key government players unavailable before then", changedById: "5", changedAt: ts(-12) }),
  ];

  const budget = (b: Omit<BudgetChange, "changedByEmail">): BudgetChange => ({
    ...b, changedByEmail: data.people.find((p) => p.id === b.changedById)?.email ?? "",
  });
  data.budgetChanges = [
    budget({ id: "1", projectId: "7", field: "actual", oldValue: 8000, newValue: 9400, reason: "Extra design work for charts", changedById: "6", changedAt: ts(-125) }),
    budget({ id: "2", projectId: "5", field: "planned", oldValue: 12000, newValue: 15000, reason: "Guest list grew from 30 to 40", changedById: "4", changedAt: ts(-20) }),
    budget({ id: "3", projectId: "5", field: "actual", oldValue: 9000, newValue: 13200, reason: "Catering deposit paid", changedById: "4", changedAt: ts(-6) }),
  ];

  data.meetings = [
    { id: "1", title: "Daily stand-up", meetingType: "daily", date: d(-1), notes: "Paper 1 sections 1-3 running late. Venue booking for wargame still open.", attendeeIds: ["1", "2", "3", "4"], createdById: "1", departmentId: "4", teamsMeetingId: "", teamsJoinUrl: "", transcript: "" },
    { id: "2", title: "Research weekly", meetingType: "weekly", date: d(-3), notes: "Wargame scenario draft reviewed. Paper 1 reviewers confirmed.", attendeeIds: ["3", "5", "6"], createdById: "3", departmentId: "2", teamsMeetingId: "", teamsJoinUrl: "", transcript: "" },
    { id: "3", title: "Comms planning", meetingType: "weekly", date: d(-2), notes: "Op-ed outlets shortlisted.", attendeeIds: ["2", "7"], createdById: "2", departmentId: "1", teamsMeetingId: "", teamsJoinUrl: "", transcript: "" },
    { id: "4", title: "Ops monthly review", meetingType: "monthly", date: d(-8), notes: "Dinner budget raised. Fellowship call drafted.", attendeeIds: ["4", "9"], createdById: "4", departmentId: "3", teamsMeetingId: "", teamsJoinUrl: "", transcript: "" },
  ];

  return data;
}
