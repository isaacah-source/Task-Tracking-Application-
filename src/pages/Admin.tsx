import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useStore } from "@/data/store";
import type { DeletionEntry, Department, ID, OutputType, Person, Role } from "@/domain/types";
import { formatDate } from "@/domain/dates";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/domain/types";
import { isAdmin, roleLabel } from "@/domain/permissions";
import { SCHEMA, TABLES } from "@/data/schema";
import { syncRelationships, type SyncResult } from "@/integrations/relationships/sync";
import { getAIProvider } from "@/integrations/ai/provider";
import { DepartmentSelect, Empty, Field, PageHeader, PersonSelect, deptName, departmentOptions, personName } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function AdminPage() {
  const { me } = useStore();
  if (!isAdmin(me)) return <Empty>Only admins can open this page.</Empty>;
  return (
    <>
      <PageHeader title="Admin" description="People and roles, departments, output types, and connections." />
      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">People and roles</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="outputs">Output types</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="deletions">Deletion log</TabsTrigger>
        </TabsList>
        <TabsContent value="people"><PeopleAdmin /></TabsContent>
        <TabsContent value="departments"><DepartmentsAdmin /></TabsContent>
        <TabsContent value="outputs"><OutputTypesAdmin /></TabsContent>
        <TabsContent value="connections"><ConnectionsAdmin /></TabsContent>
        <TabsContent value="deletions"><DeletionLog /></TabsContent>
      </Tabs>
    </>
  );
}

function PeopleAdmin() {
  const { data } = useStore();
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ul className="grid gap-1 text-sm text-muted-foreground">
          {ROLES.map((r) => <li key={r}><span className="font-medium text-foreground">{ROLE_LABELS[r]}:</span> {ROLE_DESCRIPTIONS[r]}</li>)}
          <li><span className="font-medium text-foreground">Department owners</span> (set on the Departments tab) are the senior person in a department and can edit every project in it. Deleting is for admins and Department Task Leads.</li>
        </ul>
        <Button onClick={() => setEditing("new")}><Plus />Add person</Button>
      </div>
      <Table>
        <THead><TR><TH>Name</TH><TH>Microsoft email</TH><TH>Role</TH><TH>Department</TH><TH>Reports to</TH><TH className="text-right">Hours/week</TH><TH></TH></TR></THead>
        <TBody>
          {[...data.people].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)).map((p) => (
            <TR key={p.id} className={p.active ? "" : "opacity-60"}>
              <TD className="font-medium">{p.name}{!p.active && <Badge variant="muted" className="ml-2">Inactive</Badge>}</TD>
              <TD>{p.email}</TD>
              <TD>{roleLabel(p, data.departments)}</TD>
              <TD>{deptName(data, p.departmentId)}</TD>
              <TD>{p.managerId ? personName(data, p.managerId) : <span className="text-muted-foreground">Not set</span>}</TD>
              <TD className="text-right">{p.weeklyCapacityHours}</TD>
              <TD><Button size="sm" variant="ghost" onClick={() => setEditing(p)}><Pencil />Edit</Button></TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {editing && <PersonDialog person={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PersonDialog({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const { data, run, repo } = useStore();
  const [v, setV] = useState<Omit<Person, "id">>(
    person ?? { name: "", email: "", role: "staff", departmentId: null, weeklyCapacityHours: 32, active: true, managerId: null, leadDepartmentIds: [] },
  );
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{person ? `Edit ${person.name}` : "Add a person"}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => repo.savePerson(v, person?.id), "Saved")) onClose();
        }}>
          <Field label="Name"><Input value={v.name} onChange={(e) => set("name", e.target.value)} required autoFocus /></Field>
          <Field label="Microsoft 365 email" hint="The address they sign in with."><Input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} required /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role">
              <Select value={v.role} onChange={(e) => set("role", e.target.value as Role)}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </Select>
            </Field>
            <Field label="Department"><DepartmentSelect departments={data.departments} value={v.departmentId} onChange={(id) => set("departmentId", id)} allowEmpty emptyLabel="None" /></Field>
          </div>
          {v.role === "deptLead" && (
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-sm font-medium">Keeps data for</legend>
              <div className="flex flex-wrap gap-2">
                {departmentOptions(data.departments).map((d) => {
                  const on = v.leadDepartmentIds.includes(d.id);
                  return (
                    <button type="button" key={d.id} aria-pressed={on}
                      onClick={() => set("leadDepartmentIds", on ? v.leadDepartmentIds.filter((x) => x !== d.id) : [...v.leadDepartmentIds, d.id])}
                      className={`rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}>
                      {d.depth ? "› " : ""}{d.label}
                    </button>
                  );
                })}
              </div>
              <span className="text-xs text-muted-foreground">Sub-departments are included. The lead can add, edit, and delete there.</span>
            </fieldset>
          )}
          <Field label="Reports to" hint="Draws the org chart. Leave blank to show them under their department's owner.">
            <PersonSelect people={data.people.filter((p) => p.id !== person?.id && p.role !== "viewer")} value={v.managerId} onChange={(id) => set("managerId", id)} allowEmpty emptyLabel="Not set" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Hours per week for project work"><Input type="number" min={0} max={80} value={v.weeklyCapacityHours} onChange={(e) => set("weeklyCapacityHours", Number(e.target.value))} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => set("active", e.target.checked)} /> Active</label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentsAdmin() {
  const { data, run, repo } = useStore();
  const [editing, setEditing] = useState<Department | "new" | null>(null);
  const tree = departmentOptions(data.departments);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Every project belongs to one department. Add sub-departments under any department.</p>
        <Button onClick={() => setEditing("new")}><Plus />Add department</Button>
      </div>
      <Table>
        <THead><TR><TH>Department</TH><TH>Owner</TH><TH className="text-right">Projects</TH><TH></TH></TR></THead>
        <TBody>
          {tree.map(({ id, depth }) => {
            const d = data.departments.find((x) => x.id === id)!;
            return (
              <TR key={id}>
                <TD style={{ paddingLeft: 12 + depth * 24 }} className="font-medium">{depth > 0 && <span className="text-muted-foreground">› </span>}{d.name}</TD>
                <TD>{personName(data, d.ownerId)}</TD>
                <TD className="text-right">{data.projects.filter((p) => p.departmentId === id).length}</TD>
                <TD className="whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(d)}><Pencil />Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => confirm(`Delete ${d.name}?`) && run(() => repo.deleteDepartment(id), "Deleted")} aria-label="Delete"><Trash2 /></Button>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      {editing && <DepartmentDialog dept={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DepartmentDialog({ dept, onClose }: { dept: Department | null; onClose: () => void }) {
  const { data, run, repo } = useStore();
  const [name, setName] = useState(dept?.name ?? "");
  const [parentId, setParentId] = useState<ID | null>(dept?.parentId ?? null);
  const [ownerId, setOwnerId] = useState<ID | null>(dept?.ownerId ?? null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{dept ? `Edit ${dept.name}` : "Add a department"}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          if ((await run(() => repo.saveDepartment({ name, parentId, ownerId }, dept?.id).then(() => true), "Saved"))) onClose();
        }}>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
          <Field label="Sits under" hint="Leave as top level for a main department.">
            <DepartmentSelect departments={data.departments.filter((d) => d.id !== dept?.id)} value={parentId} onChange={setParentId} allowEmpty emptyLabel="Top level" />
          </Field>
          <Field label="Owner"><PersonSelect people={data.people.filter((p) => p.role !== "viewer")} value={ownerId} onChange={setOwnerId} allowEmpty emptyLabel="No owner" /></Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OutputTypesAdmin() {
  const { data, run, repo } = useStore();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: ID; name: string } | null>(null);
  const types = [...data.outputTypes].sort((a, b) => a.sortOrder - b.sortOrder);
  const save = (o: OutputType, patch: Partial<OutputType>) => {
    const { id, ...rest } = { ...o, ...patch };
    return run(() => repo.saveOutputType(rest, id));
  };
  const swap = async (i: number, j: number) => {
    const a = types[i], b = types[j];
    await run(async () => {
      await repo.saveOutputType({ name: a.name, active: a.active, sortOrder: b.sortOrder }, a.id);
      await repo.saveOutputType({ name: b.name, active: b.active, sortOrder: a.sortOrder }, b.id);
    });
  };

  return (
    <div className="grid max-w-2xl gap-4">
      <p className="text-sm text-muted-foreground">The kinds of output a project can produce. Turning one off hides it for new projects but keeps it on old ones.</p>
      <Card>
        <CardContent className="pt-4">
          <ul className="divide-y">
            {types.map((o, i) => (
              <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                {renaming?.id === o.id ? (
                  <form className="flex flex-1 gap-2" onSubmit={async (e) => { e.preventDefault(); await save(o, { name: renaming.name }); setRenaming(null); }}>
                    <Input value={renaming.name} onChange={(e) => setRenaming({ id: o.id, name: e.target.value })} autoFocus />
                    <Button type="submit" size="sm">Save</Button>
                  </form>
                ) : (
                  <span className={o.active ? "font-medium" : "text-muted-foreground line-through"}>{o.name}</span>
                )}
                <span className="flex shrink-0 items-center gap-1">
                  <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => swap(i, i - 1)} aria-label="Move up"><ArrowUp /></Button>
                  <Button size="icon" variant="ghost" disabled={i === types.length - 1} onClick={() => swap(i, i + 1)} aria-label="Move down"><ArrowDown /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: o.id, name: o.name })}>Rename</Button>
                  <Button size="sm" variant="ghost" onClick={() => save(o, { active: !o.active })}>{o.active ? "Turn off" : "Turn on"}</Button>
                  <Button size="icon" variant="ghost" onClick={() => confirm(`Delete "${o.name}"?`) && run(() => repo.deleteOutputType(o.id), "Deleted")} aria-label="Delete"><Trash2 /></Button>
                </span>
              </li>
            ))}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={async (e) => {
            e.preventDefault();
            const next = Math.max(0, ...types.map((t) => t.sortOrder)) + 1;
            if ((await run(() => repo.saveOutputType({ name, active: true, sortOrder: next }).then(() => true), "Added"))) setName("");
          }}>
            <Input placeholder="New output type, for example Podcasts" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={!name.trim()}><Plus />Add</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ConnectionsAdmin() {
  const { run, repo, tracker, removedInvolvement, mode } = useStore();
  const [result, setResult] = useState<SyncResult | null>(null);
  const ai = getAIProvider();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Relationship Tracker</CardTitle>
          <CardDescription>Pulls contacts and organizations from the tracker and sends back which projects involve them.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p>Connected to: <span className="font-medium">{tracker.name}</span></p>
          <p className="text-muted-foreground">
            {mode === "demo"
              ? "Demo mode uses sample contacts. The live app reads the tracker's Excel workbook."
              : "Reads contacts from the tracker workbook's Master tab and writes each contact's FSI projects to its \"FSI Projects\" tab. Links and unlinks are sent right away; Sync also refreshes names and catches anything missed."}
          </p>
          <Button className="w-fit" onClick={() => run(async () => setResult(await syncRelationships(tracker, repo.data, (id, p) => repo.updateRelationshipLink(id, p), removedInvolvement.splice(0))))}>
            <RefreshCw />Sync all projects now
          </Button>
          {result && (
            <p>
              Synced at {new Date(result.at).toLocaleTimeString()}: {result.updated} link{result.updated === 1 ? "" : "s"} updated, {result.pushed} sent to the tracker.
              {result.missing.length > 0 && <> Not found in the tracker: {result.missing.join(", ")}.</>}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Claude</CardTitle><CardDescription>Powers the planning function and the Ask panel.</CardDescription></CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>Status: {ai.connected ? <Badge variant="success">Connected</Badge> : <Badge variant="muted">Not connected</Badge>}</p>
          {!ai.connected && <p className="text-muted-foreground">Planning uses built-in rules until Claude is connected. See README, "Connecting Claude".</p>}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Where the data lives</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {mode === "demo" ? <p>Demo mode: sample data in this browser tab only.</p> : <p>SharePoint lists on the FSI Task Tracker site. Each list can be opened in SharePoint; avoid renaming lists or columns.</p>}
          <ul className="grid gap-1 text-muted-foreground sm:grid-cols-2">
            {TABLES.map((t) => <li key={t}><span className="font-medium text-foreground">{SCHEMA[t].listName}</span>: {SCHEMA[t].description}</li>)}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function DeletionLog() {
  const { data, repo, run } = useStore();
  const [rows, setRows] = useState<DeletionEntry[] | null>(null);
  const [open, setOpen] = useState<DeletionEntry | null>(null);
  const load = () => run(async () => setRows(await repo.loadDeletions()));
  // Load once when the tab opens.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-4">
      <Card className="border-amber-200 bg-amber-50/60">
        <CardHeader>
          <CardTitle>Keep this log admin-only in SharePoint</CardTitle>
          <CardDescription className="text-amber-900">
            The app shows this page to admins only. To stop others reading the list directly in SharePoint, a site owner turns on
            item-level permissions once: open the <strong>FSI Deletion Log</strong> list, then Settings (gear), List settings, Advanced
            settings. Set <strong>Read access</strong> to "Read items that were created by the user" and <strong>Create and Edit
            access</strong> to "Create items and edit items that were created by the user". People who delete can then add entries but
            see only their own; site owners see all. Full steps are in the README under "Deletion log".
          </CardDescription>
        </CardHeader>
      </Card>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Every deletion, newest first. Each entry is written before the item is removed.</p>
        <Button variant="outline" onClick={load}><RefreshCw />Refresh</Button>
      </div>
      {rows === null ? <p className="text-sm text-muted-foreground">Loading...</p> : rows.length === 0 ? <Empty>Nothing has been deleted.</Empty> : (
        <Table>
          <THead><TR><TH>When</TH><TH>Deleted by</TH><TH>What</TH><TH>Department</TH><TH></TH></TR></THead>
          <TBody>
            {rows.map((d) => (
              <TR key={d.id}>
                <TD className="whitespace-nowrap text-sm">{formatDate(d.deletedAt.slice(0, 10))}<div className="text-xs text-muted-foreground">{new Date(d.deletedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div></TD>
                <TD className="text-sm">{personName(data, d.deletedById)}<div className="text-xs text-muted-foreground">{d.deletedByEmail}</div></TD>
                <TD className="max-w-md text-sm">{d.summary}</TD>
                <TD className="text-sm">{deptName(data, d.departmentId)}</TD>
                <TD><Button size="sm" variant="ghost" onClick={() => setOpen(d)}>Details</Button></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>What was deleted</DialogTitle></DialogHeader>
          {open && (
            <div className="grid gap-2 text-sm">
              <p>{open.summary}</p>
              <p className="text-muted-foreground">By {open.deletedByEmail} on {new Date(open.deletedAt).toLocaleString()}. Log entry #{open.id}.</p>
              <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">{prettyJson(open.snapshot)}</pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
