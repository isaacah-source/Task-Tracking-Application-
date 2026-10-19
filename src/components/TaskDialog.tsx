import { useMemo, useState } from "react";
import type { Horizon, ID, Status, Task, TaskKind } from "@/domain/types";
import { HORIZON_LABELS, STATUS_LABELS, TASK_KIND_LABELS } from "@/domain/types";
import { checkAssignment } from "@/domain/conflicts";
import { predecessorIds, successorIds } from "@/domain/dependencies";
import { RuleError, type TaskInput } from "@/data/repository";
import { useStore } from "@/data/store";
import { ConflictList } from "./ConflictList";
import { Field, PersonSelect } from "./common";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input, Select, Textarea } from "./ui/input";

/** Create or edit a task. Shows conflicts live and enforces dependency order on save. */
export function TaskDialog({ open, onClose, projectId, task, canEdit }: {
  open: boolean; onClose: () => void; projectId: ID; task?: Task | null; canEdit: boolean;
}) {
  const { data, run, today, repo, toast } = useStore();
  const editing = !!task;
  const [v, setV] = useState<TaskInput>(() =>
    task
      ? { ...task }
      : {
          projectId, title: "", kind: "task", ownerId: null, horizon: "immediate", startDate: null, dueDate: null, status: "notStarted",
          effortHours: 0, estimatedCost: 0, notes: "",
        },
  );
  const initialPreds = task ? predecessorIds(task.id, data.dependencies) : [];
  const [preds, setPreds] = useState<ID[]>(initialPreds);
  const [shiftDown, setShiftDown] = useState<{ newDue: string } | null>(null);
  const set = <K extends keyof TaskInput>(k: K, val: TaskInput[K]) => setV((x) => ({ ...x, [k]: val }));

  const candidates = data.tasks
    .filter((t) => t.id !== task?.id && (!task || !successorIds(task.id, data.dependencies).includes(t.id)))
    .sort((a, b) => (a.projectId === projectId ? -1 : 1) - (b.projectId === projectId ? -1 : 1) || a.title.localeCompare(b.title));
  const projectTitle = (id: ID) => data.projects.find((p) => p.id === id)?.title ?? "";

  const conflicts = useMemo(() => {
    if (!v.ownerId || !v.dueDate) return [];
    // Leave the task itself out so it does not clash with its own old version.
    const others = task ? data.tasks.filter((t) => t.id !== task.id) : data.tasks;
    return checkAssignment({ ...v, predecessorIds: preds }, { ...data, tasks: others }, today).filter(
      // An unchanged past due date on an existing task is shown by its Overdue flag already.
      (c) => !(editing && c.message.includes("has already passed") && v.dueDate === task?.dueDate),
    );
  }, [v, preds, data, today, task, editing]);

  async function save() {
    const ok = await run(async (reason) => {
      if (!editing) {
        await repo.createTask(v, preds);
        return true;
      }
      const removed = initialPreds.filter((p) => !preds.includes(p));
      const added = preds.filter((p) => !initialPreds.includes(p));
      for (const p of removed) {
        const d = data.dependencies.find((x) => x.predecessorId === p && x.successorId === task!.id);
        if (d) await repo.removeDependency(d.id);
      }
      const { projectId: _p, ...patch } = v;
      try {
        await repo.updateTask(task!.id, patch, reason);
      } catch (e) {
        // A later due date that collides with downstream work: offer to move that work too.
        if (e instanceof RuleError && v.dueDate && v.dueDate !== task!.dueDate && e.problems.some((x) => x.includes("Move"))) {
          setShiftDown({ newDue: v.dueDate });
          return false;
        }
        throw e;
      }
      for (const p of added) await repo.addDependency(p, task!.id);
      return true;
    });
    if (ok) {
      toast(editing ? "Task saved" : "Task added");
      onClose();
    }
  }

  async function shift() {
    const n = await run((reason) => repo.shiftWithDownstream(task!.id, shiftDown!.newDue, reason));
    if (n !== undefined) {
      setShiftDown(null);
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? (canEdit ? "Edit task" : task!.title) : "Add a task"}</DialogTitle>
        </DialogHeader>
        {shiftDown ? (
          <div className="grid gap-3 text-sm">
            <p>Moving this task to {shiftDown.newDue} pushes it past work that waits on it. Move that work later by the same amount?</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShiftDown(null)}>Go back</Button>
              <Button onClick={shift}>Move this and the work after it</Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), save())}>
            <fieldset disabled={!canEdit} className="grid gap-4">
              <Field label="What needs to happen">
                <Input value={v.title} onChange={(e) => set("title", e.target.value)} required autoFocus={!editing} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Owner">
                  <PersonSelect people={data.people.filter((p) => p.role !== "viewer")} value={v.ownerId} onChange={(id) => set("ownerId", id)} allowEmpty />
                </Field>
                <Field label="Type">
                  <Select value={v.kind} onChange={(e) => set("kind", e.target.value as TaskKind)}>
                    {Object.entries(TASK_KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </Field>
                <Field label="Horizon">
                  <Select value={v.horizon} onChange={(e) => set("horizon", e.target.value as Horizon)}>
                    {Object.entries(HORIZON_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Start">
                  <Input type="date" value={v.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
                </Field>
                <Field label="Due">
                  <Input type="date" value={v.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} />
                </Field>
                <Field label="Status">
                  <Select value={v.status} onChange={(e) => set("status", e.target.value as Status)}>
                    {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Effort (hours)" hint="Rough estimate. Drives the workload view.">
                  <Input type="number" min={0} step={1} value={v.effortHours} onChange={(e) => set("effortHours", Number(e.target.value))} />
                </Field>
                <Field label="Estimated cost ($)" hint="Counts against the project budget while open.">
                  <Input type="number" min={0} step={50} value={v.estimatedCost} onChange={(e) => set("estimatedCost", Number(e.target.value))} />
                </Field>
              </div>
              <Field label="Has to wait for" hint="This task cannot start until these are done.">
                <div className="max-h-36 overflow-y-auto rounded-md border bg-card p-2">
                  {candidates.length === 0 && <p className="text-sm text-muted-foreground">No other tasks yet.</p>}
                  {candidates.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 py-0.5 text-sm">
                      <input
                        type="checkbox"
                        checked={preds.includes(t.id)}
                        onChange={(e) => setPreds((p) => (e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id)))}
                      />
                      <span className="truncate">{t.title}</span>
                      {t.projectId !== projectId && <span className="truncate text-xs text-muted-foreground">({projectTitle(t.projectId)})</span>}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Notes">
                <Textarea rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>
            </fieldset>
            {canEdit && (
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conflict check</div>
                <ConflictList conflicts={conflicts} ready={!!v.ownerId && !!v.dueDate} />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</Button>
              {canEdit && <Button type="submit">{editing ? "Save" : "Add task"}</Button>}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
