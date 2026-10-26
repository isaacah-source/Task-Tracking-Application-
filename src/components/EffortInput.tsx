import { EFFORT_STEP_MINUTES, roundEffort } from "@/domain/tasks";
import { Input, Select } from "./ui/input";

const MINUTES = Array.from({ length: 60 / EFFORT_STEP_MINUTES }, (_, i) => i * EFFORT_STEP_MINUTES);

/** Effort as whole hours plus 0, 15, 30, or 45 minutes. The value is in hours (1.25 = 1 h 15 min). */
export function EffortInput({ value, onChange, label = "Effort" }: { value: number; onChange: (hours: number) => void; label?: string }) {
  const total = Math.round(roundEffort(value) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const set = (hours: number, minutes: number) => onChange(roundEffort(Math.max(0, hours) + minutes / 60));
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="relative">
        <Input
          type="number" min={0} step={1} inputMode="numeric" aria-label={`${label} hours`} className="pr-8"
          value={h} onChange={(e) => set(Math.floor(Number(e.target.value) || 0), m)}
        />
        <span className="pointer-events-none absolute right-2.5 top-2 text-sm text-muted-foreground">h</span>
      </div>
      <Select aria-label={`${label} minutes`} value={m} onChange={(e) => set(h, Number(e.target.value))}>
        {MINUTES.map((x) => <option key={x} value={x}>{x} min</option>)}
      </Select>
    </div>
  );
}
