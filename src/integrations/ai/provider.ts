// The Claude features (analysis panel and planning function) go through this interface.
// Claude is not connected yet: FSI has not decided where its API key will live (a static
// site cannot keep it secret). Until then StubAIProvider answers. Connecting Claude later
// means writing one class that sends buildAnalysisRequest / buildPlanningRequest to a small
// proxy holding the key, and returning it from getAIProvider().

import type { DataSet } from "@/domain/types";
import { buildHistory, type History } from "./history";
import { rulePlan } from "./rulePlanner";

export type PlanHorizon = "daily" | "weekly" | "monthly" | "yearly";
export const PLAN_HORIZON_LABELS: Record<PlanHorizon, string> = {
  daily: "Today",
  weekly: "This week",
  monthly: "Next 30 days",
  yearly: "Next 12 months",
};

export interface PlanSection {
  heading: string;
  items: string[];
}

export interface Plan {
  horizon: PlanHorizon;
  generatedBy: "rules" | "claude";
  summary: string;
  sections: PlanSection[];
}

export interface Answer {
  generatedBy: "stub" | "claude";
  text: string;
}

export interface AIProvider {
  readonly connected: boolean;
  analyze(question: string, data: DataSet, today: string): Promise<Answer>;
  plan(horizon: PlanHorizon, data: DataSet, today: string, focus?: string): Promise<Plan>;
}

const ANALYSIS_SYSTEM = `You are the analyst for the Frontier Security Institute (FSI), a small Washington, D.C. AI national security nonprofit.
Answer questions about FSI's projects, tasks, people, budgets, and schedule using only the JSON data provided.
Write for policy analysts: short, plain sentences, no jargon. Name projects and people exactly as they appear.
When the data cannot answer the question, say so and say what is missing. Quote numbers and dates from the data; never invent them.`;

const PLANNING_SYSTEM = `You are the planning assistant for the Frontier Security Institute (FSI), a small Washington, D.C. AI national security nonprofit.
Using the project history provided (past date changes and their reasons, budget changes, how long each output type took, and who is carrying what), write a practical plan for the requested period.
Respect task dependencies: never schedule work before what it waits on. Flag people over capacity and projects heading over budget.
Use what history shows about slips to add realistic buffers, and say where you did. Cover continuing projects first, then suggest future projects that fit FSI's past pattern of outputs.
Reply as JSON: {"summary": string, "sections": [{"heading": string, "items": string[]}]}.`;

/** Request body for the analysis panel, ready to send to Claude through a proxy. */
export function buildAnalysisRequest(question: string, history: History) {
  return {
    system: ANALYSIS_SYSTEM,
    messages: [{ role: "user" as const, content: `FSI data (JSON):\n${JSON.stringify(history)}\n\nQuestion: ${question}` }],
  };
}

/** Request body for the planning function, ready to send to Claude through a proxy. */
export function buildPlanningRequest(horizon: PlanHorizon, history: History, focus = "") {
  return {
    system: PLANNING_SYSTEM,
    messages: [{
      role: "user" as const,
      content: `Project history (JSON):\n${JSON.stringify(history)}\n\nWrite the ${PLAN_HORIZON_LABELS[horizon].toLowerCase()} plan starting ${history.today}.${focus ? ` Focus on: ${focus}.` : ""}`,
    }],
  };
}

/** Answers without Claude: the rule-based planner, and a note in the analysis panel. */
export class StubAIProvider implements AIProvider {
  readonly connected = false;

  async analyze(question: string, data: DataSet, today: string): Promise<Answer> {
    const h = buildHistory(data, today);
    const size = JSON.stringify(buildAnalysisRequest(question, h)).length;
    return {
      generatedBy: "stub",
      text:
        `Claude is not connected yet, so this question was not sent.\n\n` +
        `When it is connected, Claude will answer from ${h.projects.length} projects, ` +
        `${h.projects.reduce((n, p) => n + p.tasks.length, 0)} tasks, ${h.people.length} people, and their date and budget history ` +
        `(about ${Math.round(size / 1000)} KB of data). An admin can connect Claude by following "Connecting Claude" in the README.`,
    };
  }

  async plan(horizon: PlanHorizon, data: DataSet, today: string): Promise<Plan> {
    return rulePlan(horizon, data, today);
  }
}

let provider: AIProvider = new StubAIProvider();
export function getAIProvider(): AIProvider {
  return provider;
}
/** Swap in a connected provider (or a fake in tests). */
export function setAIProvider(p: AIProvider) {
  provider = p;
}
