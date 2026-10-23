// Who may do what.
// - Admins can do everything.
// - Department owners (the senior person in a department) edit every project in their
//   department and its sub-departments.
// - Department Task Leads keep the data for their assigned departments: they edit and
//   delete there.
// - Staff add projects and tasks, and edit projects they own or have joined.
// - Viewers only read.
// Deleting is for admins and Department Task Leads only.

import type { DataSet, Department, ID, MeetingNote, Person, Project } from "./types";
import { ROLE_LABELS } from "./types";

export function isAdmin(me: Person | null): boolean {
  return me?.role === "admin" && me.active;
}

export function canWrite(me: Person | null): boolean {
  return !!me && me.active && me.role !== "viewer";
}

/** A department plus all of its sub-departments (any depth). */
export function departmentTree(rootId: ID, departments: Department[]): Set<ID> {
  const out = new Set<ID>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of departments) {
      if (d.parentId && out.has(d.parentId) && !out.has(d.id)) {
        out.add(d.id);
        grew = true;
      }
    }
  }
  return out;
}

function trees(rootIds: ID[], departments: Department[]): Set<ID> {
  const out = new Set<ID>();
  for (const id of rootIds) for (const d of departmentTree(id, departments)) out.add(d);
  return out;
}

/**
 * Meeting notes: admins read all of them. Everyone else reads notes for meetings they were
 * in or wrote, and notes filed under their own department (with its sub-departments) or a
 * department they own or lead. Notes with no department are for their attendees and admins.
 */
export function canSeeMeeting(me: Person | null, m: MeetingNote, departments: Department[]): boolean {
  if (!me) return false;
  if (isAdmin(me)) return true;
  if (m.attendeeIds.includes(me.id) || m.createdById === me.id) return true;
  if (!m.departmentId) return false;
  if (me.departmentId && departmentTree(me.departmentId, departments).has(m.departmentId)) return true;
  return ownedDepartmentIds(me, departments).has(m.departmentId) || leadDepartmentScope(me, departments).has(m.departmentId);
}

/**
 * Lines of effort in a department: admins, that department's owner (or an owner above it), and
 * its Department Task Leads may add and change them.
 */
export function canManageLinesOfEffort(me: Person | null, departmentId: ID, departments: Department[]): boolean {
  if (!canWrite(me)) return false;
  if (isAdmin(me)) return true;
  return ownedDepartmentIds(me!, departments).has(departmentId) || leadDepartmentScope(me, departments).has(departmentId);
}

/** Departments this person owns, including sub-departments under them. */
export function ownedDepartmentIds(me: Person, departments: Department[]): Set<ID> {
  return trees(departments.filter((d) => d.ownerId === me.id).map((d) => d.id), departments);
}

/** Departments a Department Task Lead keeps data for, including sub-departments. */
export function leadDepartmentScope(me: Person | null, departments: Department[]): Set<ID> {
  if (!me?.active || me.role !== "deptLead") return new Set();
  return trees(me.leadDepartmentIds, departments);
}

export function canEditProject(me: Person | null, project: Project, data: Pick<DataSet, "departments" | "memberships">): boolean {
  if (!canWrite(me)) return false;
  if (isAdmin(me)) return true;
  if (project.ownerId === me!.id) return true;
  if (ownedDepartmentIds(me!, data.departments).has(project.departmentId)) return true;
  if (leadDepartmentScope(me, data.departments).has(project.departmentId)) return true;
  return data.memberships.some(
    (m) => m.targetType === "project" && m.targetId === project.id && m.personId === me!.id && m.status === "accepted",
  );
}

/** Deleting anything in a project: admins, and Department Task Leads for that department. */
export function canDeleteInDepartment(me: Person | null, departmentId: ID, departments: Department[]): boolean {
  if (isAdmin(me)) return true;
  return leadDepartmentScope(me, departments).has(departmentId);
}

/** Label shown next to a person's name: their role, lead departments, and departments they own. */
export function roleLabel(p: Person, departments: Department[]): string {
  const name = (id: ID) => departments.find((d) => d.id === id)?.name ?? "";
  let base = ROLE_LABELS[p.role];
  if (p.role === "deptLead" && p.leadDepartmentIds.length) base += ` (${p.leadDepartmentIds.map(name).filter(Boolean).join(", ")})`;
  const owned = departments.filter((d) => d.ownerId === p.id).map((d) => d.name);
  return owned.length ? `${base} · Owner: ${owned.join(", ")}` : base;
}

/**
 * Who each person reports to on the org chart. Uses "Reports to" when set; otherwise the
 * owner of their department (or of the parent department, for an owner of a sub-department).
 * Never returns a chain that loops back on itself.
 */
export function effectiveManagers(people: Person[], departments: Department[]): Map<ID, ID | null> {
  const ids = new Set(people.map((p) => p.id));
  const ownerOf = (deptId: ID | null) => departments.find((d) => d.id === deptId)?.ownerId ?? null;
  const guess = (p: Person): ID | null => {
    if (p.managerId && ids.has(p.managerId) && p.managerId !== p.id) return p.managerId;
    const dept = departments.find((d) => d.id === p.departmentId);
    if (!dept) return null;
    if (dept.ownerId && dept.ownerId !== p.id) return dept.ownerId;
    // The person owns their own department: they report to the parent department's owner.
    const up = ownerOf(dept.parentId);
    return up && up !== p.id ? up : null;
  };
  const out = new Map<ID, ID | null>(people.map((p) => [p.id, guess(p)]));
  // Break any loop by cutting the link that closes it.
  for (const p of people) {
    const seen = new Set<ID>([p.id]);
    let cur = out.get(p.id) ?? null;
    while (cur) {
      if (seen.has(cur)) {
        out.set(p.id, null);
        break;
      }
      seen.add(cur);
      cur = out.get(cur) ?? null;
    }
  }
  return out;
}

/** True when making `managerId` this person's manager would create a reporting loop. */
export function wouldLoopReporting(personId: ID, managerId: ID | null, people: Person[]): boolean {
  let cur = managerId;
  const seen = new Set<ID>();
  while (cur) {
    if (cur === personId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = people.find((p) => p.id === cur)?.managerId ?? null;
  }
  return false;
}
