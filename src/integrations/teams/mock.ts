import type { TeamsMeeting, TeamsTranscription } from "./adapter";
import { vttToText } from "./adapter";

/** Sample transcript in Teams' format. All names are fictional. */
export const MOCK_VTT = `WEBVTT

00:00:02.000 --> 00:00:06.500
<v Alex Rivera>Let's start with Paper 1. Sections one to three are running late.</v>

00:00:06.500 --> 00:00:09.000
<v Alex Rivera>Can we move the external review back a week?</v>

00:00:09.500 --> 00:00:14.000
<v Jordan Lee>Yes. I'll book the wargame venue by Friday.</v>
`;

/** In-memory stand-in for Teams. A meeting "has" a transcript once markEnded() is called. */
export class MockTeamsTranscription implements TeamsTranscription {
  readonly name = "Microsoft Teams (demo)";
  readonly meetings = new Map<string, TeamsMeeting & { recordAutomatically: boolean; ended: boolean }>();
  private next = 1;

  /** Demo mode: transcripts are ready right away so the flow can be tried end to end. */
  constructor(private readyImmediately = false) {}

  async createMeeting(subject: string): Promise<TeamsMeeting> {
    const id = `demo-meeting-${this.next++}`;
    const m = { id, subject, joinUrl: `https://teams.microsoft.com/l/meetup-join/${id}`, recordAutomatically: true, ended: this.readyImmediately };
    this.meetings.set(id, m);
    return { id, subject, joinUrl: m.joinUrl };
  }

  async attachMeeting(joinUrl: string): Promise<TeamsMeeting> {
    const existing = [...this.meetings.values()].find((m) => m.joinUrl === joinUrl.trim());
    if (existing) {
      existing.recordAutomatically = true;
      return { id: existing.id, subject: existing.subject, joinUrl: existing.joinUrl };
    }
    const id = `demo-meeting-${this.next++}`;
    this.meetings.set(id, { id, subject: "Scheduled meeting", joinUrl: joinUrl.trim(), recordAutomatically: true, ended: this.readyImmediately });
    return { id, subject: "Scheduled meeting", joinUrl: joinUrl.trim() };
  }

  markEnded(id: string) {
    const m = this.meetings.get(id);
    if (m) m.ended = true;
  }

  async fetchTranscript(meetingId: string): Promise<string | null> {
    const m = this.meetings.get(meetingId);
    if (!m) throw new Error("Teams did not find that meeting.");
    return m.ended ? vttToText(MOCK_VTT) : null;
  }
}
