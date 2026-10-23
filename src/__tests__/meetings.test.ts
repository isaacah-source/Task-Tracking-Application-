import { describe, expect, it } from "vitest";
import type { MeetingNote } from "@/domain/types";
import { hasNotes, recentWithNotes, upcomingTranscriptions } from "@/domain/meetings";

const TODAY = "2026-10-23";
const note = (id: string, date: string, over: Partial<MeetingNote> = {}): MeetingNote => ({
  id, title: `M${id}`, meetingType: "weekly", date, notes: "", attendeeIds: [], createdById: "1", departmentId: null,
  teamsMeetingId: "", teamsJoinUrl: "", transcript: "", ...over,
});

describe("meeting lists on the Meeting notes page", () => {
  it("counts typed notes or a transcript as notes, not blank space", () => {
    expect(hasNotes(note("1", TODAY, { notes: "  " }))).toBe(false);
    expect(hasNotes(note("1", TODAY, { notes: "Decided X" }))).toBe(true);
    expect(hasNotes(note("1", TODAY, { transcript: "[0:01] A: hi" }))).toBe(true);
  });

  it("lists the last 5 days' meetings that have notes, newest first", () => {
    const list = recentWithNotes([
      note("1", "2026-10-18", { notes: "x" }), // exactly 5 days ago: in
      note("2", "2026-10-17", { notes: "x" }), // 6 days ago: out
      note("3", "2026-10-22"), // no notes: out
      note("4", "2026-10-21", { transcript: "t" }),
      note("5", TODAY, { notes: "x" }),
      note("6", "2026-10-24", { notes: "x" }), // future: out
    ], TODAY);
    expect(list.map((m) => m.id)).toEqual(["5", "4", "1"]);
  });

  it("lists my meetings in the next 5 days set up for transcription, soonest first", () => {
    const teams = { teamsMeetingId: "T", teamsJoinUrl: "https://teams.microsoft.com/l/meetup-join/x" };
    const list = upcomingTranscriptions([
      note("1", "2026-10-25", teams),
      note("2", "2026-10-28", teams), // 5 days ahead: in
      note("3", "2026-10-29", teams), // 6 days ahead: out
      note("4", "2026-10-24"), // not set up for Teams: out
      note("5", "2026-10-24", { ...teams, createdById: "2" }), // someone else's: out
      note("6", TODAY, { ...teams, transcript: "done" }), // already transcribed: out
      note("7", TODAY, teams),
    ], "1", TODAY);
    expect(list.map((m) => m.id)).toEqual(["7", "1", "2"]);
  });
});
