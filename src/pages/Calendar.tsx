import { useMemo, useState } from "react";
import { useStore } from "@/data/store";
import { departmentTree } from "@/domain/permissions";
import { dueFlag } from "@/domain/flags";
import { startOfMonth } from "@/domain/dates";
import { departmentOptions, PageHeader, personName } from "@/components/common";
import { MonthCalendar, type CalendarItem } from "@/components/MonthCalendar";
import { Select } from "@/components/ui/input";

/** Org-wide calendar, narrowed to a department or sub-department when chosen. */
export default function CalendarPage() {
  const { data, today } = useStore();
  const [month, setMonth] = useState(startOfMonth(today));
  const [scope, setScope] = useState("");
  const [showTasks, setShowTasks] = useState(true);

  const items = useMemo<CalendarItem[]>(() => {
    const depts = scope ? departmentTree(scope, data.departments) : null;
    const inScope = (deptId: string) => !depts || depts.has(deptId);
    const out: CalendarItem[] = [];
    for (const p of data.projects) {
      if (!inScope(p.departmentId) || !p.dueDate) continue;
      out.push({ id: `p${p.id}`, date: p.dueDate, label: `Due: ${p.title}`, href: `/projects/${p.id}`, tone: p.status === "done" ? "done" : "project", title: `Project due: ${p.title}` });
    }
    for (const t of data.tasks) {
      const p = data.projects.find((x) => x.id === t.projectId);
      if (!p || !inScope(p.departmentId) || !t.dueDate) continue;
      if (t.kind === "task" && !showTasks) continue;
      const overdue = dueFlag(t.dueDate, t.status, today) === "overdue";
      out.push({
        id: `t${t.id}`,
        date: t.kind === "event" ? (t.startDate ?? t.dueDate) : t.dueDate,
        endDate: t.kind === "event" && t.startDate && t.startDate < t.dueDate ? t.dueDate : undefined,
        label: t.title,
        href: `/projects/${t.projectId}?task=${t.id}`,
        tone: t.status === "done" ? "done" : overdue ? "overdue" : t.kind,
        title: `${t.title} · ${personName(data, t.ownerId)} · ${p.title}`,
      });
    }
    return out;
  }, [data, scope, showTasks, today]);

  return (
    <>
      <PageHeader title="Calendar" description="Deadlines, events, and milestones across FSI." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select className="w-auto min-w-[14rem]" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">Whole organization</option>
          {departmentOptions(data.departments).map((d) => (
            <option key={d.id} value={d.id}>{`${"   ".repeat(d.depth)}${d.depth ? "› " : ""}${d.label}`}</option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showTasks} onChange={(e) => setShowTasks(e.target.checked)} /> Show task deadlines (events and milestones always show)
        </label>
      </div>
      <MonthCalendar month={month} onMonth={setMonth} items={items} today={today} />
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <Key className="bg-slate-800" label="Project due" />
        <Key className="bg-violet-200" label="Event" />
        <Key className="bg-fuchsia-100" label="Milestone" />
        <Key className="bg-blue-100" label="Task due" />
        <Key className="bg-red-100" label="Overdue" />
        <Key className="bg-emerald-100" label="Done" />
      </div>
    </>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={`h-3 w-3 rounded-sm ${className}`} />{label}</span>;
}
