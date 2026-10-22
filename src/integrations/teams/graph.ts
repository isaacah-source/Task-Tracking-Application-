// Teams meetings and transcripts through Microsoft Graph, as the signed-in person. Only a
// meeting's organizer can change its options or read its transcript.

import { GRAPH, GraphError, type TokenFn } from "@/data/graphBackend";
import { vttToText, type TeamsMeeting, type TeamsTranscription } from "./adapter";

/** Create meetings and change their options. */
export const MEETING_SCOPES = ["OnlineMeetings.ReadWrite"];
/** Read transcripts. Needs admin consent in Entra. */
export const TRANSCRIPT_SCOPES = ["OnlineMeetingTranscript.Read.All"];

type Fetch = typeof fetch;
type GraphMeeting = { id: string; joinWebUrl: string; subject: string | null };

export class GraphTeamsTranscription implements TeamsTranscription {
  readonly name = "Microsoft Teams";

  constructor(private token: TokenFn, private fetchFn: Fetch = (...a) => fetch(...a)) {}

  private async call(method: string, path: string, scopes: string[], body?: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.token(scopes)}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await this.fetchFn(`${GRAPH}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.ok) return res;
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 3) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get("Retry-After")) || 2 ** attempt) * 1000));
        continue;
      }
      const err = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      const code = err.error?.code ?? "";
      if (res.status === 401 || res.status === 403 || code === "accessDenied") {
        throw new GraphError(res.status, code,
          "Teams refused. Only the meeting's organizer can turn on transcription or read the transcript, and a Microsoft 365 admin must approve the app's Teams permissions (see README, \"Teams transcription\").");
      }
      throw new GraphError(res.status, code, err.error?.message || `Microsoft Graph error ${res.status}`);
    }
  }

  private toMeeting(m: GraphMeeting): TeamsMeeting {
    return { id: m.id, joinUrl: m.joinWebUrl, subject: m.subject ?? "" };
  }

  async createMeeting(subject: string, start: Date, end: Date): Promise<TeamsMeeting> {
    const res = await this.call("POST", "/me/onlineMeetings", MEETING_SCOPES, {
      subject, startDateTime: start.toISOString(), endDateTime: end.toISOString(), recordAutomatically: true,
    });
    return this.toMeeting((await res.json()) as GraphMeeting);
  }

  async attachMeeting(joinUrl: string): Promise<TeamsMeeting> {
    const filter = encodeURIComponent(`JoinWebUrl eq '${joinUrl.trim().replace(/'/g, "''")}'`);
    const res = await this.call("GET", `/me/onlineMeetings?$filter=${filter}`, MEETING_SCOPES);
    const found = ((await res.json()) as { value: GraphMeeting[] }).value[0];
    if (!found) {
      throw new Error("Teams did not find a meeting you organize with that link. Copy the full join link from the Outlook invite; only the organizer can turn on transcription.");
    }
    await this.call("PATCH", `/me/onlineMeetings/${found.id}`, MEETING_SCOPES, { recordAutomatically: true });
    return this.toMeeting(found);
  }

  async fetchTranscript(meetingId: string): Promise<string | null> {
    const res = await this.call("GET", `/me/onlineMeetings/${meetingId}/transcripts`, TRANSCRIPT_SCOPES);
    const list = ((await res.json()) as { value: { id: string; createdDateTime: string }[] }).value;
    if (!list.length) return null;
    // A meeting started more than once has one transcript per session; keep them in order.
    const parts: string[] = [];
    for (const t of [...list].sort((a, b) => a.createdDateTime.localeCompare(b.createdDateTime))) {
      const content = await this.call("GET", `/me/onlineMeetings/${meetingId}/transcripts/${t.id}/content?$format=text/vtt`, TRANSCRIPT_SCOPES);
      parts.push(vttToText(await content.text()));
    }
    return parts.filter(Boolean).join("\n\n---\n\n");
  }
}
