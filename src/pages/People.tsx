import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "@/data/store";
import { departmentTree } from "@/domain/permissions";
import { personLoad, type LoadLevel, type PersonLoad } from "@/domain/load";
import { formatShort } from "@/domain/dates";
import { DepartmentSelect, PageHeader, deptName } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const LEVEL: Record<LoadLevel, { label: string; bar: string; badge: "success" | "info" | "warning" | "danger" }> = {
  light: { label: "Light", bar: "bg-emerald-500", badge: "success" },
  steady: { label: "Steady", bar: "bg-blue-500", badge: "info" },
  high: { label: "Near capacity", bar: "bg-amber-500", badge: "warning" },
  over: { label: "Over capacity", bar: "bg-red-600", badge: "danger" },
};

/** Live workload per person: open tasks, booked hours against capacity, and deadlines. */
export default function PeoplePage() {
  const { data, today } = useStore();
  const [dept, setDept] = useState<string | null>(null);

  const loads = useMemo(() => {
    const depts = dept ? departmentTree(dept, data.departments) : null;
    return data.people
      .filter((p) => p.active && p.role !== "viewer")
      .filter((p) => !depts || (p.departmentId && depts.has(p.departmentId)))
      .map((p) => personLoad(p, data, today))
      .sort((a, b) => b.utilization - a.utilization);
  }, [data, dept, today]);

  return (
    <>
      <PageHeader
        title="Workload"
        description="Hours come from each open task's effort estimate, spread over the weekdays until it is due. Updates as tasks change."
      />
      <div className="mb-4 max-w-xs">
        <DepartmentSelect departments={data.departments} value={dept} onChange={setDept} allowEmpty />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loads.map((l) => <PersonCard key={l.person.id} l={l} />)}
      </div>
    </>
  );
}

function PersonCard({ l }: { l: PersonLoad }) {
  const { data, today } = useStore();
  const pct = l.capacityNext7 > 0 ? Math.min(100, Math.round((l.hoursNext7 / l.capacityNext7) * 100)) : l.hoursNext7 > 0 ? 100 : 0;
  const projectTitle = (id: string) => data.projects.find((p) => p.id === id)?.title ?? "";
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>{l.person.name}</CardTitle>
          <div className="text-xs text-muted-foreground">{deptName(data, l.person.departmentId) || "No department"} · {l.person.weeklyCapacityHours} h/week</div>
        </div>
        <Badge variant={LEVEL[l.level].badge}>{LEVEL[l.level].label}</Badge>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span>Next 7 days</span>
            <span className="font-medium">{Math.round(l.hoursNext7)} of {Math.round(l.capacityNext7)} h</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full", LEVEL[l.level].bar)} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Next 4 weeks: {Math.round(l.hoursNext28)} of {Math.round(l.capacityNext28)} h</div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">{l.openTasks.length} open task{l.openTasks.length === 1 ? "" : "s"}</Badge>
          <Badge variant="outline">{l.activeProjects.length} project{l.activeProjects.length === 1 ? "" : "s"}</Badge>
          {l.overdue.length > 0 && <Badge variant="danger">{l.overdue.length} overdue</Badge>}
          {l.blockedCount > 0 && <Badge variant="muted">{l.blockedCount} blocked</Badge>}
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Coming up (14 days)</div>
          {l.upcoming.length === 0 && l.overdue.length === 0 ? <p className="text-sm text-muted-foreground">Nothing due.</p> : (
            <ul className="grid gap-1 text-sm">
              {[...l.overdue, ...l.upcoming].slice(0, 6).map((t) => (
                <li key={t.id} className="flex justify-between gap-2">
                  <Link to={`/projects/${t.projectId}?task=${t.id}`} className="truncate hover:underline" title={projectTitle(t.projectId)}>{t.title}</Link>
                  <span className={cn("shrink-0 text-xs", t.dueDate! < today ? "font-semibold text-red-700" : "text-muted-foreground")}>{formatShort(t.dueDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
