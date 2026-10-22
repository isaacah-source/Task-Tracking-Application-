import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Maximize, MonitorPlay, Printer } from "lucide-react";
import { useStore } from "@/data/store";
import type { ID, TaskKind } from "@/domain/types";
import { TASK_KIND_LABELS } from "@/domain/types";
import {
  GROUP_LABELS, PRESETS, SCOPE_LABELS, STATUS_CHOICES, WINDOW_LABELS, buildDisplay, defaultDisplayOptions, optionsFromQuery, optionsToQuery,
  type DisplayGroup, type DisplayOptions, type DisplayScope, type DisplayStatus, type DisplayWindow,
} from "@/domain/display";
import { blockedTaskIds, blockers } from "@/domain/dependencies";
import { formatDate } from "@/domain/dates";
import { BlockedBadge, DateText, DepartmentSelect, DueFlag, Empty, Field, PageHeader, Stat, StatusBadge, personName } from "@/components/common";
import { Gantt } from "@/components/Gantt";
import { TeamsTranscribeButton } from "@/components/TeamsTranscribe";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Set up what a meeting should see (which projects or people, open or done work, a time
 * window, how to group it), then show it full screen with timelines and task lists. The
 * set-up lives in the page address, so a display can be bookmarked and reopened.
 */
export default function MeetingDisplayPage() {
  const [params, setParams] = useSearchParams();
  const o = useMemo(() => optionsFromQuery(params.toString()), [params]);
  const presenting = params.get("view") === "1";

  const update = (patch: Partial<DisplayOptions>, view = presenting) => {
    const q = optionsToQuery({ ...o, ...patch });
    setParams(view ? `${q}${q ? "&" : ""}view=1` : q, { replace: !view });
  };

  return presenting
    ? <Presentation o={o} onBack={() => update({}, false)} onMeeting={(id) => update({ meetingId: id })} />
    : <Setup o={o} update={update} />;
}

function Setup({ o, update }: { o: DisplayOptions; update: (p: Partial<DisplayOptions>, view?: boolean) => void }) {
  const { data, today } = useStore();
  const result = useMemo(() => buildDisplay(data, o, today), [data, o, today]);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const ready = (o.scope !== "department" || !!o.departmentId) && (o.scope !== "projects" || o.projectIds.length > 0) && (o.scope !== "people" || o.personIds.length > 0);

  return (
    <>
      <PageHeader
        title="Meeting display"
        description="Choose what the meeting should see, then show it on the screen. Your choices stay in the page address, so you can bookmark a display."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => update({ ...defaultDisplayOptions(), title: o.title, departmentId: o.departmentId, meetingId: o.meetingId, ...p.options })}
            className="rounded-lg border bg-card px-3 py-2 text-left hover:bg-accent"
          >
            <div className="text-sm font-medium">{p.label}</div>
            <div className="max-w-xs text-xs text-muted-foreground">{p.description}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardContent className="grid gap-5 pt-5">
            <Field label="Meeting name (shown at the top)">
              <Input value={o.title} placeholder="For example: Research weekly" onChange={(e) => update({ title: e.target.value })} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Whose work">
                <Select value={o.scope} onChange={(e) => update({ scope: e.target.value as DisplayScope })}>
                  {Object.entries(SCOPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              {o.scope === "department" && (
                <Field label="Department" hint="Sub-departments are included.">
                  <DepartmentSelect departments={data.departments} value={o.departmentId} onChange={(id) => update({ departmentId: id })} />
                </Field>
              )}
            </div>

            {o.scope === "projects" && (
              <Chooser
                label="Projects"
                items={data.projects.map((p) => ({ id: p.id, label: p.title, muted: p.status === "done" }))}
                chosen={o.projectIds}
                onToggle={(id) => update({ projectIds: toggle(o.projectIds, id) })}
              />
            )}
            {o.scope === "people" && (
              <Chooser
                label="People"
                items={data.people.filter((p) => p.active && p.role !== "viewer").map((p) => ({ id: p.id, label: p.name }))}
                chosen={o.personIds}
                onToggle={(id) => update({ personIds: toggle(o.personIds, id) })}
              />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Which tasks">
                <Select value={o.status} onChange={(e) => update({ status: e.target.value as DisplayStatus })}>
                  {Object.entries(STATUS_CHOICES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-sm font-medium">Include</legend>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(TASK_KIND_LABELS) as TaskKind[]).map((k) => (
                    <Chip key={k} on={o.kinds.includes(k)} onClick={() => o.kinds.length > 1 || !o.kinds.includes(k) ? update({ kinds: toggle(o.kinds, k) }) : undefined}>
                      {TASK_KIND_LABELS[k]}s
                    </Chip>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="When">
                <Select value={o.window} onChange={(e) => update({ window: e.target.value as DisplayWindow })}>
                  {Object.entries(WINDOW_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              {o.window === "custom" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="From"><Input type="date" value={o.from ?? ""} onChange={(e) => update({ from: e.target.value || null })} /></Field>
                  <Field label="To"><Input type="date" value={o.to ?? ""} onChange={(e) => update({ to: e.target.value || null })} /></Field>
                </div>
              )}
            </div>
            {o.window !== "any" && o.window !== "overdue" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={o.includeUndated} onChange={(e) => update({ includeUndated: e.target.checked })} />
                Also show tasks that have no dates yet
              </label>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Group">
                <Select value={o.groupBy} onChange={(e) => update({ groupBy: e.target.value as DisplayGroup })}>
                  {Object.entries(GROUP_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-sm font-medium">Show</legend>
                <div className="flex flex-wrap gap-2">
                  <Chip on={o.showSummary} onClick={() => update({ showSummary: !o.showSummary })}>Summary</Chip>
                  <Chip on={o.showGantt} onClick={() => update({ showGantt: !o.showGantt })}>Timeline (Gantt)</Chip>
                  <Chip on={o.showTable} onClick={() => update({ showTable: !o.showTable })}>Task list</Chip>
                </div>
              </fieldset>
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader><CardTitle>Preview</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p className="text-muted-foreground">{result.description}</p>
            <p>
              <span className="text-2xl font-semibold">{result.stats.total}</span> task{result.stats.total === 1 ? "" : "s"} in{" "}
              {new Set(result.tasks.map((t) => t.projectId)).size} project{new Set(result.tasks.map((t) => t.projectId)).size === 1 ? "" : "s"},{" "}
              {result.groups.length} group{result.groups.length === 1 ? "" : "s"}
            </p>
            {!ready && <p className="text-amber-800">Choose {o.scope === "department" ? "a department" : o.scope === "projects" ? "at least one project" : "at least one person"} first.</p>}
            <Button size="lg" disabled={!ready} onClick={() => update({}, true)}><MonitorPlay />Show display</Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Presentation({ o, onBack, onMeeting }: { o: DisplayOptions; onBack: () => void; onMeeting: (id: ID) => void }) {
  const { data, today } = useStore();
  const nav = useNavigate();
  const r = useMemo(() => buildDisplay(data, o, today), [data, o, today]);
  const blocked = useMemo(() => blockedTaskIds(data.tasks, data.dependencies), [data]);
  const project = (id: ID) => data.projects.find((p) => p.id === id);

  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-background print:static print:overflow-visible">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b bg-card/95 px-6 py-3 backdrop-blur print:hidden">
        <Button variant="outline" onClick={onBack}><ArrowLeft />Change what's shown</Button>
        <div className="flex flex-wrap gap-2">
          <TeamsTranscribeButton title={o.title} note={data.meetings.find((m) => m.id === o.meetingId) ?? null} onLinked={onMeeting} />
          <Button variant="outline" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}><Maximize />Full screen</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer />Print</Button>
        </div>
      </div>

      <div className="mx-auto min-w-0 max-w-[1600px] px-6 py-6 md:px-10">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">{o.title || "Meeting display"}</h1>
          <p className="mt-1 text-base text-muted-foreground">{formatDate(today)} · {r.description}</p>
        </header>

        {o.showSummary && (
          <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-6">
            <Stat label="Tasks" value={r.stats.total} />
            <Stat label="Open" value={r.stats.open} />
            <Stat label="Done" value={r.stats.done} />
            <Stat label="Overdue" value={r.stats.overdue} tone={r.stats.overdue ? "danger" : undefined} />
            <Stat label="Due this week" value={r.stats.dueSoon} tone={r.stats.dueSoon ? "warning" : undefined} />
            <Stat label="Blocked" value={r.stats.blocked} />
          </div>
        )}

        {r.groups.length === 0 && <Empty>Nothing matches these choices. Go back and widen them.</Empty>}

        <div className="grid min-w-0 gap-10">
          {r.groups.map((g) => {
            const open = g.tasks.filter((t) => t.status !== "done").length;
            return (
              <section key={g.key} className="min-w-0 break-inside-avoid">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
                  <h2 className="text-2xl font-semibold">
                    {o.groupBy === "project" ? <Link to={`/projects/${g.key}`} className="hover:underline">{g.label}</Link> : g.label}
                  </h2>
                  <span className="text-sm text-muted-foreground">{g.tasks.length} task{g.tasks.length === 1 ? "" : "s"} · {open} open</span>
                </div>
                {o.showGantt && (
                  <div className="mb-4">
                    <Gantt
                      tasks={g.tasks}
                      deps={data.dependencies}
                      people={data.people}
                      today={today}
                      onSelect={(t) => nav(`/projects/${t.projectId}?task=${t.id}`)}
                    />
                  </div>
                )}
                {o.showTable && (
                  <Table className="text-base">
                    <THead>
                      <TR>
                        <TH>Task</TH>
                        {o.groupBy !== "project" && <TH>Project</TH>}
                        {o.groupBy !== "person" && <TH>Owner</TH>}
                        <TH>Start</TH>
                        <TH>Due</TH>
                        <TH>Status</TH>
                        <TH>Flags</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {g.tasks.map((t) => (
                        <TR key={t.id} className={cn(t.status === "done" && "text-muted-foreground")}>
                          <TD className="font-medium">
                            <Link to={`/projects/${t.projectId}?task=${t.id}`} className="hover:underline">{t.title}</Link>
                            {t.kind !== "task" && <span className="ml-2 text-xs text-muted-foreground">{TASK_KIND_LABELS[t.kind]}</span>}
                          </TD>
                          {o.groupBy !== "project" && <TD>{project(t.projectId)?.title}</TD>}
                          {o.groupBy !== "person" && <TD className="whitespace-nowrap">{personName(data, t.ownerId)}</TD>}
                          <TD className="whitespace-nowrap">{t.startDate ? formatDate(t.startDate) : ""}</TD>
                          <TD className="whitespace-nowrap"><DateText date={t.dueDate} status={t.status} today={today} /></TD>
                          <TD><StatusBadge status={t.status} /></TD>
                          <TD>
                            <div className="flex flex-wrap gap-1">
                              <DueFlag dueDate={t.dueDate} status={t.status} today={today} />
                              {blocked.has(t.id) && <BlockedBadge waitingOn={blockers(t, data.tasks, data.dependencies).map((b) => b.title)} />}
                            </div>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}
    >
      {children}
    </button>
  );
}

function Chooser({ label, items, chosen, onToggle }: { label: string; items: { id: ID; label: string; muted?: boolean }[]; chosen: ID[]; onToggle: (id: ID) => void }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{label} <span className="font-normal text-muted-foreground">({chosen.length} chosen)</span></legend>
      <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
        {items.map((i) => (
          <Chip key={i.id} on={chosen.includes(i.id)} onClick={() => onToggle(i.id)}>
            <span className={cn(i.muted && !chosen.includes(i.id) && "text-muted-foreground")}>{i.label}</span>
          </Chip>
        ))}
      </div>
    </fieldset>
  );
}
