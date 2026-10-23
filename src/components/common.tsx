import type { ReactNode } from "react";
import { AlertTriangle, Clock, Lock } from "lucide-react";
import type { DataSet, Department, ID, Person, Stage, Status } from "@/domain/types";
import { STATUS_LABELS } from "@/domain/types";
import { dueFlag } from "@/domain/flags";
import { formatDate } from "@/domain/dates";
import { Badge } from "./ui/badge";
import { Select } from "./ui/input";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

const STATUS_VARIANT: Record<Status, "muted" | "info" | "success" | "warning"> = {
  notStarted: "muted",
  inProgress: "info",
  done: "success",
  onHold: "warning",
};

export function StatusBadge({ status }: { status: Status }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function DueFlag({ dueDate, status, today }: { dueDate: string | null; status: Status; today: string }) {
  const f = dueFlag(dueDate, status, today);
  if (f === "overdue") return <Badge variant="danger"><AlertTriangle className="h-3 w-3" />Overdue</Badge>;
  if (f === "dueSoon") return <Badge variant="warning"><Clock className="h-3 w-3" />Due this week</Badge>;
  return null;
}

export function BlockedBadge({ waitingOn }: { waitingOn: string[] }) {
  return (
    <Badge variant="outline" className="border-red-300 text-red-700" title={`Waiting on: ${waitingOn.join(", ")}`}>
      <Lock className="h-3 w-3" />Blocked
    </Badge>
  );
}

export function DateText({ date, status, today }: { date: string | null; status: Status; today: string }) {
  if (!date) return <span className="text-muted-foreground">None</span>;
  const f = dueFlag(date, status, today);
  return <span className={cn(f === "overdue" && "font-semibold text-red-700", f === "dueSoon" && "font-semibold text-amber-800")}>{formatDate(date)}</span>;
}

export function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Says which stages a completed handoff milestone finished and who has the project now. */
export function handoffMessage(done: Stage[], data: Pick<DataSet, "people" | "stages">): string {
  const last = done[done.length - 1];
  const next = data.stages.filter((s) => s.projectId === last.projectId && s.order > last.order).sort((a, b) => a.order - b.order)[0];
  const names = done.map((s) => `"${s.name}"`).join(", ");
  return `${names} complete; ${next ? `handed to ${personName(data, next.ownerId)} for ${next.name}` : "project done"}.`;
}

/** Lines of effort grouped by department. Inactive ones show only when already chosen. */
export function LineOfEffortSelect({ data, value, onChange, disabled, emptyLabel = "Choose a line of effort", allowEmpty = true }: {
  data: Pick<DataSet, "departments" | "linesOfEffort">; value: ID | null; onChange: (id: ID | null) => void; disabled?: boolean;
  emptyLabel?: string; allowEmpty?: boolean;
}) {
  const groups = departmentOptions(data.departments)
    .map((d) => ({ dept: d, lines: data.linesOfEffort.filter((l) => l.departmentId === d.id && (l.active || l.id === value)).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.lines.length);
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} required={!allowEmpty}>
      {(allowEmpty || !value) && <option value="">{emptyLabel}</option>}
      {groups.map((g) => (
        <optgroup key={g.dept.id} label={g.dept.label}>
          {g.lines.map((l) => <option key={l.id} value={l.id}>{l.name}{l.active ? "" : " (inactive)"}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

export function personName(data: Pick<DataSet, "people">, id: ID | null | undefined): string {
  if (!id) return "Unassigned";
  return data.people.find((p) => p.id === id)?.name ?? "Unknown";
}

export function deptName(data: Pick<DataSet, "departments">, id: ID | null | undefined): string {
  if (!id) return "";
  const d = data.departments.find((x) => x.id === id);
  if (!d) return "";
  const parent = d.parentId ? data.departments.find((x) => x.id === d.parentId) : null;
  return parent ? `${parent.name} › ${d.name}` : d.name;
}

/** Departments in tree order: each top-level one followed by its sub-departments. */
export function departmentOptions(departments: Department[]): { id: ID; label: string; depth: number }[] {
  const out: { id: ID; label: string; depth: number }[] = [];
  const walk = (parentId: ID | null, depth: number) => {
    for (const d of departments.filter((x) => x.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ id: d.id, label: d.name, depth });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function PersonSelect({
  people, value, onChange, allowEmpty, emptyLabel = "Unassigned", id,
}: { people: Person[]; value: ID | null; onChange: (id: ID | null) => void; allowEmpty?: boolean; emptyLabel?: string; id?: string }) {
  return (
    <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {!allowEmpty && !value && <option value="">Choose a person</option>}
      {people.filter((p) => p.active || p.id === value).sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </Select>
  );
}

export function DepartmentSelect({ departments, value, onChange, allowEmpty, emptyLabel = "All departments" }: {
  departments: Department[]; value: ID | null; onChange: (id: ID | null) => void; allowEmpty?: boolean; emptyLabel?: string;
}) {
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty ? <option value="">{emptyLabel}</option> : !value && <option value="">Choose a department</option>}
      {departmentOptions(departments).map((d) => (
        <option key={d.id} value={d.id}>{`${"   ".repeat(d.depth)}${d.depth ? "› " : ""}${d.label}`}</option>
      ))}
    </Select>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed bg-card/60 p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" | "warning" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold", tone === "danger" && "text-red-700", tone === "warning" && "text-amber-800")}>{value}</div>
    </div>
  );
}
