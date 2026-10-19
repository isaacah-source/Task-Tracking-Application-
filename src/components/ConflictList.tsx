import { AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Conflict } from "@/domain/conflicts";
import { CONFLICT_KIND_LABELS } from "@/domain/conflicts";
import { cn } from "@/lib/utils";

/** Live conflict check results, shown while someone fills in an assignment. */
export function ConflictList({ conflicts, ready }: { conflicts: Conflict[]; ready: boolean }) {
  if (!ready) return <p className="text-xs text-muted-foreground">Pick an owner and a due date to check for conflicts.</p>;
  if (!conflicts.length) {
    return <p className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />No conflicts with existing commitments.</p>;
  }
  const sorted = [...conflicts].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "conflict" ? -1 : 1));
  return (
    <ul className="grid gap-1.5" aria-live="polite">
      {sorted.map((c, i) => (
        <li
          key={i}
          className={cn(
            "flex gap-2 rounded-md border px-2.5 py-1.5 text-sm",
            c.severity === "conflict" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900",
          )}
        >
          {c.severity === "conflict" ? <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span><span className="font-semibold">{CONFLICT_KIND_LABELS[c.kind]}:</span> {c.message}</span>
        </li>
      ))}
    </ul>
  );
}
