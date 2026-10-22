import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, UserCheck } from "lucide-react";
import { useStore } from "@/data/store";
import type { ID, MeetingNote, MeetingType } from "@/domain/types";
import { MEETING_TYPE_LABELS } from "@/domain/types";
import { checkAssignment, suggestOwners, type AssignmentProposal } from "@/domain/conflicts";
import { canWrite } from "@/domain/permissions";
import { formatDate, formatShort } from "@/domain/dates";
import { ConflictList } from "@/components/ConflictList";
import { TranscriptCard } from "@/components/TeamsTranscribe";
import { DueFlag, Empty, Field, PageHeader, PersonSelect, personName } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";

/**
 * Take notes in a meeting and assign work as it comes up. Each assignment is checked live
 * against everyone's existing commitments (timing, workload, budget, task order) before it
 * is saved.
 */
export default function MeetingPage() {
  const { data, me } = useStore();
  const meetings = [...data.meetings].sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
  // ?id= opens a meeting directly (the meeting display links here).
  const [params, setParams] = useSearchParams();
  const currentId = params.get("id");
  const setCurrentId = (id: ID | null) => setParams(id ? { id } : {});
  const current = data.meetings.find((m) => m.id === currentId) ?? null;

  if (!current) {
    return (
      <>
        <PageHeader title="Meeting notes" description="Take notes and assign owners as decisions happen. The app checks each assignment for clashes right away." />
        <div className="grid gap-6 lg:grid-cols-2">
          {canWrite(me) && <NewMeeting onCreated={setCurrentId} />}
          <Card>
            <CardHeader><CardTitle>Recent meetings</CardTitle></CardHeader>
            <CardContent>
              {meetings.length === 0 ? <Empty>No meetings yet.</Empty> : (
                <ul className="divide-y">
                  {meetings.slice(0, 15).map((m) => (
                    <li key={m.id}>
                      <button className="flex w-full items-center justify-between gap-2 py-2.5 text-left hover:bg-accent/50" onClick={() => setCurrentId(m.id)}>
                        <span className="font-medium">{m.title}</span>
                        <span className="text-xs text-muted-foreground">{MEETING_TYPE_LABELS[m.meetingType]} · {formatDate(m.date)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return <MeetingRoom key={current.id} meeting={current} onLeave={() => setCurrentId(null)} canEdit={canWrite(me)} />;
}

function NewMeeting({ onCreated }: { onCreated: (id: ID) => void }) {
  const { data, me, today, run, repo } = useStore();
  const [title, setTitle] = useState("Daily stand-up");
  const [type, setType] = useState<MeetingType>("daily");
  const [date, setDate] = useState(today);
  const [attendees, setAttendees] = useState<ID[]>(me ? [me.id] : []);
  return (
    <Card>
      <CardHeader><CardTitle>Start a meeting</CardTitle></CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const m = await run(() => repo.createMeeting({ title: title.trim() || MEETING_TYPE_LABELS[type], meetingType: type, date, notes: "", attendeeIds: attendees }));
            if (m) onCreated(m.id);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Meeting">
              <Select value={type} onChange={(e) => {
                const t = e.target.value as MeetingType;
                setType(t);
                setTitle(t === "daily" ? "Daily stand-up" : MEETING_TYPE_LABELS[t]);
              }}>
                {Object.entries(MEETING_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Who is here</legend>
            <div className="flex flex-wrap gap-2">
              {data.people.filter((p) => p.active).map((p) => {
                const on = attendees.includes(p.id);
                return (
                  <button type="button" key={p.id} aria-pressed={on} onClick={() => setAttendees((a) => (on ? a.filter((x) => x !== p.id) : [...a, p.id]))}
                    className={`rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}>
                    {p.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Button type="submit">Start taking notes</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MeetingRoom({ meeting, onLeave, canEdit }: { meeting: MeetingNote; onLeave: () => void; canEdit: boolean }) {
  const { data, today, run, repo, toast } = useStore();
  const [notes, setNotes] = useState(meeting.notes);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // Save notes a moment after typing stops.
  useEffect(() => {
    if (notes === meeting.notes) return;
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await run(() => repo.updateMeeting(meeting.id, { notes }));
      setSaved(true);
    }, 1200);
    return () => clearTimeout(timer.current);
  }, [notes, meeting.id, meeting.notes, repo, run]);

  const blank: AssignmentProposal = { title: "", ownerId: null, projectId: null, startDate: null, dueDate: null, effortHours: 0, estimatedCost: 0, predecessorIds: [] };
  const [a, setA] = useState<AssignmentProposal>(blank);
  const set = <K extends keyof AssignmentProposal>(k: K, v: AssignmentProposal[K]) => setA((x) => ({ ...x, [k]: v }));
  const conflicts = useMemo(() => (a.ownerId && a.dueDate ? checkAssignment(a, data, today) : []), [a, data, today]);
  const suggestions = useMemo(
    () => (conflicts.some((c) => c.kind === "resourcing" && c.severity === "conflict") ? suggestOwners(a, data, today) : []),
    [conflicts, a, data, today],
  );
  const assigned = data.tasks.filter((t) => t.sourceMeetingId === meeting.id);
  const projectTasks = a.projectId ? data.tasks.filter((t) => t.projectId === a.projectId && t.status !== "done") : [];
  const ready = !!(a.title.trim() && a.ownerId && a.projectId && a.dueDate);
  const hasConflict = conflicts.some((c) => c.severity === "conflict");

  async function assign() {
    const t = await run(() =>
      repo.createTask(
        {
          projectId: a.projectId!, title: a.title, kind: "task", ownerId: a.ownerId, startDate: a.startDate, dueDate: a.dueDate,
          status: "notStarted", effortHours: a.effortHours, estimatedCost: a.estimatedCost, notes: `Assigned in ${meeting.title} (${formatDate(meeting.date)})`,
          sourceMeetingId: meeting.id,
        },
        a.predecessorIds,
      ),
    );
    if (t) {
      toast(`Assigned to ${personName(data, a.ownerId)}`);
      setNotes((n) => `${n}${n && !n.endsWith("\n") ? "\n" : ""}→ ${a.title} (${personName(data, a.ownerId)}, due ${formatShort(a.dueDate)})\n`);
      setA({ ...blank, projectId: a.projectId });
    }
  }

  return (
    <>
      <PageHeader
        title={meeting.title}
        description={`${MEETING_TYPE_LABELS[meeting.meetingType]} · ${formatDate(meeting.date)} · ${meeting.attendeeIds.map((id) => personName(data, id)).join(", ")}`}
        actions={
          <>
            {(meeting.meetingType !== "other") && <Button variant="outline" asChild><Link to="/tasks">Open task list</Link></Button>}
            <Button variant="outline" onClick={onLeave}>All meetings</Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card className="flex flex-col">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Notes</CardTitle>
            <span className="text-xs text-muted-foreground">{canEdit ? (saved ? "Saved" : "Saving...") : "View only"}</span>
          </CardHeader>
          <CardContent className="flex-1">
            <Textarea className="min-h-[420px] font-[inherit] leading-relaxed" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit}
              placeholder="Type as people talk. Assignments you make on the right are added here too." />
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <TranscriptCard meeting={meeting} canEdit={canEdit} />
          {canEdit && (
            <Card>
              <CardHeader>
                <CardTitle>Assign something</CardTitle>
                <CardDescription>Checked against everyone's existing work as you type.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-3" onSubmit={(e) => (e.preventDefault(), ready && assign())}>
                  <Field label="What">
                    <Input value={a.title} onChange={(e) => set("title", e.target.value)} placeholder="For example: send briefing invites" />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Who">
                      <PersonSelect people={data.people.filter((p) => p.role !== "viewer")} value={a.ownerId} onChange={(id) => set("ownerId", id)} allowEmpty emptyLabel="Choose an owner" />
                    </Field>
                    <Field label="Project">
                      <Select value={a.projectId ?? ""} onChange={(e) => setA((x) => ({ ...x, projectId: e.target.value || null, predecessorIds: [] }))}>
                        <option value="">Choose a project</option>
                        {data.projects.filter((p) => p.status !== "done").map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Start"><Input type="date" value={a.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} /></Field>
                    <Field label="Due"><Input type="date" value={a.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} /></Field>
                    <Field label="Hours"><Input type="number" min={0} value={a.effortHours} onChange={(e) => set("effortHours", Number(e.target.value))} /></Field>
                    <Field label="Cost ($)"><Input type="number" min={0} step={50} value={a.estimatedCost} onChange={(e) => set("estimatedCost", Number(e.target.value))} /></Field>
                  </div>
                  {projectTasks.length > 0 && (
                    <Field label="Has to wait for (optional)">
                      <Select value={a.predecessorIds[0] ?? ""} onChange={(e) => set("predecessorIds", e.target.value ? [e.target.value] : [])}>
                        <option value="">Nothing</option>
                        {projectTasks.map((t) => <option key={t.id} value={t.id}>{t.title}{t.dueDate ? ` (due ${formatShort(t.dueDate)})` : ""}</option>)}
                      </Select>
                    </Field>
                  )}
                  <div className="rounded-md border bg-muted/40 p-3">
                    <ConflictList conflicts={conflicts} ready={!!a.ownerId && !!a.dueDate} />
                    {suggestions.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted-foreground">People with room:</span>
                        {suggestions.map((s) => (
                          <Button key={s.person.id} type="button" size="sm" variant="outline" onClick={() => set("ownerId", s.person.id)}>
                            <UserCheck />{s.person.name} ({Math.round(s.freeHours)} h free)
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button type="submit" disabled={!ready} variant={hasConflict ? "destructive" : "default"}>
                    <Plus />{hasConflict ? "Assign anyway" : "Assign"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Assigned in this meeting</CardTitle></CardHeader>
            <CardContent>
              {assigned.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
                <ul className="divide-y">
                  {assigned.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <div>
                        <Link to={`/projects/${t.projectId}?task=${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                        <div className="text-xs text-muted-foreground">{personName(data, t.ownerId)} · {data.projects.find((p) => p.id === t.projectId)?.title}</div>
                      </div>
                      <span className="flex items-center gap-2">
                        <DueFlag dueDate={t.dueDate} status={t.status} today={today} />
                        <Badge variant="outline">Due {formatShort(t.dueDate)}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
