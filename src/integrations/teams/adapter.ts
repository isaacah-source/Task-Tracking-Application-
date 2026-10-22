// Teams transcription for meetings. Microsoft does not let an app switch transcription on in a
// call that is already running, so this works through the meeting itself: the app creates a
// Teams meeting (or finds one the person already scheduled) with "record and transcribe
// automatically" on, and after the meeting fetches the transcript Teams made. graph.ts talks
// to Teams through Microsoft Graph; mock.ts stands in for demo mode and tests.

export interface TeamsMeeting {
  /** Graph's onlineMeeting id. */
  id: string;
  joinUrl: string;
  subject: string;
}

export interface TeamsTranscription {
  readonly name: string;
  /** New Teams meeting, starting now, set to record and transcribe automatically. */
  createMeeting(subject: string, start: Date, end: Date): Promise<TeamsMeeting>;
  /**
   * Finds a meeting the signed-in person organizes from its join link and turns on
   * "record and transcribe automatically" for it.
   */
  attachMeeting(joinUrl: string): Promise<TeamsMeeting>;
  /** The meeting's transcript as plain text, or null when Teams has none yet. */
  fetchTranscript(meetingId: string): Promise<string | null>;
}

/** True for a Teams join link (teams.microsoft.com/l/meetup-join/... or teams.live.com). */
export function isTeamsJoinUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" && /(^|\.)teams\.(microsoft|live)\.com$/.test(u.hostname) && /meet/i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Turns Teams' WebVTT transcript into readable text: one paragraph per turn, as
 * "[m:ss] Speaker: words". Consecutive lines from the same speaker are joined.
 */
export function vttToText(vtt: string): string {
  const turns: { at: string; who: string; text: string }[] = [];
  const blocks = vtt.replace(/\r/g, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim());
    const timeLine = lines.findIndex((l) => l.includes("-->"));
    if (timeLine < 0) continue;
    const at = shortTime(lines[timeLine].split("-->")[0].trim());
    const body = lines.slice(timeLine + 1).join(" ");
    const voice = body.match(/<v\s+([^>]*)>/);
    const who = voice ? voice[1].trim() : "";
    const text = body.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const last = turns[turns.length - 1];
    if (last && last.who === who) last.text += ` ${text}`;
    else turns.push({ at, who, text });
  }
  return turns.map((t) => `[${t.at}] ${t.who ? `${t.who}: ` : ""}${t.text}`).join("\n\n");
}

/** "00:01:05.320" or "0:01:05.320" -> "1:05"; keeps hours when there are any. */
function shortTime(stamp: string): string {
  const m = stamp.match(/(?:(\d+):)?(\d+):(\d+)/);
  if (!m) return stamp;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const s = m[3].padStart(2, "0");
  return h ? `${h}:${String(min).padStart(2, "0")}:${s}` : `${min}:${s}`;
}
