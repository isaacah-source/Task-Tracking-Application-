import { useMemo, useState, type KeyboardEvent } from "react";
import type { ID, Status, Task, TaskKind } from "@/domain/types";
import { STATUS_LABELS, TASK_KIND_LABELS } from "@/domain/types";
import { checkAssignment } from "@/domain/conflicts";
import { durationOf, followsPredecessors, linkedSchedule, predecessorIds, successorIds } from "@/domain/dependencies";
import { CornerDownRight, Plus, Trash2 } from "lucide-react";
import { formatDate } from "@/domain/dates";
import { subtasksOf } from "@/domain/tasks";
import { RuleError, type TaskInput } from "@/data/repository";
import { useStore } from "@/data/store";
import { ConflictList } from "./ConflictList";
import { EffortInput } from "./EffortInput";
import { Field, PersonSelect, handoffMessage, personName } from "./common";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input, Select, Textarea } from "./ui/input";

/**
 * Create or edit a task. Shows conflicts live and enforces dependency order on save. Pass
 * `parentTaskId` to add a subtask; `onOpenTask` lets the subtask list open one of them.
 */
export function TaskDialog({ open, onClose, projectId, task, canEdit, parentTaskId = null, onOpenTask }: {
  open: boolean; onClose: () => void; projectId: ID; task?: Task | null; canEdit: boolean;
  parentTaskId?: ID | null; onOpenTask?: (t: Task) => void;
}) {
  const { data, run, today, repo, toast } = useStore();
  const project = data.projects.find((p) => p.id === projectId);
  const canDelete = !!project && repo.canDelete(project);
  const editing = !!task;
  const [v, setV] = useState<TaskInput>(() =>
    task
      ? { ...task }
      : {
          projectId, title: "", kind: "task", ownerId: null, startDate: null, dueDate: null, status: "notStarted",
          effortHours: 0, estimatedCost: 0, notes: "", parentTaskId,
        },
  );
  const parent = data.tasks.find((t) => t.id === (task?.parentTaskId ?? parentTaskId)) ?? null;
  const subtasks = task ? subtasksOf(task.id, data.tasks) : [];
  const openSubtasks = subtasks.filter((t) => t.status !== "done").length;
  const initialPreds = task ? predecessorIds(task.id, data.dependencies) : [];
  const [preds, setPreds] = useState<ID[]>(initialPreds);
  const [shiftDown, setShiftDown] = useState<{ newDue: string } | null>(null);
  const set = <K extends keyof TaskInput>(k: K, val: TaskInput[K]) => setV((x) => ({ ...x, [k]: val }));

  // A task that waits on others starts the day after they are done and runs its estimated days.
  const selfId = task?.id ?? "__new__";
  const asTask: Task = {
    ...v, id: selfId, sourceMeetingId: v.sourceMeetingId ?? null, parentTaskId: v.parentTaskId ?? null,
    durationDays: v.durationDays ?? 0, completedAt: task?.completedAt ?? null,
  };
  const follows = preds.length > 0 && followsPredecessors(v);
  const schedule = follows
    ? linkedSchedule(asTask, data.tasks, [
        ...data.dependencies.filter((d) => d.successorId !== selfId),
        ...preds.map((p, i) => ({ id: `__d${i}`, predecessorId: p, successorId: selfId })),
      ])
    : null;
  const effective = schedule ? { ...v, ...schedule } : v;
  const waitTitles = preds.map((p) => `"${data.tasks.find((t) => t.id === p)?.title ?? ""}"`).join(", ");

  const candidates = data.tasks
    .filter((t) => t.id !== task?.id && (!task || !successorIds(task.id, data.dependencies).includes(t.id)))
    .sort((a, b) => (a.projectId === projectId ? -1 : 1) - (b.projectId === projectId ? -1 : 1) || a.title.localeCompare(b.title));
  const projectTitle = (id: ID) => data.projects.find((p) => p.id === id)?.title ?? "";

  const conflicts = useMemo(() => {
    if (!effective.ownerId || !effective.dueDate) return [];
    // Leave the task itself out so it does not clash with its own old version.
    const others = task ? data.tasks.filter((t) => t.id !== task.id) : data.tasks;
    return checkAssignment({ ...effective, predecessorIds: preds }, { ...data, tasks: others }, today).filter(
      // An unchanged past due date on an existing task is shown by its Overdue flag already.
      (c) => !(editing && c.message.includes("has already passed") && v.dueDate === task?.dueDate),
    );
  }, [effective, preds, data, today, task, editing]);

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
        const { handedOff } = await repo.updateTask(task!.id, patch, reason);
        if (handedOff.length) toast(handoffMessage(handedOff, data));
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
          <DialogTitle>{editing ? (canEdit ? (parent ? "Edit subtask" : "Edit task") : task!.title) : parent ? "Add a subtask" : "Add a task"}</DialogTitle>
          {parent && (
            <p className="text-sm text-muted-foreground">
              Subtask of{" "}
              {onOpenTask ? <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => onOpenTask(parent)}>{parent.title}</button> : <span className="font-medium">{parent.title}</span>}
            </p>
          )}
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
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Owner">
                  <PersonSelect people={data.people.filter((p) => p.role !== "viewer")} value={v.ownerId} onChange={(id) => set("ownerId", id)} allowEmpty />
                </Field>
                <Field label="Type">
                  <Select value={v.kind} onChange={(e) => set("kind", e.target.value as TaskKind)}>
                    {Object.entries(TASK_KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {follows ? (
                  <>
                    <Field label="Starts" hint={`The day after ${waitTitles} ${preds.length === 1 ? "is" : "are"} done.`}>
                      <ReadOnlyDate date={schedule?.startDate ?? null} empty="Once that has a due date" />
                    </Field>
                    <Field label="Days to complete" hint={schedule ? `Due ${formatDate(schedule.dueDate)}` : "Sets the due date from the start."}>
                      <Input
                        type="number" min={0} step={1} inputMode="numeric"
                        value={durationOf(asTask)}
                        onChange={(e) => set("durationDays", Math.max(0, Math.round(Number(e.target.value) || 0)))}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Start">
                      <Input type="date" value={v.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
                    </Field>
                    <Field label="Due">
                      <Input type="date" value={v.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} />
                    </Field>
                  </>
                )}
                <Field label="Status">
                  <Select value={v.status} onChange={(e) => set("status", e.target.value as Status)}>
                    {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Effort" hint="Rough estimate, in 15-minute steps. Drives the workload view.">
                  <EffortInput value={v.effortHours} onChange={(h) => set("effortHours", h)} />
                </Field>
                <Field label="Estimated cost ($)" hint="Counts against the project budget while open.">
                  <Input type="number" min={0} step={50} value={v.estimatedCost} onChange={(e) => set("estimatedCost", Number(e.target.value))} />
                </Field>
              </div>
              <Field label="Has to wait for" hint={v.kind === "event" ? "This event cannot be set before these are due." : "This task starts the day after these are done, and its dates move with them."}>
                <div className="max-h-36 overflow-y-auto rounded-md border bg-card p-2">
                  {candidates.length === 0 && <p className="text-sm text-muted-foreground">No other tasks yet.</p>}
                  {candidates.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 py-0.5 text-sm">
                      <input
                        type="checkbox"
                        checked={preds.includes(t.id)}
                        // Removing an existing link is a deletion: leads and admins only.
                        disabled={!canDelete && initialPreds.includes(t.id)}
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
            {editing && !task!.parentTaskId && <Subtasks task={task!} subtasks={subtasks} canEdit={canEdit} onOpenTask={onOpenTask} />}
            {v.status === "done" && openSubtasks > 0 && (
              <p className="text-sm text-amber-800">{openSubtasks} subtask{openSubtasks === 1 ? " is" : "s are"} still open.</p>
            )}
            {canEdit && (
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conflict check</div>
                <ConflictList conflicts={conflicts} ready={!!effective.ownerId && !!effective.dueDate} />
              </div>
            )}
            <DialogFooter>
              {editing && canDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-red-700 hover:bg-red-50 hover:text-red-800 sm:mr-auto"
                  onClick={async () => {
                    const also = subtasks.length ? ` and its ${subtasks.length} subtask${subtasks.length === 1 ? "" : "s"}` : "";
                    if (!confirm(`Delete "${task!.title}"${also}? The deletion is recorded in the admin deletion log.`)) return;
                    if (await run(() => repo.deleteTask(task!.id).then(() => true), "Task deleted")) onClose();
                  }}
                >
                  <Trash2 />Delete task
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</Button>
              {canEdit && <Button type="submit">{editing ? "Save" : "Add task"}</Button>}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The subtasks of a task: tick one off, open it, or add a new one by name. */
function Subtasks({ task, subtasks, canEdit, onOpenTask }: { task: Task; subtasks: Task[]; canEdit: boolean; onOpenTask?: (t: Task) => void }) {
  const { data, repo, run } = useStore();
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState<ID | null>(task.ownerId);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const done = subtasks.filter((t) => t.status === "done").length;

  async function add() {
    if (!title.trim()) return;
    const ok = await run(() => repo.createTask({
      projectId: task.projectId, parentTaskId: task.id, title, kind: "task", ownerId, startDate: null, dueDate,
      status: "notStarted", effortHours: 0, estimatedCost: 0, notes: "",
    }).then(() => true), "Subtask added");
    if (ok) {
      setTitle("");
      setDueDate(null);
    }
  }
  const onKey = (e: KeyboardEvent) => {
    // Enter adds the subtask instead of saving the whole task.
    if (e.key === "Enter") {
      e.preventDefault();
      void add();
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-medium">Subtasks</div>
        {subtasks.length > 0 && <div className="text-xs text-muted-foreground">{done} of {subtasks.length} done</div>}
      </div>
      {subtasks.length > 0 ? (
        <ul className="divide-y rounded-md border bg-card">
          {subtasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
              <input
                type="checkbox"
                aria-label={`Mark "${t.title}" done`}
                checked={t.status === "done"}
                disabled={!canEdit}
                onChange={(e) => run(() => repo.updateTask(t.id, { status: e.target.checked ? "done" : "notStarted" }))}
              />
              <div className="min-w-0 flex-1">
                {onOpenTask ? (
                  <button type="button" className={`text-left hover:underline ${t.status === "done" ? "text-muted-foreground line-through" : ""}`} onClick={() => onOpenTask(t)}>{t.title}</button>
                ) : <span className={t.status === "done" ? "text-muted-foreground line-through" : ""}>{t.title}</span>}
                <div className="text-xs text-muted-foreground">
                  {[t.ownerId && personName(data, t.ownerId), t.dueDate && `Due ${formatDate(t.dueDate)}`].filter(Boolean).join(" · ")}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : !canEdit && <p className="text-sm text-muted-foreground">No subtasks.</p>}
      {canEdit && (
        <div className="grid gap-2 sm:grid-cols-[1fr_10rem_9.5rem_auto]">
          <Input placeholder="Add a subtask" aria-label="New subtask" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={onKey} />
          <PersonSelect people={data.people.filter((p) => p.role !== "viewer")} value={ownerId} onChange={setOwnerId} allowEmpty />
          <Input type="date" aria-label="Subtask due date" value={dueDate ?? ""} onChange={(e) => setDueDate(e.target.value || null)} onKeyDown={onKey} />
          <Button type="button" variant="outline" disabled={!title.trim()} onClick={add}><Plus />Add</Button>
        </div>
      )}
    </div>
  );
}

/** Marks a subtask row in task tables. */
export function SubtaskMark() {
  return <CornerDownRight className="mr-1 inline h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Subtask" />;
}

/** A calculated date shown where a date field would be. */
function ReadOnlyDate({ date, empty }: { date: string | null; empty: string }) {
  return (
    <div className="flex h-9 items-center rounded-md border border-dashed bg-muted/40 px-3 text-base md:text-sm">
      {date ? formatDate(date) : <span className="text-muted-foreground">{empty}</span>}
    </div>
  );
}
