import { describe, expect, it } from "vitest";
import { isTeamsJoinUrl, vttToText } from "@/integrations/teams/adapter";
import { GraphTeamsTranscription, MEETING_SCOPES, TRANSCRIPT_SCOPES, grantedScopes } from "@/integrations/teams/graph";
import { MOCK_VTT, MockTeamsTranscription } from "@/integrations/teams/mock";
import { MemoryBackend } from "@/data/memoryBackend";
import { Repository } from "@/data/repository";
import { buildSeed } from "@/data/seed";

const JOIN = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d";

/** Fake Graph for the online meeting endpoints. */
function fakeTeams(opts: { found?: boolean; transcripts?: string[]; deny?: boolean } = {}) {
  const calls: { method: string; url: string; body?: any; auth: string }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url).replace("https://graph.microsoft.com/v1.0", "");
    const method = init?.method ?? "GET";
    calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string>).Authorization });
    if (opts.deny) return json({ error: { code: "Forbidden", message: "no" } }, 403);
    if (u === "/me/onlineMeetings" && method === "POST") return json({ id: "M1", joinWebUrl: JOIN, subject: "Research weekly" }, 201);
    if (u.startsWith("/me/onlineMeetings?$filter=")) return json({ value: opts.found === false ? [] : [{ id: "M2", joinWebUrl: JOIN, subject: "Board prep" }] });
    if (u === "/me/onlineMeetings/M2" && method === "PATCH") return json({});
    const list = opts.transcripts ?? [];
    if (u === "/me/onlineMeetings/M1/transcripts") {
      return json({ value: list.map((_, i) => ({ id: `T${i}`, createdDateTime: `2026-10-22T1${5 - i}:00:00Z` })) });
    }
    const t = /\/transcripts\/T(\d+)\/content/.exec(u);
    if (t) return new Response(list[Number(t[1])], { status: 200 });
    return json({ error: { code: "NotFound", message: "nope" } }, 404);
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}

const token = async (scopes: string[]) => `t:${scopes.join(",")}`;

describe("Teams transcripts", () => {
  it("turns WebVTT into one paragraph per speaker turn", () => {
    expect(vttToText(MOCK_VTT)).toBe(
      "[0:02] Alex Rivera: Let's start with Paper 1. Sections one to three are running late. Can we move the external review back a week?\n\n" +
        "[0:09] Jordan Lee: Yes. I'll book the wargame venue by Friday.",
    );
  });

  it("keeps hours, lines without a speaker, and ignores cue ids", () => {
    const vtt = "WEBVTT\r\n\r\nabc-1\r\n01:02:03.000 --> 01:02:05.000\r\nNo speaker here\r\n";
    expect(vttToText(vtt)).toBe("[1:02:03] No speaker here");
  });

  it("recognizes Teams join links", () => {
    expect(isTeamsJoinUrl(JOIN)).toBe(true);
    expect(isTeamsJoinUrl("https://teams.live.com/meet/9876")).toBe(true);
    expect(isTeamsJoinUrl("https://example.org/l/meetup-join/x")).toBe(false);
    expect(isTeamsJoinUrl("not a link")).toBe(false);
  });
});

describe("GraphTeamsTranscription", () => {
  it("creates a meeting that records and transcribes automatically", async () => {
    const g = fakeTeams();
    const t = new GraphTeamsTranscription(token, g.fetchFn);
    const m = await t.createMeeting("Research weekly", new Date("2026-10-22T15:00:00Z"), new Date("2026-10-22T16:00:00Z"));
    expect(m).toEqual({ id: "M1", joinUrl: JOIN, subject: "Research weekly" });
    expect(g.calls[0].body).toEqual({
      subject: "Research weekly", startDateTime: "2026-10-22T15:00:00.000Z", endDateTime: "2026-10-22T16:00:00.000Z", recordAutomatically: true,
    });
    expect(g.calls[0].auth).toBe(`Bearer t:${MEETING_SCOPES.join(",")}`);
  });

  it("finds an existing meeting by join link and turns on automatic transcription", async () => {
    const g = fakeTeams();
    const m = await new GraphTeamsTranscription(token, g.fetchFn).attachMeeting(` ${JOIN} `);
    expect(m.id).toBe("M2");
    expect(decodeURIComponent(g.calls[0].url)).toBe(`/me/onlineMeetings?$filter=JoinWebUrl eq '${JOIN}'`);
    expect(g.calls[1]).toMatchObject({ method: "PATCH", url: "/me/onlineMeetings/M2", body: { recordAutomatically: true } });
  });

  it("explains when the link is not a meeting the person organizes", async () => {
    const g = fakeTeams({ found: false });
    await expect(new GraphTeamsTranscription(token, g.fetchFn).attachMeeting(JOIN)).rejects.toThrow(/organizer/);
  });

  it("returns null before Teams has a transcript", async () => {
    const g = fakeTeams({ transcripts: [] });
    expect(await new GraphTeamsTranscription(token, g.fetchFn).fetchTranscript("M1")).toBeNull();
    expect(g.calls[0].auth).toBe(`Bearer t:${TRANSCRIPT_SCOPES.join(",")}`);
  });

  it("joins transcripts from a meeting started more than once, oldest first", async () => {
    const later = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v B>Second session.</v>\n";
    const first = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v A>First session.</v>\n";
    const g = fakeTeams({ transcripts: [later, first] });
    const text = await new GraphTeamsTranscription(token, g.fetchFn).fetchTranscript("M1");
    expect(text).toBe("[0:01] A: First session.\n\n---\n\n[0:01] B: Second session.");
    expect(g.calls.some((c) => c.url.endsWith("/content?$format=text/vtt"))).toBe(true);
  });

  it("explains a refusal in plain words and passes on what Teams said", async () => {
    const g = fakeTeams({ deny: true });
    await expect(new GraphTeamsTranscription(token, g.fetchFn).fetchTranscript("M1")).rejects.toThrow(/organizer.*Teams said: "no" \(Forbidden\)/);
  });

  it("says so when the sign-in lacks the transcript permission", async () => {
    const g = fakeTeams({ deny: true });
    const jwt = (scp: string) => `h.${btoa(JSON.stringify({ scp })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.s`;
    const t = new GraphTeamsTranscription(async () => jwt("User.Read OnlineMeetings.ReadWrite"), g.fetchFn);
    await expect(t.fetchTranscript("M1")).rejects.toThrow(/does not include the OnlineMeetingTranscript.Read.All permission.*Sign out/);
    expect(grantedScopes(jwt("User.Read Sites.ReadWrite.All"))).toEqual(["user.read", "sites.readwrite.all"]);
    expect(grantedScopes("not-a-jwt")).toBeNull();
  });
});

describe("meeting notes with a Teams transcript", () => {
  it("starts a note linked to the Teams meeting and saves the transcript, cut to fit SharePoint", async () => {
    const data = buildSeed("2026-10-22");
    const me = data.people.find((p) => p.role === "admin")!;
    const repo = new Repository(new MemoryBackend(data), me, me.email);
    await repo.refresh();
    const teams = new MockTeamsTranscription();
    const tm = await teams.createMeeting("Research weekly");
    const note = await repo.createMeeting({
      title: "Research weekly", meetingType: "weekly", date: "2026-10-22", notes: "", attendeeIds: [me.id], teamsMeetingId: tm.id, teamsJoinUrl: tm.joinUrl,
    });
    expect(note).toMatchObject({ teamsMeetingId: tm.id, transcript: "" });
    expect(await teams.fetchTranscript(tm.id)).toBeNull();
    teams.markEnded(tm.id);
    await repo.saveTranscript(note.id, (await teams.fetchTranscript(tm.id))!);
    expect(repo.data.meetings.find((m) => m.id === note.id)!.transcript).toContain("Jordan Lee: Yes.");
    await repo.saveTranscript(note.id, "x".repeat(70_000));
    const saved = repo.data.meetings.find((m) => m.id === note.id)!.transcript;
    expect(saved.length).toBeLessThan(61_000);
    expect(saved).toMatch(/full transcript is in Teams/);
  });

  it("gives plain meeting notes empty Teams fields", async () => {
    const data = buildSeed("2026-10-22");
    const me = data.people.find((p) => p.role === "admin")!;
    const repo = new Repository(new MemoryBackend(data), me, me.email);
    await repo.refresh();
    const n = await repo.createMeeting({ title: "Stand-up", meetingType: "daily", date: "2026-10-22", notes: "", attendeeIds: [] });
    expect(n).toMatchObject({ teamsMeetingId: "", teamsJoinUrl: "", transcript: "" });
  });
});
