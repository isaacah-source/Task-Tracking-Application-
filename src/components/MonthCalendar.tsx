import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, endOfMonth, monthLabel, startOfMonth, startOfWeek } from "@/domain/dates";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

export interface CalendarItem {
  id: string;
  date: string;
  /** Last day for items that span several days (events). */
  endDate?: string;
  label: string;
  href: string;
  tone: "task" | "event" | "milestone" | "project" | "overdue" | "done";
  title?: string;
}

const TONE: Record<CalendarItem["tone"], string> = {
  task: "bg-blue-50 text-blue-900 border-blue-200",
  event: "bg-violet-100 text-violet-900 border-violet-200",
  milestone: "bg-fuchsia-50 text-fuchsia-900 border-fuchsia-200",
  project: "bg-slate-800 text-white border-slate-800",
  overdue: "bg-red-50 text-red-800 border-red-200",
  done: "bg-emerald-50 text-emerald-900 border-emerald-200 line-through",
};

export function MonthCalendar({ month, onMonth, items, today }: {
  month: string; onMonth: (m: string) => void; items: CalendarItem[]; today: string;
}) {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const gridStart = startOfWeek(first);
  const weeks: string[][] = [];
  for (let d = gridStart; d <= last; ) {
    const w: string[] = [];
    for (let i = 0; i < 7; i++, d = addDays(d, 1)) w.push(d);
    weeks.push(w);
  }
  const on = (day: string) => items.filter((it) => (it.endDate ? it.date <= day && day <= it.endDate : it.date === day));

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b p-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => onMonth(addMonths(first, -1))} aria-label="Previous month"><ChevronLeft /></Button>
          <Button variant="outline" size="icon" onClick={() => onMonth(addMonths(first, 1))} aria-label="Next month"><ChevronRight /></Button>
          <Button variant="ghost" size="sm" onClick={() => onMonth(startOfMonth(today))}>Today</Button>
        </div>
        <h2 className="text-lg font-semibold">{monthLabel(first)}</h2>
        <div className="w-24" />
      </div>
      <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day) => {
          const list = on(day);
          const inMonth = day >= first && day <= last;
          return (
            <div key={day} className={cn("min-h-[104px] border-b border-r p-1.5", !inMonth && "bg-muted/30")}>
              <div className={cn("mb-1 text-right text-xs", !inMonth && "text-muted-foreground", day === today && "font-bold text-primary")}>
                {day === today ? <span className="rounded-full bg-primary px-1.5 py-0.5 text-primary-foreground">{Number(day.slice(8))}</span> : Number(day.slice(8))}
              </div>
              <div className="flex flex-col gap-0.5">
                {list.slice(0, 4).map((it) => (
                  <Link key={it.id} to={it.href} title={it.title ?? it.label} className={cn("truncate rounded border px-1 py-0.5 text-[11px] leading-tight hover:opacity-80", TONE[it.tone])}>
                    {it.label}
                  </Link>
                ))}
                {list.length > 4 && <span className="px-1 text-[11px] text-muted-foreground">+{list.length - 4} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
