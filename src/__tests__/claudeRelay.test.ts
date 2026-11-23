import { describe, expect, it, vi } from "vitest";
import { ClaudeRelayProvider } from "@/integrations/ai/provider";
import { buildSeed } from "@/data/seed";

const TODAY = "2026-10-19";
const data = buildSeed(TODAY);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Claude relay provider", () => {
  it("sends the analysis request with the person's sign-in and returns Claude's answer", async () => {
    const fetchFn = vi.fn(async () => json(200, { text: "Dana is busiest." }));
    const p = new ClaudeRelayProvider("https://relay/api/claude", async () => "id-token", fetchFn);
    const a = await p.analyze("Who is busiest?", data, TODAY);
    expect(a).toEqual({ generatedBy: "claude", text: "Dana is busiest." });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://relay/api/claude");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer id-token");
    const body = JSON.parse(init.body as string);
    expect(body.kind).toBe("analysis");
    expect(body.messages[0].content).toContain("Question: Who is busiest?");
  });

  it("retries once with a fresh sign-in after a 401", async () => {
    const tokens: boolean[] = [];
    const fetchFn = vi.fn().mockResolvedValueOnce(json(401, { error: "expired" })).mockResolvedValueOnce(json(200, { text: "ok" }));
    const p = new ClaudeRelayProvider("u", async (fresh = false) => (tokens.push(fresh), "t"), fetchFn);
    await p.analyze("q", data, TODAY);
    expect(tokens).toEqual([false, true]);
  });

  it("turns the plan JSON into sections", async () => {
    const plan = { summary: "Busy week.", sections: [{ heading: "Research", items: ["Finish draft"] }] };
    const p = new ClaudeRelayProvider("u", async () => "t", async () => json(200, { text: JSON.stringify(plan) }));
    expect(await p.plan("weekly", data, TODAY)).toEqual({ horizon: "weekly", generatedBy: "claude", ...plan });
  });

  it("shows the relay's own error message", async () => {
    const p = new ClaudeRelayProvider("u", async () => "t", async () => json(502, { error: "The Claude API key saved in Azure is missing or not valid." }));
    await expect(p.analyze("q", data, TODAY)).rejects.toThrow(/API key saved in Azure/);
  });
});
