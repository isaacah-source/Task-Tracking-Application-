// Due-date flags and the review windows used by the meeting task list.

import type { Status } from "./types";
import { addDays, endOfMonth, endOfQuarter, startOfMonth, startOfQuarter, startOfWeek } from "./dates";

export type DueFlag = "overdue" | "dueSoon" | null;

/** "Due soon" means due today or within the next 7 days. Done work never gets a flag. */
export function dueFlag(dueDate: string | null, status: Status, todayIso: string): DueFlag {
  if (!dueDate || status === "done") return null;
  if (dueDate < todayIso) return "overdue";
  if (dueDate <= addDays(todayIso, 7)) return "dueSoon";
  return null;
}

export type ReviewPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "all";
export const REVIEW_PERIOD_LABELS: Record<ReviewPeriod, string> = {
  daily: "Daily meeting",
  weekly: "This week",
  monthly: "Monthly review",
  quarterly: "Quarterly review",
  yearly: "Yearly review",
  all: "Everything",
};

/** Date range a review covers. The task list also always shows overdue work. */
export function reviewWindow(period: ReviewPeriod, todayIso: string): { from: string; to: string } | null {
  switch (period) {
    case "daily":
      // Today plus the coming week, so the daily meeting sees what is about to land.
      return { from: todayIso, to: addDays(todayIso, 7) };
    case "weekly": {
      const from = startOfWeek(todayIso);
      return { from, to: addDays(from, 6) };
    }
    case "monthly":
      return { from: startOfMonth(todayIso), to: endOfMonth(todayIso) };
    case "quarterly":
      return { from: startOfQuarter(todayIso), to: endOfQuarter(todayIso) };
    case "yearly":
      return { from: `${todayIso.slice(0, 4)}-01-01`, to: `${todayIso.slice(0, 4)}-12-31` };
    case "all":
      return null;
  }
}

/** Whether an item belongs in a review: due inside the window, overdue, or (daily) in progress. */
export function inReview(
  item: { dueDate: string | null; status: Status; completedAt?: string | null },
  period: ReviewPeriod,
  todayIso: string,
): boolean {
  const w = reviewWindow(period, todayIso);
  if (!w) return true;
  if (item.status === "done") {
    // Reviews also show what got finished during the period.
    const done = item.completedAt?.slice(0, 10);
    return !!done && done >= w.from && done <= w.to && period !== "daily";
  }
  if (item.dueDate && item.dueDate < todayIso) return true;
  if (period === "daily" && item.status === "inProgress") return true;
  return !!item.dueDate && item.dueDate >= w.from && item.dueDate <= w.to;
}
