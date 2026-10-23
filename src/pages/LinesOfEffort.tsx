import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/data/store";
import type { ID, LineOfEffort } from "@/domain/types";
import { canWrite } from "@/domain/permissions";
import { DateText, DepartmentSelect, Empty, Field, PageHeader, PersonSelect, StatusBadge, departmentOptions, personName } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Lines of effort: FSI's enduring bodies of work, each owned by a department, with the projects
 * under them. Admins, department owners, and Department Task Leads add and change them.
 */
export default function LinesOfEffortPage() {
  const { data, me, repo, today } = useStore();
  const [dept, setDept] = useState<ID | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<LineOfEffort | "new" | null>(null);
  const canAdd = canWrite(me) && data.departments.some((d) => repo.canManageLineOfEffort(d.id));
  const unassigned = data.projects.filter((p) => !p.lineOfEffortId);

  // Links like /lines#loe-3 scroll to that line of effort.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);

  const groups = departmentOptions(data.departments)
    .filter((d) => !dept || d.id === dept)
    .map((d) => ({
      dept: d,
      lines: data.linesOfEffort.filter((l) => l.departmentId === d.id && (showInactive || l.active)).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.lines.length);

  return (
    <>
      <PageHeader
        title="Lines of effort"
        description="FSI's enduring lines of effort. Each belongs to a department and groups the projects that advance it."
        actions={canAdd && <Button onClick={() => setEditing("new")}><Plus />New line of effort</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-64"><DepartmentSelect departments={data.departments} value={dept} onChange={setDept} allowEmpty /></div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      {unassigned.length > 0 && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-medium">{unassigned.length} project{unassigned.length === 1 ? " needs" : "s need"} a line of effort.</span>{" "}
          <Link to="/projects?loe=none" className="underline">See which</Link>, then edit each project's details to choose one.
        </div>
      )}

      {groups.length === 0 ? <Empty>No lines of effort yet.</Empty> : (
        <div className="grid gap-8">
          {groups.map((g) => (
            <section key={g.dept.id}>
              <h2 className="mb-3 text-lg font-semibold">{g.dept.label}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {g.lines.map((l) => {
                  const projects = data.projects.filter((p) => p.lineOfEffortId === l.id)
                    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
                  const open = projects.filter((p) => p.status !== "done").length;
                  const manage = repo.canManageLineOfEffort(l.departmentId);
                  return (
                    <Card key={l.id} id={`loe-${l.id}`} className={cn("scroll-mt-6", !l.active && "opacity-70")}>
                      <CardHeader className="flex-row items-start justify-between gap-2">
                        <div>
                          <CardTitle className="flex items-center gap-2">{l.name}{!l.active && <Badge variant="muted">Inactive</Badge>}</CardTitle>
                          <CardDescription>
                            {l.ownerId ? `Led by ${personName(data, l.ownerId)} · ` : ""}{open} open project{open === 1 ? "" : "s"}, {projects.length - open} done
                          </CardDescription>
                        </div>
                        {manage && <Button size="sm" variant="ghost" onClick={() => setEditing(l)}><Pencil />Edit</Button>}
                      </CardHeader>
                      <CardContent className="grid gap-3">
                        {l.description && <p className="whitespace-pre-line text-sm">{l.description}</p>}
                        {projects.length === 0 ? <p className="text-sm text-muted-foreground">No projects yet.</p> : (
                          <ul className="divide-y rounded-md border">
                            {projects.map((p) => (
                              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                                <Link to={`/projects/${p.id}`} className={cn("font-medium hover:underline", p.status === "done" && "text-muted-foreground")}>{p.title}</Link>
                                <span className="flex shrink-0 items-center gap-2">
                                  <span className="text-xs"><DateText date={p.dueDate} status={p.status} today={today} /></span>
                                  <StatusBadge status={p.status} />
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing === "new" ? "New line of effort" : "Edit line of effort"}</DialogTitle></DialogHeader>
          {editing && <LineForm key={editing === "new" ? "new" : editing.id} line={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function LineForm({ line, onDone }: { line: LineOfEffort | null; onDone: () => void }) {
  const { data, me, repo, run } = useStore();
  const allowed = data.departments.filter((d) => repo.canManageLineOfEffort(d.id) || d.id === line?.departmentId);
  const [v, setV] = useState<Omit<LineOfEffort, "id">>(line ?? {
    name: "", description: "", ownerId: null, active: true,
    departmentId: (me?.departmentId && repo.canManageLineOfEffort(me.departmentId) ? me.departmentId : allowed[0]?.id) ?? "",
  });
  const used = line ? data.projects.filter((p) => p.lineOfEffortId === line.id).length : 0;
  const canDelete = !!line && repo.canDeleteLineOfEffort(line);

  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => repo.saveLineOfEffort(v, line?.id), line ? "Line of effort saved" : "Line of effort added")) onDone();
      }}
    >
      <Field label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required autoFocus /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Department"><DepartmentSelect departments={allowed} value={v.departmentId || null} onChange={(id) => setV({ ...v, departmentId: id ?? "" })} /></Field>
        <Field label="Lead (optional)">
          <PersonSelect people={data.people.filter((p) => p.role !== "viewer" && p.active)} value={v.ownerId} onChange={(id) => setV({ ...v, ownerId: id })} allowEmpty emptyLabel="No lead" />
        </Field>
      </div>
      <Field label="Description"><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="What this line of effort is for" /></Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
        Active (inactive ones drop out of the project form's list but keep their projects)
      </label>
      <DialogFooter className="sm:justify-between">
        {canDelete ? (
          <Button
            type="button"
            variant="ghost"
            disabled={used > 0}
            title={used ? "Move its projects first, or mark it inactive" : undefined}
            onClick={async () => {
              if (!confirm(`Delete "${line!.name}"? The deletion is recorded in the admin deletion log.`)) return;
              if (await run(() => repo.deleteLineOfEffort(line!.id).then(() => true), "Line of effort deleted")) onDone();
            }}
          >
            <Trash2 />Delete{used ? ` (${used} project${used === 1 ? "" : "s"} use it)` : ""}
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
          <Button type="submit">{line ? "Save" : "Add"}</Button>
        </div>
      </DialogFooter>
    </form>
  );
}
