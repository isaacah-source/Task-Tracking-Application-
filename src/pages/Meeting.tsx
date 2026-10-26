import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { History, Plus, Trash2, UserCheck } from "lucide-react";
import { useStore } from "@/data/store";
import type { ID, MeetingNote, MeetingType } from "@/domain/types";
import { MEETING_TYPE_LABELS } from "@/domain/types";
import { checkAssignment, suggestOwners, type AssignmentProposal } from "@/domain/conflicts";
import { canWrite, isAdmin } from "@/domain/permissions";
import { formatDate, formatShort } from "@/domain/dates";
import { recentWithNotes, upcomingTranscriptions } from "@/domain/meetings";
import { ConflictList } from "@/components/ConflictList";
import { TeamsTranscribeButton, TranscriptCard } from "@/components/TeamsTranscribe";
import { DepartmentSelect, DueFlag, Field, LineOfEffortSelect, PageHeader, PersonSelect, deptName, personName } from "@/components/common";
import { blankProject } from "@/components/ProjectForm";
import { meetingOrigin } from "@/data/repository";
import { TeamsCalendarCard, useCaptureTranscripts } from "@/components/TeamsCalendar";
import { MeetingRow } from "@/components/MeetingRow";
import { EffortInput } from "@/components/EffortInput";
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
  const { data, me, repo } = useStore();
  // ?id= opens a meeting directly (the meeting display links here).
  const [params, setParams] = useSearchParams();
  const currentId = params.get("id");
  const setCurrentId = (id: ID | null) => setParams(id ? { id } : {});
  const visible = useMemo(() => repo.visibleMeetings(), [repo, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = visible.find((m) => m.id === currentId) ?? null;
  useCaptureTranscripts();

  if (!current) {
    return (
      <>
        <PageHeader title="Meeting notes" description="Take notes and assign owners as decisions happen. The app checks each assignment for clashes right away." />
        {currentId && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">That meeting note is not shared with you.</p>}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="grid content-start gap-6">
            {canWrite(me) && <NewMeeting onCreated={setCurrentId} />}
            {canWrite(me) && <TeamsCalendarCard onOpen={setCurrentId} />}
          </div>
          <RecentMeetings meetings={visible} onOpen={setCurrentId} />
        </div>
      </>
    );
  }

  return <MeetingRoom key={current.id} meeting={current} onLeave={() => setCurrentId(null)} canEdit={canWrite(me)} />;
}

/**
 * Recent meetings with notes, and the person's upcoming meetings set up for Teams
 * transcription. Everything older is on the Past meetings page.
 */
function RecentMeetings({ meetings, onOpen }: { meetings: MeetingNote[]; onOpen: (id: ID) => void }) {
  const { data, me, today } = useStore();
  const upcoming = upcomingTranscriptions(meetings, me?.id ?? null, today);
  const recent = recentWithNotes(meetings, today);
  const past = meetings.filter((m) => m.date <= today).length;

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Recent meetings</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <section>
          <h3 className="mb-1 text-sm font-semibold">Meetings in the next 5 days you have selected transcription</h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">None. Choose meetings under "Select Upcoming Meetings to Transcribe".</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {upcoming.map((m) => <MeetingRow key={m.id} meeting={m} data={data} onOpen={() => onOpen(m.id)} />)}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-1 text-sm font-semibold">Meetings in the last 5 days that have notes</h3>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No meetings with notes or transcripts in the last 5 days.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {recent.map((m) => <MeetingRow key={m.id} meeting={m} data={data} onOpen={() => onOpen(m.id)} />)}
            </ul>
          )}
        </section>
        <Button variant="outline" className="w-fit" asChild>
          <Link to="/meeting/past"><History />All past meetings ({past})</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function NewMeeting({ onCreated }: { onCreated: (id: ID) => void }) {
  const { data, me, today, run, repo } = useStore();
  const [title, setTitle] = useState("Daily stand-up");
  const [type, setType] = useState<MeetingType>("daily");
  const [date, setDate] = useState(today);
  const [attendees, setAttendees] = useState<ID[]>(me ? [me.id] : []);
  const [dept, setDept] = useState<ID | null>(me?.departmentId ?? null);
  return (
    <Card>
      <CardHeader><CardTitle>Start a meeting</CardTitle></CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const m = await run(() => repo.createMeeting({ title: title.trim() || MEETING_TYPE_LABELS[type], meetingType: type, date, notes: "", attendeeIds: attendees, departmentId: dept }));
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Department" hint="Its people can read the notes, as can everyone in the meeting.">
              <DepartmentSelect departments={data.departments} value={dept} onChange={setDept} allowEmpty emptyLabel="Attendees only" />
            </Field>
          </div>
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
  const { data, me, today, run, repo, toast } = useStore();
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
  const [mode, setMode] = useState<"task" | "project">("task");
  // Adds a line to the typed notes, which save on their own a moment later.
  const addLine = (line: string) => setNotes((n) => `${n}${n && !n.endsWith("\n") ? "\n" : ""}${line}\n`);
  const assigned = data.tasks.filter((t) => t.sourceMeetingId === meeting.id);
  const origin = meetingOrigin(meeting);
  const newProjects = data.projects.filter((p) => data.audit.some((x) => x.entityType === "project" && x.entityId === p.id && x.field === "created" && x.reason === origin));
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
      toast(`Task added for ${personName(data, a.ownerId)}`);
      addLine(`→ ${a.title} (${personName(data, a.ownerId)}, due ${formatShort(a.dueDate)})`);
      setA({ ...blank, projectId: a.projectId });
    }
  }

  return (
    <>
      <PageHeader
        title={meeting.title}
        description={`${meeting.departmentId ? `${deptName(data, meeting.departmentId)} · ` : ""}${MEETING_TYPE_LABELS[meeting.meetingType]} · ${formatDate(meeting.date)} · ${meeting.attendeeIds.map((id) => personName(data, id)).join(", ")}`}
        actions={
          <>
            <TeamsTranscribeButton title={meeting.title} note={meeting} />
            {(meeting.meetingType !== "other") && <Button variant="outline" asChild><Link to="/tasks">Open task list</Link></Button>}
            <Button variant="outline" onClick={onLeave}>All meetings</Button>
            {isAdmin(me) && (
              <Button
                variant="outline"
                onClick={async () => {
                  const msg = `Delete the meeting note "${meeting.title}" (${formatDate(meeting.date)})? Its notes${meeting.transcript ? " and saved transcript" : ""} are removed from the app; tasks assigned in it stay. ${meeting.teamsMeetingId ? "The Teams meeting and its recording stay in Teams. " : ""}The deletion is recorded in the admin deletion log.`;
                  if (!confirm(msg)) return;
                  if (await run(() => repo.deleteMeeting(meeting.id).then(() => true), "Meeting note deleted")) onLeave();
                }}
              >
                <Trash2 />Delete
              </Button>
            )}
          </>
        }
      />
      {canEdit && (
        <div className="mb-4 flex max-w-md items-center gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">Department:</span>
          <DepartmentSelect
            departments={data.departments}
            value={meeting.departmentId}
            onChange={(id) => run(() => repo.updateMeeting(meeting.id, { departmentId: id }), "Department saved")}
            allowEmpty
            emptyLabel="None (attendees only)"
          />
        </div>
      )}
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
                <CardTitle>Add from this meeting</CardTitle>
                <CardDescription>
                  {mode === "task" ? "A new task in a project, checked against everyone's existing work as you type." : "A new project, under one of FSI's lines of effort."}
                </CardDescription>
                <div className="flex w-fit gap-1 rounded-md border p-1" role="tablist" aria-label="What to add">
                  {(["task", "project"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => setMode(m)}
                      className={`rounded px-3 py-1 text-sm ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                    >
                      {m === "task" ? "New task" : "New project"}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {mode === "project" ? <NewProjectFromMeeting meeting={meeting} onAdded={addLine} /> : (
                <form className="grid gap-3" onSubmit={(e) => (e.preventDefault(), ready && assign())}>
                  <Field label="Task">
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Start"><Input type="date" value={a.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} /></Field>
                    <Field label="Due"><Input type="date" value={a.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} /></Field>
                    <Field label="Effort"><EffortInput value={a.effortHours} onChange={(h) => set("effortHours", h)} /></Field>
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
                    <Plus />{hasConflict ? "Add task anyway" : "Add task"}
                  </Button>
                </form>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Added in this meeting</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {newProjects.length > 0 && (
                <ul className="divide-y">
                  {newProjects.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <div>
                        <Link to={`/projects/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                        <div className="text-xs text-muted-foreground">
                          New project · {personName(data, p.ownerId)} · {data.linesOfEffort.find((l) => l.id === p.lineOfEffortId)?.name}
                        </div>
                      </div>
                      {p.dueDate && <Badge variant="outline">Due {formatShort(p.dueDate)}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              {assigned.length === 0 && newProjects.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : assigned.length === 0 ? null : (
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

/** "New project" side of the meeting's Add box. */
function NewProjectFromMeeting({ meeting, onAdded }: { meeting: MeetingNote; onAdded: (line: string) => void }) {
  const { data, me, run, repo, toast } = useStore();
  const [title, setTitle] = useState("");
  const [loe, setLoe] = useState<ID | null>(null);
  const [dept, setDept] = useState<ID | null>(meeting.departmentId ?? me?.departmentId ?? null);
  const [owner, setOwner] = useState<ID | null>(me?.id ?? null);
  const [start, setStart] = useState("");
  const [due, setDue] = useState("");
  const [budget, setBudget] = useState(0);
  const ready = !!(title.trim() && loe && dept && owner);

  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        const p = await run(() => repo.createProject({
          ...blankProject(owner, dept), title, lineOfEffortId: loe, startDate: start || null, dueDate: due || null, plannedBudget: budget,
          operationalDetails: `Started in the meeting "${meeting.title}" (${formatDate(meeting.date)}).`,
        }, [], meetingOrigin(meeting)));
        if (p) {
          toast(`Project "${p.title}" created`);
          onAdded(`→ New project: ${p.title} (${personName(data, owner)}${due ? `, due ${formatShort(due)}` : ""})`);
          setTitle(""); setStart(""); setDue(""); setBudget(0);
        }
      }}
    >
      <Field label="Project"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Paper 2 on compute governance" /></Field>
      <Field label="Line of effort">
        <LineOfEffortSelect
          data={data}
          value={loe}
          onChange={(id) => {
            setLoe(id);
            const l = data.linesOfEffort.find((x) => x.id === id);
            if (l && !dept) setDept(l.departmentId);
          }}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Owner">
          <PersonSelect people={data.people.filter((p) => p.role !== "viewer" && p.active)} value={owner} onChange={setOwner} allowEmpty emptyLabel="Choose an owner" />
        </Field>
        <Field label="Department"><DepartmentSelect departments={data.departments} value={dept} onChange={setDept} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Start"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Due"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Planned budget ($)"><Input type="number" min={0} step={500} value={budget} onChange={(e) => setBudget(Number(e.target.value))} /></Field>
      </div>
      <p className="text-xs text-muted-foreground">Add tasks, output types, and stages on the project's page afterwards.</p>
      <Button type="submit" disabled={!ready}><Plus />Create project</Button>
    </form>
  );
}
