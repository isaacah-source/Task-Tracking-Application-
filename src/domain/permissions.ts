// Who may do what. Admins can do everything. Department owners edit every project in their
// department and its sub-departments. Staff edit projects they own or belong to. Viewers
// only read.

import type { DataSet, Department, ID, Person, Project } from "./types";

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

/** Departments this person owns, including sub-departments under them. */
export function ownedDepartmentIds(me: Person, departments: Department[]): Set<ID> {
  const out = new Set<ID>();
  for (const d of departments.filter((x) => x.ownerId === me.id)) {
    for (const id of departmentTree(d.id, departments)) out.add(id);
  }
  return out;
}

export function canEditProject(me: Person | null, project: Project, data: Pick<DataSet, "departments" | "memberships">): boolean {
  if (!canWrite(me)) return false;
  if (isAdmin(me)) return true;
  if (project.ownerId === me!.id) return true;
  if (ownedDepartmentIds(me!, data.departments).has(project.departmentId)) return true;
  return data.memberships.some(
    (m) => m.targetType === "project" && m.targetId === project.id && m.personId === me!.id && m.status === "accepted",
  );
}

/** Label shown next to a person's name: their role, plus "Dept owner" where it applies. */
export function roleLabel(p: Person, departments: Department[]): string {
  const owned = departments.filter((d) => d.ownerId === p.id).map((d) => d.name);
  const base = p.role === "admin" ? "Admin" : p.role === "viewer" ? "Viewer" : "Staff";
  return owned.length ? `${base} · Owner: ${owned.join(", ")}` : base;
}
