// Date helpers for "YYYY-MM-DD" strings. All arithmetic runs in UTC so a date never moves
// by a day because of the viewer's time zone.

const DAY = 86_400_000;

export function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function fromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today in the viewer's local calendar. */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, n: number): string {
  return fromDate(new Date(toDate(iso).getTime() + n * DAY));
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
}

export function isWeekday(iso: string): boolean {
  const d = toDate(iso).getUTCDay();
  return d !== 0 && d !== 6;
}

/** Weekdays from a to b, both included. At least 1 so effort always lands somewhere. */
export function workdaysBetween(a: string, b: string): number {
  if (b < a) return 1;
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) if (isWeekday(d)) n++;
  return Math.max(1, n);
}

export function startOfWeek(iso: string): string {
  const dow = toDate(iso).getUTCDay(); // 0 = Sunday
  return addDays(iso, dow === 0 ? -6 : 1 - dow); // Monday
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const d = toDate(startOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return addDays(fromDate(d), -1);
}

export function startOfQuarter(iso: string): string {
  const m = Number(iso.slice(5, 7));
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return `${iso.slice(0, 4)}-${String(q).padStart(2, "0")}-01`;
}

export function endOfQuarter(iso: string): string {
  return endOfMonth(addMonths(startOfQuarter(iso), 2));
}

export function addMonths(iso: string, n: number): string {
  const d = toDate(startOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return fromDate(d);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function formatShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`;
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
