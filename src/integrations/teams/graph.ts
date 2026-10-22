// Teams meetings and transcripts through Microsoft Graph, as the signed-in person. Only a
// meeting's organizer can change its options or read its transcript.

import { GRAPH, GraphError, type TokenFn } from "@/data/graphBackend";
import { vttToText, type CalendarMeeting, type TeamsMeeting, type TeamsTranscription } from "./adapter";

/** Create meetings and change their options. */
export const MEETING_SCOPES = ["OnlineMeetings.ReadWrite"];
/** Read the person's calendar, to list their Teams meetings. */
export const CALENDAR_SCOPES = ["Calendars.Read"];
/** Read transcripts. Needs admin consent in Entra. */
export const TRANSCRIPT_SCOPES = ["OnlineMeetingTranscript.Read.All"];

type Fetch = typeof fetch;
type GraphMeeting = { id: string; joinWebUrl: string; subject: string | null };

export class GraphTeamsTranscription implements TeamsTranscription {
  readonly name = "Microsoft Teams";

  constructor(private token: TokenFn, private fetchFn: Fetch = (...a) => fetch(...a)) {}

  private async call(method: string, path: string, scopes: string[], body?: unknown, extra: Record<string, string> = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(scopes);
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...extra };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await this.fetchFn(`${GRAPH}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.ok) return res;
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 3) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get("Retry-After")) || 2 ** attempt) * 1000));
        continue;
      }
      const err = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      const code = err.error?.code ?? "";
      // Teams' own words, so the cause can be told apart from the usual ones listed here.
      const said = err.error?.message ? ` Teams said: "${err.error.message}"${code ? ` (${code})` : ""}.` : code ? ` Teams said: ${code}.` : "";
      if (res.status === 401 || res.status === 403 || code === "accessDenied") {
        const granted = grantedScopes(token);
        const missing = granted ? scopes.filter((x) => !granted.includes(x.toLowerCase())) : [];
        if (missing.length) {
          throw new GraphError(res.status, code,
            `Your Microsoft sign-in does not include the ${missing.join(", ")} permission yet. Sign out of the app and sign in again. If this keeps happening, a Microsoft 365 admin needs to grant admin consent for it (see README, "Teams transcription").${said}`);
        }
        throw new GraphError(res.status, code,
          `Teams refused. Only the meeting's organizer can turn on transcription or read the transcript.${said}`);
      }
      throw new GraphError(res.status, code, err.error?.message || `Microsoft Graph error ${res.status}`);
    }
  }

  private toMeeting(m: GraphMeeting): TeamsMeeting {
    return { id: m.id, joinUrl: m.joinWebUrl, subject: m.subject ?? "" };
  }

  async listCalendar(from: Date, to: Date): Promise<CalendarMeeting[]> {
    type Ev = {
      id: string; subject: string | null; isCancelled?: boolean; isOrganizer?: boolean; isOnlineMeeting?: boolean;
      start: { dateTime: string }; end: { dateTime: string }; onlineMeeting?: { joinUrl?: string } | null;
      organizer?: { emailAddress?: { name?: string; address?: string } };
      attendees?: { emailAddress?: { address?: string } }[];
    };
    const select = "subject,start,end,isCancelled,isOrganizer,isOnlineMeeting,onlineMeeting,organizer,attendees";
    let path: string | null =
      `/me/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$select=${select}&$orderby=start/dateTime&$top=100`;
    const out: CalendarMeeting[] = [];
    // Times come back in UTC without a zone marker when asked for UTC.
    const utc = (s: string) => (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s.replace(/\.\d+$/, "")}Z`);
    for (let page = 0; path && page < 10; page++) {
      const res = await this.call("GET", path, CALENDAR_SCOPES, undefined, { Prefer: 'outlook.timezone="UTC"' });
      const body = (await res.json()) as { value: Ev[]; "@odata.nextLink"?: string };
      for (const e of body.value) {
        const joinUrl = e.onlineMeeting?.joinUrl;
        if (!e.isOnlineMeeting || !joinUrl || e.isCancelled) continue;
        out.push({
          eventId: e.id, subject: e.subject ?? "", start: utc(e.start.dateTime), end: utc(e.end.dateTime), joinUrl,
          organizerName: e.organizer?.emailAddress?.name ?? "", organizerEmail: (e.organizer?.emailAddress?.address ?? "").toLowerCase(),
          isOrganizer: !!e.isOrganizer,
          attendeeEmails: (e.attendees ?? []).map((a) => (a.emailAddress?.address ?? "").toLowerCase()).filter(Boolean),
        });
      }
      path = body["@odata.nextLink"]?.replace(GRAPH, "") ?? null;
    }
    return out;
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

/** The delegated permissions in an access token ("scp" claim), lower-cased; null if unreadable. */
export function grantedScopes(token: string): string[] | null {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "="))) as { scp?: string };
    return claims.scp ? claims.scp.toLowerCase().split(" ") : null;
  } catch {
    return null;
  }
}
