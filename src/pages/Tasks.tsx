import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Printer } from "lucide-react";
import { useStore } from "@/data/store";
import type { Task } from "@/domain/types";
import { HORIZON_LABELS, STATUS_LABELS, TASK_KIND_LABELS } from "@/domain/types";
import { blockedTaskIds, blockers } from "@/domain/dependencies";
import { departmentTree } from "@/domain/permissions";
import { dueFlag, inReview, REVIEW_PERIOD_LABELS, reviewWindow, type ReviewPeriod } from "@/domain/flags";
import { formatDate } from "@/domain/dates";
import { BlockedBadge, DateText, DepartmentSelect, DueFlag, Empty, PageHeader, PersonSelect, StatusBadge, deptName, money, personName } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type SortKey = "title" | "project" | "department" | "owner" | "kind" | "horizon" | "startDate" | "dueDate" | "status" | "effortHours" | "estimatedCost" | "flag";

const FLAG_RANK = { overdue: 0, dueSoon: 1, blocked: 2, none: 3 };
const STATUS_RANK = { inProgress: 0, notStarted: 1, onHold: 2, done: 3 };

/**
 * The shared list for daily meetings and monthly, quarterly, and yearly reviews. Sort by any
 * column. Overdue and due-this-week work is flagged and always included.
 */
export default function TasksPage() {
  const { data, today } = useStore();
  const [period, setPeriod] = useState<ReviewPeriod>("daily");
  const [dept, setDept] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [flagOnly, setFlagOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "flag", dir: 1 });

  const blocked = useMemo(() => blockedTaskIds(data.tasks, data.dependencies), [data]);
  const project = (t: Task) => data.projects.find((p) => p.id === t.projectId);
  const flagOf = (t: Task): keyof typeof FLAG_RANK => dueFlag(t.dueDate, t.status, today) ?? (blocked.has(t.id) ? "blocked" : "none");

  const rows = useMemo(() => {
    const depts = dept ? departmentTree(dept, data.departments) : null;
    const value = (t: Task, k: SortKey): string | number => {
      switch (k) {
        case "project": return project(t)?.title ?? "";
        case "department": return deptName(data, project(t)?.departmentId);
        case "owner": return personName(data, t.ownerId);
        case "flag": return FLAG_RANK[flagOf(t)] * 1e9 + Number((t.dueDate ?? "9999-12-31").replace(/-/g, ""));
        case "status": return STATUS_RANK[t.status];
        case "startDate": case "dueDate": return t[k] ?? "9999";
        case "effortHours": case "estimatedCost": return t[k];
        default: return String(t[k]);
      }
    };
    return data.tasks
      .filter((t) => inReview(t, period, today))
      .filter((t) => !depts || depts.has(project(t)?.departmentId ?? ""))
      .filter((t) => !owner || t.ownerId === owner)
      .filter((t) => !flagOnly || flagOf(t) !== "none")
      .sort((a, b) => {
        const va = value(a, sort.key);
        const vb = value(b, sort.key);
        const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
        return c * sort.dir || (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, period, dept, owner, flagOnly, sort, today, blocked]);

  const w = reviewWindow(period, today);
  const counts = {
    overdue: rows.filter((t) => flagOf(t) === "overdue").length,
    soon: rows.filter((t) => flagOf(t) === "dueSoon").length,
    blocked: rows.filter((t) => blocked.has(t.id)).length,
  };

  const Header = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <TH className={className}>
      <button
        className="inline-flex items-center gap-1 uppercase hover:text-foreground"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))}
      >
        {children}
        {sort.key === k ? (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </TH>
  );

  return (
    <>
      <PageHeader
        title="Task list"
        description="For daily meetings and monthly, quarterly, and yearly reviews. Click any column to sort."
        actions={<Button variant="outline" onClick={() => window.print()}><Printer />Print</Button>}
      />

      <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-muted p-1 print:hidden">
        {(Object.keys(REVIEW_PERIOD_LABELS) as ReviewPeriod[]).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground", period === p && "bg-card text-foreground shadow")}>
            {REVIEW_PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-3 print:hidden">
        <DepartmentSelect departments={data.departments} value={dept} onChange={setDept} allowEmpty />
        <PersonSelect people={data.people} value={owner} onChange={setOwner} allowEmpty emptyLabel="Everyone" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={flagOnly} onChange={(e) => setFlagOnly(e.target.checked)} /> Only flagged (overdue, due this week, blocked)
        </label>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        {w ? `${formatDate(w.from)} to ${formatDate(w.to)}, plus anything overdue. ` : "All tasks. "}
        <span className="font-medium text-red-700">{counts.overdue} overdue</span> · <span className="font-medium text-amber-800">{counts.soon} due this week</span> · {counts.blocked} blocked · {rows.length} total
      </p>

      {rows.length === 0 ? <Empty>Nothing in this period.</Empty> : (
        <Table>
          <THead>
            <TR>
              <Header k="flag">Flag</Header>
              <Header k="title">Task</Header>
              <Header k="project">Project</Header>
              <Header k="department">Department</Header>
              <Header k="owner">Owner</Header>
              <Header k="kind">Type</Header>
              <Header k="horizon">Horizon</Header>
              <Header k="startDate">Start</Header>
              <Header k="dueDate">Due</Header>
              <Header k="status">Status</Header>
              <Header k="effortHours" className="text-right">Hours</Header>
              <Header k="estimatedCost" className="text-right">Cost</Header>
            </TR>
          </THead>
          <TBody>
            {rows.map((t) => {
              const f = flagOf(t);
              return (
                <TR key={t.id} className={cn(f === "overdue" && "bg-red-50/60", f === "dueSoon" && "bg-amber-50/60")}>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      <DueFlag dueDate={t.dueDate} status={t.status} today={today} />
                      {blocked.has(t.id) && <BlockedBadge waitingOn={blockers(t, data.tasks, data.dependencies).map((b) => b.title)} />}
                    </div>
                  </TD>
                  <TD className="min-w-[12rem] max-w-xs font-medium"><Link to={`/projects/${t.projectId}?task=${t.id}`} className="hover:underline">{t.title}</Link></TD>
                  <TD className="max-w-[12rem] truncate"><Link to={`/projects/${t.projectId}`} className="hover:underline">{project(t)?.title}</Link></TD>
                  <TD className="whitespace-nowrap">{deptName(data, project(t)?.departmentId)}</TD>
                  <TD className="whitespace-nowrap">{personName(data, t.ownerId)}</TD>
                  <TD>{TASK_KIND_LABELS[t.kind]}</TD>
                  <TD>{HORIZON_LABELS[t.horizon]}</TD>
                  <TD className="whitespace-nowrap">{t.startDate ? formatDate(t.startDate) : ""}</TD>
                  <TD className="whitespace-nowrap"><DateText date={t.dueDate} status={t.status} today={today} /></TD>
                  <TD title={STATUS_LABELS[t.status]}><StatusBadge status={t.status} /></TD>
                  <TD className="text-right">{t.effortHours || ""}</TD>
                  <TD className="text-right">{t.estimatedCost ? money(t.estimatedCost) : ""}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}
