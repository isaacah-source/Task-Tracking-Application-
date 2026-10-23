// Which meeting notes the Meeting notes page lists up front.

import type { ID, MeetingNote } from "./types";
import { addDays } from "./dates";

/** A note has notes when someone typed some or Teams supplied a transcript. */
export function hasNotes(m: MeetingNote): boolean {
  return !!(m.notes.trim() || m.transcript.trim());
}

/** Meetings from today back `days` days that have notes, newest first. */
export function recentWithNotes(meetings: MeetingNote[], today: string, days = 5): MeetingNote[] {
  const since = addDays(today, -days);
  return meetings
    .filter((m) => m.date >= since && m.date <= today && hasNotes(m))
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
}

/**
 * Meetings from today through `days` days ahead that this person set up for Teams
 * transcription and that have no transcript yet, soonest first.
 */
export function upcomingTranscriptions(meetings: MeetingNote[], meId: ID | null, today: string, days = 5): MeetingNote[] {
  const until = addDays(today, days);
  return meetings
    .filter((m) => m.teamsMeetingId && !m.transcript.trim() && m.createdById === meId && m.date >= today && m.date <= until)
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.id) - Number(b.id));
}
