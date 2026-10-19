import { describe, expect, it } from "vitest";
import { buildSeed } from "@/data/seed";
import { MemoryBackend } from "@/data/memoryBackend";
import { Repository } from "@/data/repository";
import { groupForType } from "@/integrations/relationships/adapter";
import { MockRelationshipTracker } from "@/integrations/relationships/mock";
import { syncRelationships } from "@/integrations/relationships/sync";
import { buildHistory } from "@/integrations/ai/history";
import { buildPlanningRequest, StubAIProvider } from "@/integrations/ai/provider";
import { rulePlan } from "@/integrations/ai/rulePlanner";

const TODAY = "2026-10-19";

describe("relationship groups", () => {
  it("maps the tracker's types onto the four groups", () => {
    expect(groupForType("Policy/NatSec/Gov")).toBe("government");
    expect(groupForType("Congress")).toBe("government");
    expect(groupForType("International Gov/Diplomatic")).toBe("government");
    expect(groupForType("AI Labs")).toBe("industry");
    expect(groupForType("Research/Institutional Partners")).toBe("research");
    expect(groupForType("Media")).toBe("media");
    expect(groupForType("Donors/Funders")).toBe(null);
  });
});

describe("relationship sync", () => {
  it("pulls name changes and pushes involvement both ways", async () => {
    const data = buildSeed(TODAY);
    const repo = new Repository(new MemoryBackend(data), data.people[0], data.people[0].email, () => new Date("2026-10-19T12:00:00Z"));
    await repo.refresh();
    const tracker = new MockRelationshipTracker();
    tracker.rename("C-1001", "Dr. Sample Reviewer A", "Sample Institute");

    const res = await syncRelationships(tracker, repo.data, (id, patch) => repo.updateRelationshipLink(id, patch), [], () => new Date("2026-10-19T12:00:00Z"));

    expect(res.updated).toBe(1);
    expect(res.missing).toEqual([]);
    const link = repo.data.relationshipLinks.find((l) => l.externalId === "C-1001")!;
    expect(link).toMatchObject({ name: "Dr. Sample Reviewer A", organization: "Sample Institute", syncedAt: "2026-10-19T12:00:00.000Z" });

    expect(res.pushed).toBe(3);
    expect(tracker.received.get("C-1001:1")).toMatchObject({ projectTitle: "U.S.-China Strategic AI: Paper 1", ownerEmail: "aaron@example.org", active: true });
  });

  it("reports links the tracker no longer has and pushes removals", async () => {
    const data = buildSeed(TODAY);
    data.relationshipLinks[0].externalId = "C-GONE";
    const tracker = new MockRelationshipTracker();
    const removed = [{ externalId: "C-1002", projectId: "4", projectTitle: "x", projectStatus: "", ownerEmail: "", role: "", active: true }];
    const res = await syncRelationships(tracker, data, async () => {}, removed);
    expect(res.missing).toEqual(["Sample Reviewer A"]);
    expect(tracker.received.get("C-1002:4")!.active).toBe(false);
  });
});

describe("planning history", () => {
  const data = buildSeed(TODAY);
  const h = buildHistory(data, TODAY);

  it("collects date slips with reasons and who made them", () => {
    const explainer = h.projects.find((p) => p.title === "Compute export controls explainer")!;
    expect(explainer.dateSlips).toEqual([
      expect.objectContaining({ entity: "project", field: "dueDate", days: 30, reason: expect.stringMatching(/chip smuggling/) }),
    ]);
    expect(explainer.totalSlipDays).toBe(30);
  });

  it("summarizes past outputs by type", () => {
    const papers = h.byOutputType.find((o) => o.outputType === "Research Papers")!;
    expect(papers.finished).toBe(1);
    expect(papers.avgBudgetVariancePct).toBe(18); // 9400 vs 8000
  });

  it("marks blocked tasks and what they wait on", () => {
    const review = h.projects[0].tasks.find((t) => t.title === "External review")!;
    expect(review.blocked).toBe(true);
    expect(review.waitsOn).toEqual(["Draft sections 1-3", "Draft sections 4-6"]);
  });

  it("builds a Claude request that carries the history", () => {
    const req = buildPlanningRequest("weekly", h, "Paper 1");
    expect(req.system).toMatch(/Respect task dependencies/);
    expect(req.messages[0].content).toContain("Compute export controls explainer");
    expect(req.messages[0].content).toContain("Focus on: Paper 1");
  });
});

describe("rule-based planner", () => {
  const data = buildSeed(TODAY);
  it("orders overdue work first and reports blocked work", () => {
    const plan = rulePlan("weekly", data, TODAY);
    expect(plan.generatedBy).toBe("rules");
    expect(plan.sections[0].heading).toMatch(/overdue/);
    expect(plan.sections[0].items.join()).toContain("Draft sections 1-3");
    expect(plan.sections.find((s) => s.heading === "Waiting on other work")!.items.join()).toContain("External review waits on");
  });
  it("suggests future projects on longer horizons", () => {
    expect(rulePlan("yearly", data, TODAY).sections.map((s) => s.heading)).toContain("Future projects to consider");
    expect(rulePlan("daily", data, TODAY).sections.map((s) => s.heading)).not.toContain("Future projects to consider");
  });
  it("the stub explains that Claude is not connected", async () => {
    const a = await new StubAIProvider().analyze("Who is overloaded?", data, TODAY);
    expect(a.text).toMatch(/not connected/);
  });
});
