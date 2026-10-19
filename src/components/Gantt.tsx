import { useMemo } from "react";
import type { Dependency, Person, Task } from "@/domain/types";
import { STATUS_LABELS } from "@/domain/types";
import { addDays, daysBetween, formatShort, toDate } from "@/domain/dates";
import { blockedTaskIds, topoOrder } from "@/domain/dependencies";
import { dueFlag } from "@/domain/flags";
import { cn } from "@/lib/utils";

const ROW = 36;
const LABEL = 220;

const BAR_COLOR: Record<Task["status"], string> = {
  notStarted: "bg-slate-400",
  inProgress: "bg-blue-600",
  done: "bg-emerald-600",
  onHold: "bg-amber-500",
};

/**
 * Gantt chart for one project. Tasks run in dependency order; arrows show what waits on
 * what. Red outline: overdue. Hatched: blocked.
 */
export function Gantt({ tasks, deps, people, today, onSelect }: {
  tasks: Task[]; deps: Dependency[]; people: Person[]; today: string; onSelect?: (t: Task) => void;
}) {
  const ordered = useMemo(() => topoOrder(tasks, deps), [tasks, deps]);
  const dated = ordered.filter((t) => t.startDate || t.dueDate);
  const undated = ordered.filter((t) => !t.startDate && !t.dueDate);
  const blocked = blockedTaskIds(tasks, deps);

  if (!dated.length) return <p className="text-sm text-muted-foreground">Add start or due dates to tasks to see them on the timeline.</p>;

  const starts = dated.map((t) => t.startDate ?? t.dueDate!);
  const ends = dated.map((t) => t.dueDate ?? t.startDate!);
  const from = addDays([...starts, today].sort()[0], -3);
  const to = addDays([...ends, today].sort().at(-1)!, 3);
  const days = daysBetween(from, to) + 1;
  const dayW = Math.max(6, Math.min(28, Math.floor(900 / days)));
  const width = days * dayW;

  const x = (iso: string) => daysBetween(from, iso) * dayW;
  const rowOf = new Map(dated.map((t, i) => [t.id, i]));
  const ownerName = (id: string | null) => people.find((p) => p.id === id)?.name ?? "Unassigned";

  // Month and week ticks
  const ticks: { x: number; label: string; month: boolean }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dt = toDate(d);
    if (dt.getUTCDate() === 1) ticks.push({ x: x(d), label: dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" }), month: true });
    // Week ticks, except right next to a month label where they would overlap it.
    else if (dt.getUTCDay() === 1 && dayW >= 10 && dt.getUTCDate() > 3) ticks.push({ x: x(d), label: String(dt.getUTCDate()), month: false });
  }

  const arrows = deps
    .filter((d) => rowOf.has(d.predecessorId) && rowOf.has(d.successorId))
    .map((d) => {
      const p = dated[rowOf.get(d.predecessorId)!];
      const s = dated[rowOf.get(d.successorId)!];
      const x1 = x(p.dueDate ?? p.startDate!) + dayW;
      const y1 = rowOf.get(p.id)! * ROW + ROW / 2;
      const x2 = x(s.startDate ?? s.dueDate!);
      const y2 = rowOf.get(s.id)! * ROW + ROW / 2;
      const mid = Math.max(x1 + 6, x2 - 6);
      return { id: d.id, path: `M${x1},${y1} H${mid} V${y2} H${x2}`, x2, y2 };
    });

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div style={{ width: LABEL + width }} className="relative">
        <div className="flex border-b bg-muted/50 text-xs text-muted-foreground" style={{ height: 28 }}>
          <div style={{ width: LABEL }} className="shrink-0 px-3 py-1.5 font-semibold uppercase tracking-wide">Task</div>
          <div className="relative" style={{ width }}>
            {ticks.map((t, i) => (
              <span key={i} className={cn("absolute top-1.5", t.month && "font-semibold text-foreground")} style={{ left: t.x + 2 }}>{t.label}</span>
            ))}
          </div>
        </div>
        <div className="relative flex">
          <div style={{ width: LABEL }} className="shrink-0">
            {dated.map((t) => (
              <button
                key={t.id}
                onClick={() => onSelect?.(t)}
                className="block w-full truncate border-b px-3 text-left text-sm hover:bg-muted/50"
                style={{ height: ROW, lineHeight: `${ROW}px` }}
                title={`${t.title} · ${ownerName(t.ownerId)}`}
              >
                {t.title}
              </button>
            ))}
          </div>
          <div className="relative" style={{ width, height: dated.length * ROW }}>
            {ticks.filter((t) => t.month).map((t, i) => <div key={i} className="absolute top-0 h-full border-l border-dashed border-border" style={{ left: t.x }} />)}
            {dated.map((_, i) => <div key={i} className="absolute w-full border-b" style={{ top: (i + 1) * ROW - 1 }} />)}
            <div className="absolute top-0 z-10 h-full w-0.5 bg-red-500/70" style={{ left: x(today) + dayW / 2 }} title={`Today, ${formatShort(today)}`} />
            <svg className="pointer-events-none absolute inset-0 z-10" width={width} height={dated.length * ROW}>
              <defs>
                <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" fill="#64748b" />
                </marker>
              </defs>
              {arrows.map((a) => <path key={a.id} d={a.path} fill="none" stroke="#64748b" strokeWidth="1.2" markerEnd="url(#arrow)" />)}
            </svg>
            {dated.map((t, i) => {
              const s = t.startDate ?? t.dueDate!;
              const e = t.dueDate ?? t.startDate!;
              const flag = dueFlag(t.dueDate, t.status, today);
              const tip = `${t.title}\n${ownerName(t.ownerId)} · ${STATUS_LABELS[t.status]}\n${formatShort(s)} to ${formatShort(e)}${blocked.has(t.id) ? "\nBlocked" : ""}`;
              if (t.kind === "milestone") {
                return (
                  <button key={t.id} onClick={() => onSelect?.(t)} title={tip}
                    className={cn("absolute z-20 h-4 w-4 rotate-45", t.status === "done" ? "bg-emerald-600" : "bg-violet-600", flag === "overdue" && "ring-2 ring-red-500")}
                    style={{ left: x(e) + dayW / 2 - 8, top: i * ROW + ROW / 2 - 8 }} />
                );
              }
              return (
                <button
                  key={t.id}
                  onClick={() => onSelect?.(t)}
                  title={tip}
                  className={cn(
                    "absolute z-20 rounded px-1.5 text-left text-[11px] font-medium text-white shadow-sm",
                    BAR_COLOR[t.status],
                    t.kind === "event" && "rounded-full",
                    flag === "overdue" && "ring-2 ring-red-500 ring-offset-1",
                    blocked.has(t.id) && "bg-[repeating-linear-gradient(45deg,#94a3b8,#94a3b8_6px,#cbd5e1_6px,#cbd5e1_12px)] text-slate-800",
                  )}
                  style={{ left: x(s), width: Math.max(dayW, (daysBetween(s, e) + 1) * dayW), top: i * ROW + 7, height: ROW - 14 }}
                >
                  <span className="block truncate leading-[22px]">{ownerName(t.ownerId)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
        <Legend className="bg-slate-400" label="Not started" />
        <Legend className="bg-blue-600" label="In progress" />
        <Legend className="bg-emerald-600" label="Done" />
        <Legend className="bg-amber-500" label="On hold" />
        <Legend className="bg-[repeating-linear-gradient(45deg,#94a3b8,#94a3b8_3px,#cbd5e1_3px,#cbd5e1_6px)]" label="Blocked" />
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 bg-violet-600" />Milestone</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-red-500" />Today</span>
        {undated.length > 0 && <span>{undated.length} task{undated.length === 1 ? " has" : "s have"} no dates</span>}
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cn("h-2.5 w-4 rounded-sm", className)} />{label}</span>;
}
