import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Link2, Pencil, Plus, RefreshCw, Trash2, UserPlus } from "lucide-react";
import { useStore } from "@/data/store";
import type { ID, Project, RelationshipGroup, Stage, Task } from "@/domain/types";
import { MEMBERSHIP_LABELS, RELATIONSHIP_GROUPS, RELATIONSHIP_GROUP_LABELS, TASK_KIND_LABELS } from "@/domain/types";
import { blockedTaskIds, blockers, topoOrder } from "@/domain/dependencies";
import { activeStage, stagesFor } from "@/domain/transitions";
import { formatDate } from "@/domain/dates";
import { fieldLabel } from "@/data/repository";
import {
  BlockedBadge, DateText, DepartmentSelect, DueFlag, Empty, Field, PageHeader, handoffMessage, PersonSelect, Stat, StatusBadge, deptName, money, personName,
} from "@/components/common";
import { ProjectForm } from "@/components/ProjectForm";
import { TaskDialog } from "@/components/TaskDialog";
import { Gantt } from "@/components/Gantt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { groupForType, type ExternalContact, type ExternalOrganization } from "@/integrations/relationships/adapter";
import { involvementFor, pushNow, syncRelationships } from "@/integrations/relationships/sync";

export default function ProjectDetailPage() {
  const { id } = useParams();
  const { data, repo, today, run } = useStore();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const project = data.projects.find((p) => p.id === id);
  const [taskDialog, setTaskDialog] = useState<{ task: Task | null } | null>(null);

  // Links like /projects/1?task=4 open that task.
  useEffect(() => {
    const tid = params.get("task");
    if (tid) {
      const t = data.tasks.find((x) => x.id === tid);
      if (t) setTaskDialog({ task: t });
      params.delete("task");
      setParams(params, { replace: true });
    }
  }, [params, data.tasks, setParams]);

  if (!project) return <Empty>This project was not found. It may have been deleted. <Link className="underline" to="/projects">Back to projects</Link></Empty>;
  const canEdit = repo.canEdit(project);
  const stage = activeStage(project.id, data.stages);

  return (
    <>
      <PageHeader
        title={project.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {project.lineOfEffortId
              ? <Link to={`/lines#loe-${project.lineOfEffortId}`} className="font-medium hover:underline">{data.linesOfEffort.find((l) => l.id === project.lineOfEffortId)?.name}</Link>
              : <Badge variant="warning">Needs a line of effort</Badge>}
            <span>·</span>
            {deptName(data, project.departmentId)} · Owner: {personName(data, project.ownerId)}
            <StatusBadge status={project.status} />
            <DueFlag dueDate={project.dueDate} status={project.status} today={today} />
            {stage && <Badge variant="outline">Stage: {stage.name}</Badge>}
            {!canEdit && <Badge variant="muted">View only</Badge>}
          </span>
        }
        actions={
          repo.canDelete(project) && (
            <Button
              variant="outline"
              onClick={async () => {
                if (!confirm(`Delete "${project.title}" and all its tasks? The deletion is recorded in the admin deletion log.`)) return;
                if (await run(() => repo.deleteProject(project.id).then(() => true), "Project deleted")) nav("/projects");
              }}
            >
              <Trash2 />Delete
            </Button>
          )
        }
      />

      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="people">People & links</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="handoffs">Handoffs</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks"><TasksTab project={project} canEdit={canEdit} onOpen={(t) => setTaskDialog({ task: t })} /></TabsContent>
        <TabsContent value="timeline">
          <Gantt tasks={data.tasks.filter((t) => t.projectId === project.id)} deps={data.dependencies} people={data.people} today={today} onSelect={(t) => setTaskDialog({ task: t })} />
        </TabsContent>
        <TabsContent value="details">
          <Card>
            <CardContent className="pt-4">
              <ProjectForm
                key={JSON.stringify(project)}
                initial={project}
                disabled={!canEdit}
                submitLabel="Save changes"
                onSubmit={(v) => run((reason) => repo.updateProject(project.id, v, reason), "Saved")}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="people"><PeopleTab project={project} canEdit={canEdit} /></TabsContent>
        <TabsContent value="relationships"><RelationshipsTab project={project} canEdit={canEdit} /></TabsContent>
        <TabsContent value="budget"><BudgetTab project={project} canEdit={canEdit} /></TabsContent>
        <TabsContent value="handoffs"><HandoffsTab project={project} canEdit={canEdit} /></TabsContent>
        <TabsContent value="history"><HistoryTab project={project} /></TabsContent>
      </Tabs>

      {taskDialog && (
        <TaskDialog
          key={taskDialog.task?.id ?? "new"}
          open
          onClose={() => setTaskDialog(null)}
          projectId={project.id}
          task={taskDialog.task}
          canEdit={canEdit}
        />
      )}
    </>
  );
}

function TasksTab({ project, canEdit, onOpen }: { project: Project; canEdit: boolean; onOpen: (t: Task | null) => void }) {
  const { data, today, run, repo, toast } = useStore();
  const tasks = topoOrder(data.tasks.filter((t) => t.projectId === project.id), data.dependencies);
  const blocked = blockedTaskIds(data.tasks, data.dependencies);
  const title = (id: ID) => data.tasks.find((t) => t.id === id)?.title ?? "";

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Listed in the order work has to happen. Click a task to see or change it.</p>
        {canEdit && <Button onClick={() => onOpen(null)}><Plus />Add task</Button>}
      </div>
      {tasks.length === 0 ? (
        <Empty>No tasks yet.</Empty>
      ) : (
        <Table>
          <THead>
            <TR><TH>Task</TH><TH className="hidden md:table-cell">Owner</TH><TH>Due</TH><TH className="hidden md:table-cell">Waits on</TH><TH>Status</TH><TH></TH></TR>
          </THead>
          <TBody>
            {tasks.map((t) => {
              const waits = data.dependencies.filter((d) => d.successorId === t.id).map((d) => title(d.predecessorId));
              return (
                <TR key={t.id} className="cursor-pointer" onClick={() => onOpen(t)}>
                  <TD className="max-w-xs">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-muted-foreground">{TASK_KIND_LABELS[t.kind]}{t.effortHours ? ` · ${t.effortHours} h` : ""}{t.estimatedCost ? ` · ${money(t.estimatedCost)}` : ""}</div>
                    <div className="text-xs text-muted-foreground md:hidden">
                      {personName(data, t.ownerId)}
                      {blocked.has(t.id) && <div className="mt-1"><BlockedBadge waitingOn={blockers(t, data.tasks, data.dependencies).map((b) => b.title)} /></div>}
                    </div>
                  </TD>
                  <TD className="hidden md:table-cell">{personName(data, t.ownerId)}</TD>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      <DateText date={t.dueDate} status={t.status} today={today} />
                      <DueFlag dueDate={t.dueDate} status={t.status} today={today} />
                    </div>
                  </TD>
                  <TD className="hidden max-w-[14rem] text-xs text-muted-foreground md:table-cell">
                    {blocked.has(t.id) && <div className="mb-1"><BlockedBadge waitingOn={blockers(t, data.tasks, data.dependencies).map((b) => b.title)} /></div>}
                    {waits.join(", ")}
                  </TD>
                  <TD><StatusBadge status={t.status} /></TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    {canEdit && t.status !== "done" && !blocked.has(t.id) && (
                      <Button size="sm" variant="ghost" onClick={() => run(async () => {
                        const { handedOff } = await repo.updateTask(t.id, { status: "done" });
                        toast(handedOff.length ? `Marked done. ${handoffMessage(handedOff, data)}` : "Marked done");
                      })}>
                        <CheckCircle2 />Done
                      </Button>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}

function PeopleTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { data, run, repo, me } = useStore();
  const canDelete = repo.canDelete(project);
  const [invitee, setInvitee] = useState<ID | null>(null);
  const [linkTo, setLinkTo] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const members = data.memberships.filter((m) => m.targetType === "project" && m.targetId === project.id);
  const events = data.tasks.filter((t) => t.projectId === project.id && t.kind === "event");
  const links = data.projectLinks.filter((l) => l.fromProjectId === project.id || l.toProjectId === project.id);
  const staff = data.people.filter((p) => p.role !== "viewer" && p.active);
  const mailto = (personId: ID, what: string) => {
    const p = data.people.find((x) => x.id === personId);
    if (!p) return "#";
    return `mailto:${p.email}?subject=${encodeURIComponent(`Invitation: ${what}`)}&body=${encodeURIComponent(`You have been invited to "${what}" in FSI Projects.\n\n${location.origin}${import.meta.env.BASE_URL}projects/${project.id}`)}`;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>FSI people on this project</CardTitle>
          <CardDescription>Owner: {personName(data, project.ownerId)}. Invited people see the invitation on their My work page.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {members.length === 0 && <p className="text-sm text-muted-foreground">No one else linked yet.</p>}
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>{personName(data, m.personId)} <Badge variant={m.status === "accepted" ? "success" : m.status === "invited" ? "info" : "muted"}>{MEMBERSHIP_LABELS[m.status]}</Badge></span>
                <span className="flex gap-1">
                  {m.status === "invited" && <Button size="sm" variant="ghost" asChild><a href={mailto(m.personId, project.title)}>Email</a></Button>}
                  {canDelete && <Button size="sm" variant="ghost" onClick={() => run(() => repo.removeMembership(m.id), "Removed")} aria-label="Remove"><Trash2 /></Button>}
                </span>
              </li>
            ))}
          </ul>
          {me && (
            <div className="flex gap-2">
              <PersonSelect people={staff.filter((p) => p.id !== project.ownerId && !members.some((m) => m.personId === p.id))} value={invitee} onChange={setInvitee} allowEmpty emptyLabel="Choose someone to invite" />
              <Button disabled={!invitee} onClick={async () => { await run(() => repo.invite("project", project.id, invitee!), "Invited"); setInvitee(null); }}><UserPlus />Invite</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>Invite people to this project's events (dinners, briefings, wargame days).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {events.length === 0 && <p className="text-sm text-muted-foreground">No events. Add a task with type "Event" on the Tasks tab.</p>}
          {events.map((ev) => <EventInvites key={ev.id} eventId={ev.id} canInvite={!!me} />)}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Linked projects</CardTitle>
          <CardDescription>Projects that feed into, or build on, this one.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {links.length === 0 && <p className="text-sm text-muted-foreground">No linked projects.</p>}
          <ul className="divide-y">
            {links.map((l) => {
              const otherId = l.fromProjectId === project.id ? l.toProjectId : l.fromProjectId;
              const other = data.projects.find((p) => p.id === otherId);
              return (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span><Link2 className="mr-1 inline h-4 w-4 text-muted-foreground" /><Link to={`/projects/${otherId}`} className="font-medium hover:underline">{other?.title ?? "Deleted project"}</Link>{l.note && <span className="text-muted-foreground"> · {l.note}</span>}</span>
                  {(canDelete || (other && repo.canDelete(other))) && <Button size="sm" variant="ghost" onClick={() => run(() => repo.unlinkProjects(l.id), "Unlinked")} aria-label="Unlink"><Trash2 /></Button>}
                </li>
              );
            })}
          </ul>
          {canEdit && (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Select value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
                <option value="">Choose a project to link</option>
                {data.projects.filter((p) => p.id !== project.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </Select>
              <Input placeholder="How they connect (optional)" value={linkNote} onChange={(e) => setLinkNote(e.target.value)} />
              <Button disabled={!linkTo} onClick={async () => { if (await run(() => repo.linkProjects(project.id, linkTo, linkNote.trim()).then(() => true), "Linked")) { setLinkTo(""); setLinkNote(""); } }}>Link</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EventInvites({ eventId, canInvite }: { eventId: ID; canInvite: boolean }) {
  const { data, run, repo } = useStore();
  const [who, setWho] = useState<ID | null>(null);
  const ev = data.tasks.find((t) => t.id === eventId)!;
  const ms = data.memberships.filter((m) => m.targetType === "task" && m.targetId === eventId);
  return (
    <div className="rounded-md border p-3">
      <div className="font-medium">{ev.title}</div>
      <div className="text-xs text-muted-foreground">{formatDate(ev.startDate ?? ev.dueDate)} · Lead: {personName(data, ev.ownerId)}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ms.map((m) => <Badge key={m.id} variant={m.status === "accepted" ? "success" : m.status === "invited" ? "info" : "muted"}>{personName(data, m.personId)} · {MEMBERSHIP_LABELS[m.status]}</Badge>)}
      </div>
      {canInvite && (
        <div className="mt-2 flex gap-2">
          <PersonSelect people={data.people.filter((p) => p.role !== "viewer" && p.active && !ms.some((m) => m.personId === p.id))} value={who} onChange={setWho} allowEmpty emptyLabel="Invite someone" />
          <Button size="sm" disabled={!who} onClick={async () => { await run(() => repo.invite("task", eventId, who!), "Invited"); setWho(null); }}>Invite</Button>
        </div>
      )}
    </div>
  );
}

function RelationshipsTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { data, run, repo, tracker, removedInvolvement, toast } = useStore();
  const canDelete = repo.canDelete(project);
  const [adding, setAdding] = useState(false);
  const links = data.relationshipLinks.filter((r) => r.projectId === project.id);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">External contacts and organizations from the {tracker.name}.</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              run(async () => {
                const r = await syncRelationships(tracker, repo.data, (id, patch) => repo.updateRelationshipLink(id, patch), removedInvolvement.splice(0));
                toast(`Synced. ${r.updated} updated, ${r.pushed} sent to the tracker.${r.missing.length ? ` Not found in tracker: ${r.missing.join(", ")}.` : ""}`);
              })
            }
          >
            <RefreshCw />Sync with tracker
          </Button>
          {canEdit && <Button onClick={() => setAdding(true)}><Plus />Link a contact</Button>}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {RELATIONSHIP_GROUPS.map((g) => {
          const list = links.filter((l) => l.group === g);
          return (
            <Card key={g}>
              <CardHeader><CardTitle>{RELATIONSHIP_GROUP_LABELS[g]}</CardTitle></CardHeader>
              <CardContent>
                {list.length === 0 ? <p className="text-sm text-muted-foreground">None linked.</p> : (
                  <ul className="divide-y">
                    {list.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                        <div>
                          <div className="font-medium">{l.name}</div>
                          <div className="text-xs text-muted-foreground">{l.kind === "contact" ? l.organization : "Organization"}{l.note && ` · ${l.note}`}</div>
                        </div>
                        {canDelete && (
                          <Button size="sm" variant="ghost" aria-label="Unlink" onClick={() => run(async () => {
                            const gone = involvementFor(repo.data, [l]).map((i) => ({ ...i, active: false }));
                            await repo.unlinkRelationship(l.id);
                            const sent = await pushNow(tracker, gone, removedInvolvement);
                            toast(sent ? "Unlinked here and in the tracker" : "Unlinked. The tracker will be updated at the next sync.");
                          })}><Trash2 /></Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {adding && <LinkContactDialog projectId={project.id} onClose={() => setAdding(false)} />}
    </div>
  );
}

function LinkContactDialog({ projectId, onClose }: { projectId: ID; onClose: () => void }) {
  const { tracker, run, repo, data, removedInvolvement, toast } = useStore();
  const [contacts, setContacts] = useState<ExternalContact[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<ExternalOrganization[]>([]);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<{ externalId: string; kind: "contact" | "organization"; name: string; organization: string; type: string } | null>(null);
  const [group, setGroup] = useState<RelationshipGroup | "">("");
  const [note, setNote] = useState("");

  useEffect(() => {
    Promise.all([tracker.listContacts(), tracker.listOrganizations()]).then(
      ([c, o]) => (setContacts(c), setOrgs(o)),
      (e: Error) => setLoadError(e.message),
    );
  }, [tracker]);

  const linked = new Set(data.relationshipLinks.filter((r) => r.projectId === projectId).map((r) => r.externalId));
  const options = useMemo(() => {
    const all = [
      ...(contacts ?? []).map((c) => ({ externalId: c.externalId, kind: "contact" as const, name: c.name, organization: c.organization, type: c.relationshipType })),
      ...orgs.map((o) => ({ externalId: o.externalId, kind: "organization" as const, name: o.name, organization: o.name, type: o.relationshipType })),
    ];
    const s = q.toLowerCase();
    return all.filter((x) => !linked.has(x.externalId) && (!s || `${x.name} ${x.organization} ${x.type}`.toLowerCase().includes(s)));
  }, [contacts, orgs, q, linked]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Link a contact or organization</DialogTitle></DialogHeader>
        {!pick ? (
          <div className="grid gap-3">
            <Input autoFocus placeholder="Search by name, organization, or type" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-80 overflow-y-auto rounded-md border">
              {loadError ? <p className="p-3 text-sm text-red-700">{loadError}</p> : contacts === null ? <p className="p-3 text-sm text-muted-foreground">Loading from the tracker...</p> : options.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No matches.</p> : (
                <ul className="divide-y">
                  {options.map((o) => (
                    <li key={o.externalId}>
                      <button className="w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setPick(o); setGroup(groupForType(o.type) ?? ""); }}>
                        <div className="font-medium">{o.name}{o.kind === "organization" && <Badge variant="muted" className="ml-2">Organization</Badge>}</div>
                        <div className="text-xs text-muted-foreground">{o.kind === "contact" ? `${o.organization} · ` : ""}{o.type}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!group) return;
              const link = await run(() => repo.linkRelationship({ projectId, externalId: pick.externalId, kind: pick.kind, name: pick.name, organization: pick.organization, group, note: note.trim() }));
              if (!link) return;
              onClose();
              const sent = await pushNow(tracker, involvementFor(repo.data, [link]), removedInvolvement);
              toast(sent ? "Linked here and in the tracker" : "Linked. The tracker will be updated at the next sync.");
            }}
          >
            <p className="text-sm"><span className="font-medium">{pick.name}</span> <span className="text-muted-foreground">({pick.type})</span></p>
            <Field label="Group">
              <Select value={group} onChange={(e) => setGroup(e.target.value as RelationshipGroup)} required>
                <option value="">Choose a group</option>
                {RELATIONSHIP_GROUPS.map((g) => <option key={g} value={g}>{RELATIONSHIP_GROUP_LABELS[g]}</option>)}
              </Select>
            </Field>
            <Field label="Their role on this project (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: external reviewer" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPick(null)}>Back</Button>
              <Button type="submit" disabled={!group}>Link</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BudgetTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { data, run, repo } = useStore();
  const [planned, setPlanned] = useState(project.plannedBudget);
  const [actual, setActual] = useState(project.actualSpend);
  const [why, setWhy] = useState("");
  useEffect(() => (setPlanned(project.plannedBudget), setActual(project.actualSpend)), [project.plannedBudget, project.actualSpend]);
  const committed = data.tasks.filter((t) => t.projectId === project.id && t.status !== "done").reduce((s, t) => s + t.estimatedCost, 0);
  const log = data.budgetChanges.filter((b) => b.projectId === project.id).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const remaining = project.plannedBudget - project.actualSpend - committed;
  const changed = planned !== project.plannedBudget || actual !== project.actualSpend;

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Planned" value={money(project.plannedBudget)} />
        <Stat label="Spent" value={money(project.actualSpend)} />
        <Stat label="Committed (open tasks)" value={money(committed)} />
        <Stat label="Left" value={money(remaining)} tone={remaining < 0 ? "danger" : remaining < project.plannedBudget * 0.1 ? "warning" : undefined} />
      </div>
      {canEdit && (
        <Card>
          <CardHeader><CardTitle>Update budget or spend</CardTitle><CardDescription>Every change is logged with your note.</CardDescription></CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run(() => repo.updateProject(project.id, { plannedBudget: planned, actualSpend: actual }, why).then(() => true), "Budget updated")) setWhy("");
              }}
            >
              <Field label="Planned ($)"><Input type="number" min={0} value={planned} onChange={(e) => setPlanned(Number(e.target.value))} /></Field>
              <Field label="Spent ($)"><Input type="number" min={0} value={actual} onChange={(e) => setActual(Number(e.target.value))} /></Field>
              <Field label="What changed and why"><Input value={why} onChange={(e) => setWhy(e.target.value)} required placeholder="For example: catering deposit paid" /></Field>
              <Button type="submit" disabled={!changed || !why.trim()}>Save</Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Change log</CardTitle></CardHeader>
        <CardContent>
          {log.length === 0 ? <p className="text-sm text-muted-foreground">No budget changes yet.</p> : (
            <Table>
              <THead><TR><TH>When</TH><TH>What</TH><TH>From</TH><TH>To</TH><TH>Why</TH><TH>By</TH></TR></THead>
              <TBody>
                {log.map((b) => (
                  <TR key={b.id}>
                    <TD className="whitespace-nowrap">{formatDate(b.changedAt.slice(0, 10))}</TD>
                    <TD>{b.field === "planned" ? "Planned budget" : "Actual spend"}</TD>
                    <TD>{money(b.oldValue)}</TD>
                    <TD>{money(b.newValue)}</TD>
                    <TD>{b.reason || <span className="text-muted-foreground">No note</span>}</TD>
                    <TD className="text-xs">{personName(data, b.changedById)}<div className="text-muted-foreground">{b.changedByEmail}</div></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HandoffsTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { data, run, repo, today } = useStore();
  const canDelete = repo.canDelete(project);
  const stages = stagesFor(project.id, data.stages);
  const [editing, setEditing] = useState<Stage | null>(null);
  const [completing, setCompleting] = useState<ID | null>(null);
  const [note, setNote] = useState("");
  const nextAfter = (id: ID) => stages.slice(stages.findIndex((s) => s.id === id) + 1).find((s) => s.status === "pending");
  const task = (id: ID | null) => (id ? data.tasks.find((t) => t.id === id) ?? null : null);

  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground">
        Stages say who owns the project at each point. When the current stage is complete, the project passes to the next stage's owner and department.
        Give a stage a handoff milestone and the handoff happens on its own when that task is marked done.
        Example: Research complete, then Comms takes over for rollout.
      </p>
      {stages.length === 0 ? <Empty>No stages yet. The project stays with its owner.</Empty> : (
        <ol className="flex flex-col gap-2 md:flex-row md:items-stretch">
          {stages.map((s, i) => {
            const trigger = task(s.handoffTaskId);
            const late = s.status !== "complete" && !!s.handoffDate && s.handoffDate < today;
            return (
              <li key={s.id} className="flex items-center gap-2 md:flex-1">
                <div className={`flex-1 rounded-lg border p-3 ${s.status === "active" ? "border-primary bg-accent" : s.status === "complete" ? "bg-muted/50" : "bg-card"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{s.order}. {s.name}</span>
                    <Badge variant={s.status === "active" ? "info" : s.status === "complete" ? "success" : "muted"}>{s.status === "active" ? "Current" : s.status === "complete" ? "Complete" : "Next"}</Badge>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{personName(data, s.ownerId)} · {deptName(data, s.departmentId)}</div>
                  {(s.handoffDate || trigger) && (
                    <div className="mt-2 grid gap-0.5 text-xs">
                      {s.handoffDate && (
                        <div className={late ? "font-medium text-red-700" : ""}>Handoff date: {formatDate(s.handoffDate)}{late ? " (past due)" : ""}</div>
                      )}
                      {trigger && (
                        <div>
                          Handoff milestone: <span className="font-medium">{trigger.title}</span>
                          {trigger.projectId !== project.id && <> in <Link to={`/projects/${trigger.projectId}`} className="hover:underline">{data.projects.find((p) => p.id === trigger.projectId)?.title}</Link></>}
                          {trigger.status === "done" ? " (done)" : s.status !== "complete" ? " (hands off when done)" : ""}
                        </div>
                      )}
                    </div>
                  )}
                  {s.handoffNote && <div className="mt-1 whitespace-pre-line text-xs">{s.handoffNote}</div>}
                  {s.completedAt && <div className="mt-1 text-xs text-muted-foreground">Completed {formatDate(s.completedAt.slice(0, 10))}</div>}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {canEdit && s.status === "active" && (
                      <Button size="sm" onClick={() => { setCompleting(s.id); setNote(""); }}>
                        <CheckCircle2 />Complete{nextAfter(s.id) ? " and hand off" : ""}
                      </Button>
                    )}
                    {canEdit && s.status !== "complete" && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}><Pencil />Edit</Button>
                    )}
                    {canDelete && s.status === "pending" && (
                      <Button size="sm" variant="ghost" onClick={() => run(() => repo.removeStage(s.id), "Stage removed")}><Trash2 />Remove</Button>
                    )}
                  </div>
                </div>
                {i < stages.length - 1 && <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground md:block" />}
              </li>
            );
          })}
        </ol>
      )}
      {canEdit && (
        <Card>
          <CardHeader><CardTitle>Add a stage</CardTitle></CardHeader>
          <CardContent>
            <StageForm project={project} stage={null} onDone={() => {}} />
          </CardContent>
        </Card>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Edit stage</DialogTitle></DialogHeader>
          {editing && <StageForm key={editing.id} project={project} stage={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!completing} onOpenChange={(o) => !o && setCompleting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Complete this stage?</DialogTitle></DialogHeader>
          {completing && (() => {
            const next = nextAfter(completing);
            return (
              <form className="grid gap-3" onSubmit={async (e) => {
                e.preventDefault();
                if (await run(() => repo.completeStage(project.id, completing, note), next ? `Handed to ${personName(data, next.ownerId)}` : "Project complete")) setCompleting(null);
              }}>
                <p className="text-sm">
                  {next
                    ? <>The project moves to <strong>{personName(data, next.ownerId)}</strong> ({deptName(data, next.departmentId)}) for <strong>{next.name}</strong>.</>
                    : "This is the last stage. The project will be marked done."}
                </p>
                <Field label="Handoff note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the next owner needs to know" /></Field>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCompleting(null)}>Cancel</Button>
                  <Button type="submit">{next ? "Complete and hand off" : "Complete"}</Button>
                </DialogFooter>
              </form>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Adds or edits a stage. "Handoff milestone" lists existing tasks grouped by project (this
 * project first); when the chosen task is marked done, the handoff happens on its own.
 */
function StageForm({ project, stage, onDone }: { project: Project; stage: Stage | null; onDone: () => void }) {
  const { data, run, repo } = useStore();
  const staff = data.people.filter((p) => p.role !== "viewer");
  const [name, setName] = useState(stage?.name ?? "");
  const [owner, setOwner] = useState<ID | null>(stage?.ownerId ?? null);
  const [dept, setDept] = useState<ID | null>(stage?.departmentId ?? null);
  const [date, setDate] = useState(stage?.handoffDate ?? "");
  const [taskId, setTaskId] = useState<ID>(stage?.handoffTaskId ?? "");
  const chosen = data.tasks.find((t) => t.id === taskId);
  // This project first, then other unfinished projects by name. Keep the current choice even
  // if its project has finished.
  const groups = data.projects
    .filter((p) => p.id === project.id || p.status !== "done" || p.id === chosen?.projectId)
    .sort((a, b) => (a.id === project.id ? -1 : b.id === project.id ? 1 : a.title.localeCompare(b.title)))
    .map((p) => ({ project: p, tasks: topoOrder(data.tasks.filter((t) => t.projectId === p.id), data.dependencies) }))
    .filter((g) => g.tasks.length);

  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(async () => {
          const fields = { name, ownerId: owner!, departmentId: dept!, handoffDate: date || null, handoffTaskId: taskId || null };
          if (stage) await repo.updateStage(stage.id, fields);
          else await repo.addStage(project.id, fields);
          return true;
        }, stage ? "Stage saved" : "Stage added");
        if (ok) {
          if (!stage) { setName(""); setOwner(null); setDept(null); setDate(""); setTaskId(""); }
          onDone();
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Stage"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Comms rollout" required /></Field>
        <Field label="Owner during this stage"><PersonSelect people={staff} value={owner} onChange={(id) => { setOwner(id); const p = staff.find((x) => x.id === id); if (p?.departmentId && !dept) setDept(p.departmentId); }} /></Field>
        <Field label="Department"><DepartmentSelect departments={data.departments} value={dept} onChange={setDept} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Handoff date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field
          label="Handoff milestone"
          hint={!chosen
            ? "Optional. Choose a task, in this project or another one. When it is marked done, the project hands off on its own."
            : chosen.status === "done"
              ? `"${chosen.title}" is already done${stage?.status === "active" ? ", so saving hands the project off now" : ""}.`
              : `When "${chosen.title}" is marked done, the project hands off on its own.`}
        >
          <Select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">None: hand off by hand</option>
            {groups.map((g) => (
              <optgroup key={g.project.id} label={g.project.id === project.id ? `${g.project.title} (this project)` : g.project.title}>
                {g.tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}{t.kind !== "task" ? ` (${TASK_KIND_LABELS[t.kind].toLowerCase()})` : ""}{t.dueDate ? `, due ${formatDate(t.dueDate)}` : ""}{t.status === "done" ? ", done" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={!name.trim() || !owner || !dept}>{stage ? "Save" : "Add"}</Button>
        {stage && <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>}
      </div>
    </form>
  );
}

function HistoryTab({ project }: { project: Project }) {
  const { data } = useStore();
  const [datesOnly, setDatesOnly] = useState(false);
  const taskTitle = (id: ID) => data.tasks.find((t) => t.id === id)?.title;
  const entries = data.audit
    .filter((a) => a.projectId === project.id)
    .filter((a) => !datesOnly || a.field === "startDate" || a.field === "dueDate")
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt));

  const show = (field: string, v: string) => {
    if (!v) return <span className="text-muted-foreground">(empty)</span>;
    if (field === "ownerId") return personName(data, v);
    if (field === "departmentId") return deptName(data, v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
    return v.length > 80 ? `${v.slice(0, 80)}...` : v;
  };

  return (
    <div className="grid gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={datesOnly} onChange={(e) => setDatesOnly(e.target.checked)} /> Date changes only
      </label>
      {entries.length === 0 ? <Empty>No changes recorded.</Empty> : (
        <Table>
          <THead><TR><TH>When</TH><TH>Item</TH><TH>Change</TH><TH>Reason</TH><TH>By</TH></TR></THead>
          <TBody>
            {entries.map((a) => (
              <TR key={a.id}>
                <TD className="whitespace-nowrap text-xs">{formatDate(a.changedAt.slice(0, 10))}<div className="text-muted-foreground">{new Date(a.changedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div></TD>
                <TD className="text-sm">{a.entityType === "project" ? "Project" : a.entityType === "task" ? (taskTitle(a.entityId) ?? "Deleted task") : a.entityType}</TD>
                <TD className="text-sm">
                  {["created", "deleted", "added", "removed", "invited", "joined", "completed"].includes(a.field)
                    ? <span className="capitalize">{a.field} {a.oldValue || a.newValue}</span>
                    : <><span className="font-medium">{fieldLabel(a.field)}:</span> {show(a.field, a.oldValue)} → {show(a.field, a.newValue)}</>}
                </TD>
                <TD className="max-w-xs text-sm">{a.reason || <span className="text-muted-foreground">None</span>}</TD>
                <TD className="text-xs">{personName(data, a.changedById)}<div className="text-muted-foreground" title="Change ID">{a.changedByEmail} · #{a.id}</div></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
