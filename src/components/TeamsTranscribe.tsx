import { useState } from "react";
import { Link } from "react-router-dom";
import { Captions, Copy, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { useStore } from "@/data/store";
import type { ID, MeetingNote, MeetingType } from "@/domain/types";
import { MEETING_TYPE_LABELS } from "@/domain/types";
import { canWrite } from "@/domain/permissions";
import { isTeamsJoinUrl } from "@/integrations/teams/adapter";
import { Field } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";

/**
 * "Transcribe with Teams" on the meeting display. Creates a Teams meeting set to record and
 * transcribe automatically, or switches that on for a meeting the person already scheduled,
 * and starts a meeting note to receive the transcript afterwards.
 */
export function TeamsTranscribeButton({ title, meetingId, onLinked }: { title: string; meetingId: ID | null; onLinked: (id: ID) => void }) {
  const { data, me } = useStore();
  const [open, setOpen] = useState(false);
  const linked = data.meetings.find((m) => m.id === meetingId && m.teamsJoinUrl) ?? null;
  if (!canWrite(me)) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant={linked ? "default" : "outline"} onClick={() => setOpen(true)}>
        <Captions />{linked ? "Teams transcription on" : "Transcribe with Teams"}
      </Button>
      <DialogContent>
        {linked ? <Linked meeting={linked} /> : <Start title={title} onLinked={onLinked} />}
      </DialogContent>
    </Dialog>
  );
}

function Start({ title, onLinked }: { title: string; onLinked: (id: ID) => void }) {
  const { me, repo, run, teams, today, toast } = useStore();
  const [type, setType] = useState<MeetingType>("weekly");
  const [link, setLink] = useState("");
  const subject = title.trim() || "FSI meeting";

  async function begin(existing: boolean) {
    const note = await run(async () => {
      const start = new Date();
      const t = existing ? await teams.attachMeeting(link) : await teams.createMeeting(subject, start, new Date(start.getTime() + 60 * 60_000));
      return repo.createMeeting({
        title: subject, meetingType: type, date: today, notes: "", attendeeIds: me ? [me.id] : [], teamsMeetingId: t.id, teamsJoinUrl: t.joinUrl,
      });
    });
    if (note) {
      onLinked(note.id);
      toast(existing ? "Transcription turned on for your meeting" : "Teams meeting created");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Transcribe with Teams</DialogTitle>
        <DialogDescription>
          Teams records and transcribes the meeting automatically once someone joins. After the meeting ends, get the transcript from the
          meeting note this creates.
        </DialogDescription>
      </DialogHeader>
      <Field label="Meeting type (for the meeting note)">
        <Select value={type} onChange={(e) => setType(e.target.value as MeetingType)}>
          {Object.entries(MEETING_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </Field>
      <div className="grid gap-2 rounded-md border p-3">
        <p className="text-sm font-medium">Start a new Teams meeting now</p>
        <p className="text-xs text-muted-foreground">Named "{subject}". You get a join link to open and share with the room.</p>
        <Button className="w-fit" onClick={() => begin(false)}>Create Teams meeting</Button>
      </div>
      <div className="grid gap-2 rounded-md border p-3">
        <p className="text-sm font-medium">Use a meeting already on your calendar</p>
        <p className="text-xs text-muted-foreground">Paste the Teams join link from the Outlook invite. You must be the meeting's organizer.</p>
        <Input value={link} placeholder="https://teams.microsoft.com/l/meetup-join/..." onChange={(e) => setLink(e.target.value)} />
        {link.trim() && !isTeamsJoinUrl(link) && <p className="text-xs text-red-700">That does not look like a Teams join link.</p>}
        <Button className="w-fit" variant="outline" disabled={!isTeamsJoinUrl(link)} onClick={() => begin(true)}>Turn on transcription</Button>
      </div>
    </>
  );
}

function Linked({ meeting }: { meeting: MeetingNote }) {
  const { toast } = useStore();
  return (
    <>
      <DialogHeader>
        <DialogTitle>Teams transcription is on</DialogTitle>
        <DialogDescription>
          Join the Teams meeting and share this screen. Teams starts recording and transcribing when the meeting starts. Transcripts
          usually appear a few minutes after the meeting ends.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={meeting.teamsJoinUrl} target="_blank" rel="noreferrer"><ExternalLink />Open in Teams</a>
        </Button>
        <Button
          variant="outline"
          onClick={() => navigator.clipboard.writeText(meeting.teamsJoinUrl).then(() => toast("Join link copied"), () => toast("Could not copy; open the meeting instead"))}
        >
          <Copy />Copy join link
        </Button>
        <Button variant="outline" asChild>
          <Link to={`/meeting?id=${meeting.id}`}><FileText />Meeting notes</Link>
        </Button>
      </div>
    </>
  );
}

/** Transcript section of a meeting note that has a Teams meeting. */
export function TranscriptCard({ meeting, canEdit }: { meeting: MeetingNote; canEdit: boolean }) {
  const { repo, run, teams, toast } = useStore();
  const [busy, setBusy] = useState(false);
  if (!meeting.teamsMeetingId) return null;

  async function fetchIt() {
    setBusy(true);
    const text = await run(async () => (await teams.fetchTranscript(meeting.teamsMeetingId)) ?? "");
    setBusy(false);
    if (text === undefined) return;
    if (!text) {
      toast("Teams has no transcript for this meeting yet. Transcripts usually appear a few minutes after the meeting ends.");
      return;
    }
    if (await run(() => repo.saveTranscript(meeting.id, text).then(() => true))) toast("Transcript saved");
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Teams transcript</CardTitle>
          <CardDescription>
            <a href={meeting.teamsJoinUrl} target="_blank" rel="noreferrer" className="hover:underline">Teams meeting</a> set to transcribe automatically.
          </CardDescription>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" disabled={busy} onClick={fetchIt}>
            <RefreshCw />{busy ? "Getting..." : meeting.transcript ? "Get again" : "Get transcript"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {meeting.transcript ? (
          <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">{meeting.transcript}</div>
        ) : (
          <p className="text-sm text-muted-foreground">No transcript yet. After the meeting ends, click Get transcript.</p>
        )}
      </CardContent>
    </Card>
  );
}
