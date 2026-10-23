import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "@/data/store";
import type { ID, Person } from "@/domain/types";
import { departmentTree, effectiveManagers, isAdmin } from "@/domain/permissions";
import { DepartmentSelect, Empty, PageHeader, deptName } from "@/components/common";
import { Badge } from "@/components/ui/badge";

/**
 * Who reports to whom. Uses each person's "Reports to"; anyone without one sits under their
 * department's owner. Choosing a department shows just that department and its sub-departments.
 */
export default function OrgChartPage() {
  const { data } = useStore();
  const [dept, setDept] = useState<ID | null>(null);

  const { roots, children, shown } = useMemo(() => {
    const scope = dept ? departmentTree(dept, data.departments) : null;
    const shown = data.people.filter((p) => p.active && p.role !== "viewer" && (!scope || (p.departmentId && scope.has(p.departmentId))));
    const ids = new Set(shown.map((p) => p.id));
    const managers = effectiveManagers(data.people, data.departments);
    const children = new Map<ID, Person[]>();
    const roots: Person[] = [];
    for (const p of shown) {
      // Walk up past anyone not shown (another department, inactive) to the nearest shown manager.
      let m = managers.get(p.id) ?? null;
      while (m && !ids.has(m)) m = managers.get(m) ?? null;
      if (m) children.set(m, [...(children.get(m) ?? []), p]);
      else roots.push(p);
    }
    const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
    for (const list of children.values()) list.sort(byName);
    return { roots: roots.sort(byName), children, shown };
  }, [data, dept]);

  const viewers = data.people.filter((p) => p.active && p.role === "viewer").length;

  return (
    <>
      <PageHeader
        title="Org chart"
        description='Who reports to whom. Admins set "Reports to" on Admin, People and roles; anyone without it appears under their department owner.'
      />
      <div className="mb-4 max-w-xs">
        <DepartmentSelect departments={data.departments} value={dept} onChange={setDept} allowEmpty emptyLabel="Whole organization" />
      </div>
      {shown.length === 0 ? <Empty>No one in this department yet.</Empty> : (
        <div className="overflow-x-auto rounded-lg border bg-card p-6">
          <div className="org-chart mx-auto w-max">
            <ul>
              {roots.map((p) => <Node key={p.id} person={p} kids={children} />)}
            </ul>
          </div>
        </div>
      )}
      {viewers > 0 && <p className="mt-3 text-xs text-muted-foreground">{viewers} view-only account{viewers === 1 ? " is" : "s are"} not shown.</p>}
    </>
  );
}

function Node({ person, kids }: { person: Person; kids: Map<ID, Person[]> }) {
  const reports = kids.get(person.id) ?? [];
  return (
    <li>
      <PersonCard person={person} />
      {reports.length > 0 && (
        <ul>
          {reports.map((c) => <Node key={c.id} person={c} kids={kids} />)}
        </ul>
      )}
    </li>
  );
}

/** One color for every title, and long titles wrap inside the card instead of running past it. */
const TITLE = "max-w-full whitespace-normal break-words text-left leading-snug";

function PersonCard({ person }: { person: Person }) {
  const { data, me } = useStore();
  const owns = data.departments.filter((d) => d.ownerId === person.id);
  const leads = person.role === "deptLead" ? person.leadDepartmentIds.map((id) => data.departments.find((d) => d.id === id)?.name).filter(Boolean) : [];
  const open = data.tasks.filter((t) => t.ownerId === person.id && t.status !== "done").length;
  return (
    <div className={`inline-block w-48 rounded-lg border bg-card p-3 text-left shadow-sm ${owns.length ? "border-primary" : ""}`}>
      <div className="font-semibold leading-tight">{person.name}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{deptName(data, person.departmentId) || "No department"}</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {person.role === "admin" && <Badge variant="info" className={TITLE}>Admin</Badge>}
        {owns.map((d) => <Badge key={d.id} variant="info" className={TITLE}>Owner: {d.name}</Badge>)}
        {leads.length > 0 && <Badge variant="info" className={TITLE}>Task Lead: {leads.join(", ")}</Badge>}
      </div>
      {isAdmin(me) ? (
        <Link to="/people" className="mt-2 block text-xs text-muted-foreground hover:underline">{open} open task{open === 1 ? "" : "s"}</Link>
      ) : (
        <div className="mt-2 text-xs text-muted-foreground">{open} open task{open === 1 ? "" : "s"}</div>
      )}
    </div>
  );
}
