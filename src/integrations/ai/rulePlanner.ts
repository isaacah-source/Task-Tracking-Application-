// Plans without Claude. Orders open work by dependency and due date, flags overload and
// budget risk, and uses past date slips to suggest buffers. Claude will replace this step
// once connected; the history it uses is the same.

import type { DataSet } from "@/domain/types";
import { addDays, formatShort } from "@/domain/dates";
import { blockers, topoOrder } from "@/domain/dependencies";
import { personLoad } from "@/domain/load";
import { buildHistory } from "./history";
import type { Plan, PlanHorizon, PlanSection } from "./provider";
import { PLAN_HORIZON_LABELS } from "./provider";

const WINDOW_DAYS: Record<PlanHorizon, number> = { daily: 0, weekly: 6, monthly: 29, yearly: 364 };

export function rulePlan(horizon: PlanHorizon, data: DataSet, today: string): Plan {
  const end = addDays(today, WINDOW_DAYS[horizon]);
  const name = (id: string | null) => data.people.find((p) => p.id === id)?.name ?? "Unassigned";
  const projectTitle = (id: string) => data.projects.find((p) => p.id === id)?.title ?? "";
  const open = data.tasks.filter((t) => t.status !== "done");
  const ordered = topoOrder(open, data.dependencies);
  const line = (t: (typeof open)[number]) =>
    `${t.title} (${projectTitle(t.projectId)}) · ${name(t.ownerId)}${t.dueDate ? ` · due ${formatShort(t.dueDate)}` : ""}`;

  const overdue = ordered.filter((t) => t.dueDate && t.dueDate < today);
  const due = ordered.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= end);
  const ready = ordered.filter(
    (t) => !blockers(t, data.tasks, data.dependencies).length && (!t.startDate || t.startDate <= end) && !due.includes(t) && !overdue.includes(t),
  );
  const waiting = ordered.filter((t) => blockers(t, data.tasks, data.dependencies).length && t.dueDate && t.dueDate <= addDays(end, 14));

  const sections: PlanSection[] = [];
  if (overdue.length) sections.push({ heading: "Catch up first (overdue)", items: overdue.map(line) });
  if (due.length) sections.push({ heading: `Due ${PLAN_HORIZON_LABELS[horizon].toLowerCase()}`, items: due.map(line) });
  if (ready.length) sections.push({ heading: "Free to start", items: ready.slice(0, 12).map(line) });
  if (waiting.length) {
    sections.push({
      heading: "Waiting on other work",
      items: waiting.map((t) => `${t.title} waits on ${blockers(t, data.tasks, data.dependencies).map((b) => `"${b.title}" (${name(b.ownerId)})`).join(", ")}`),
    });
  }

  const risks: string[] = [];
  for (const p of data.people.filter((x) => x.active && x.role !== "viewer")) {
    const l = personLoad(p, data, today);
    if (l.level === "over") risks.push(`${p.name} is booked for about ${Math.round(l.hoursNext7)} h this week against ${Math.round(l.capacityNext7)} h. Move or reassign work.`);
  }
  for (const p of data.projects.filter((x) => x.status !== "done" && x.plannedBudget > 0)) {
    const committed = p.actualSpend + open.filter((t) => t.projectId === p.id).reduce((s, t) => s + t.estimatedCost, 0);
    if (committed > p.plannedBudget) risks.push(`"${p.title}" is heading over budget: $${committed.toLocaleString("en-US")} spent or committed against $${p.plannedBudget.toLocaleString("en-US")}.`);
  }
  if (risks.length) sections.push({ heading: "Risks", items: risks });

  const history = buildHistory(data, today);
  const lessons = history.byOutputType
    .filter((o) => o.avgSlipDays > 0 || (o.avgBudgetVariancePct ?? 0) > 0)
    .map((o) => {
      const parts = [];
      if (o.avgSlipDays > 0) parts.push(`due dates moved ${o.avgSlipDays} days later on average; add that buffer`);
      if ((o.avgBudgetVariancePct ?? 0) > 0) parts.push(`finished ${o.avgBudgetVariancePct}% over budget on average`);
      return `${o.outputType}: ${parts.join("; ")}.`;
    });
  const reasons = history.projects.flatMap((p) => p.dateSlips).filter((s) => s.days > 0 && s.reason).slice(-5).map((s) => `${s.reason} (+${s.days} days)`);
  if (lessons.length || reasons.length) sections.push({ heading: "From past projects", items: [...lessons, ...reasons.map((r) => `Recent reason for a delay: ${r}`)] });

  if (horizon === "monthly" || horizon === "yearly") {
    const future = history.byOutputType
      .filter((o) => o.finished > 0)
      .map((o) => `${o.outputType}: FSI finished ${o.finished} before${o.avgDurationDays ? `, taking about ${o.avgDurationDays} days` : ""}. Consider planning the next one now.`);
    if (future.length) sections.push({ heading: "Future projects to consider", items: future });
  }

  return {
    horizon,
    generatedBy: "rules",
    summary: `${overdue.length} overdue, ${due.length} due ${PLAN_HORIZON_LABELS[horizon].toLowerCase()}, ${waiting.length} waiting on other work, ${risks.length} risk${risks.length === 1 ? "" : "s"}.`,
    sections,
  };
}
