import { useEffect, useRef, useState } from "react";
import { CalendarSearch, Captions } from "lucide-react";
import { useStore } from "@/data/store";
import type { ID, MeetingType, Person } from "@/domain/types";
import { MEETING_TYPE_LABELS } from "@/domain/types";
import { today as localDate } from "@/domain/dates";
import type { CalendarMeeting } from "@/integrations/teams/adapter";
import { DepartmentSelect, Field } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** People in this app who are on the calendar invite, plus the person setting it up. */
export function attendeesFor(m: CalendarMeeting, people: Person[], me: Person | null): ID[] {
  const emails = new Set([...m.attendeeEmails, m.organizerEmail].map((e) => e.toLowerCase()));
  const ids = people.filter((p) => p.active && emails.has(p.email.toLowerCase())).map((p) => p.id);
  return me && !ids.includes(me.id) ? [me.id, ...ids] : ids;
}

const DAYS_AHEAD = 14;

/**
 * Lists the person's Teams meetings for the next two weeks (and the past day) from their
 * Outlook calendar. Ticking meetings and clicking "Transcribe and take notes" turns on
 * automatic recording and transcription for each and starts a meeting note for it.
 */
export function TeamsCalendarCard({ onOpen }: { onOpen: (id: ID) => void }) {
  const { data, me, repo, run, teams, toast } = useStore();
  const [meetings, setMeetings] = useState<CalendarMeeting[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [dept, setDept] = useState<ID | null>(me?.departmentId ?? null);
  const [type, setType] = useState<MeetingType>("weekly");
  const [busy, setBusy] = useState(false);
  const linked = (m: CalendarMeeting) => data.meetings.find((n) => n.teamsJoinUrl && n.teamsJoinUrl === m.joinUrl) ?? null;

  async function load() {
    setBusy(true);
    const now = new Date();
    const list = await run(() => teams.listCalendar(new Date(now.getTime() - 24 * 3600_000), new Date(now.getTime() + DAYS_AHEAD * 24 * 3600_000)));
    setBusy(false);
    if (list) setMeetings(list);
  }

  async function setUp() {
    const chosen = (meetings ?? []).filter((m) => picked.includes(m.eventId));
    setBusy(true);
    const done = await run(async () => {
      let n = 0;
      for (const m of chosen) {
        const t = await teams.attachMeeting(m.joinUrl);
        await repo.createMeeting({
          title: m.subject || "Teams meeting", meetingType: type, date: localDate(new Date(m.start)), notes: "",
          attendeeIds: attendeesFor(m, data.people, me), departmentId: dept, teamsMeetingId: t.id, teamsJoinUrl: t.joinUrl,
        });
        n++;
      }
      return n;
    });
    setBusy(false);
    if (done) {
      setPicked([]);
      toast(`${done} meeting${done === 1 ? "" : "s"} set to transcribe. Notes are under Meeting notes.`);
    }
  }

  const time = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Select Upcoming Meetings to Transcribe</CardTitle>
        <CardDescription>
          Choose upcoming Teams meetings to transcribe. Each gets a meeting note, and its transcript is saved there after the meeting.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {meetings === null ? (
          <Button className="w-fit" variant="outline" disabled={busy} onClick={load}>
            <CalendarSearch />{busy ? "Loading..." : `Show my Teams meetings (next ${DAYS_AHEAD} days)`}
          </Button>
        ) : meetings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Teams meetings on your calendar in the next {DAYS_AHEAD} days.</p>
        ) : (
          <>
            <ul className="divide-y rounded-md border">
              {meetings.map((m) => {
                const note = linked(m);
                const ended = m.end < new Date().toISOString();
                const can = m.isOrganizer && !note && !ended;
                const on = picked.includes(m.eventId);
                return (
                  <li key={m.eventId} className={cn("flex items-start gap-3 p-2.5 text-sm", !can && !note && "text-muted-foreground")}>
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={`Transcribe ${m.subject}`}
                      checked={on || !!note}
                      disabled={!can}
                      onChange={() => setPicked((p) => (on ? p.filter((x) => x !== m.eventId) : [...p, m.eventId]))}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{m.subject || "(No title)"}</div>
                      <div className="text-xs text-muted-foreground">{time(m.start)} · {m.isOrganizer ? "You organize" : `Organizer: ${m.organizerName || m.organizerEmail}`}</div>
                      {!m.isOrganizer && !note && <div className="text-xs">Only the organizer can turn on transcription.</div>}
                    </div>
                    {note ? (
                      <Button size="sm" variant="ghost" onClick={() => onOpen(note.id)}><Badge variant="success">Notes set up</Badge></Button>
                    ) : ended ? <Badge variant="muted">Ended</Badge> : null}
                  </li>
                );
              })}
            </ul>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Department (who can read the notes)">
                <DepartmentSelect departments={data.departments} value={dept} onChange={setDept} allowEmpty emptyLabel="Attendees only" />
              </Field>
              <Field label="Meeting type">
                <Select value={type} onChange={(e) => setType(e.target.value as MeetingType)}>
                  {Object.entries(MEETING_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!picked.length || busy} onClick={setUp}>
                <Captions />{busy ? "Setting up..." : `Transcribe and take notes${picked.length ? ` (${picked.length})` : ""}`}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={load}>Refresh</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Once per visit, fetches transcripts for Teams-linked notes this person set up whose meeting
 * day has come, and saves any Teams has ready. Quiet: errors and "not ready yet" are left for
 * the Get transcript button on each note.
 */
export function useCaptureTranscripts() {
  const { me, repo, teams, today, toast, mode, refresh } = useStore();
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || !me) return;
    tried.current = true;
    const due = repo.visibleMeetings().filter((m) => m.teamsMeetingId && !m.transcript && m.createdById === me.id && m.date <= today);
    if (!due.length) return;
    void (async () => {
      let saved = 0;
      for (const m of due) {
        try {
          const text = await teams.fetchTranscript(m.teamsMeetingId);
          if (text) {
            await repo.saveTranscript(m.id, text);
            saved++;
          }
        } catch {
          // Left for the note's Get transcript button, which shows the reason.
        }
      }
      if (saved) await refresh();
      if (saved) toast(`Saved ${saved} transcript${saved === 1 ? "" : "s"} from Teams${mode === "demo" ? " (sample)" : ""}.`);
    })();
  }, [me, repo, teams, today, toast, mode, refresh]);
}
