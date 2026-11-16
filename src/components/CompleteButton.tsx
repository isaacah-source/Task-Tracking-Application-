import { CheckCircle2 } from "lucide-react";
import type { Task } from "@/domain/types";
import { blockers } from "@/domain/dependencies";
import { subtasksOf } from "@/domain/tasks";
import { useStore } from "@/data/store";
import { cn } from "@/lib/utils";
import { handoffMessage } from "./common";
import { Button } from "./ui/button";

/**
 * One-click "mark this task done", for any list that shows a task. Shown only to people who
 * can change the task's project, and only while the task is open. Disabled while the task
 * waits on unfinished work. Completing runs the usual rules: stage handoffs, and moving the
 * work that waits on this task.
 */
export function CompleteButton({ task, iconOnly = false, className, onDone }: {
  task: Task; iconOnly?: boolean; className?: string; onDone?: () => void;
}) {
  const { data, repo, run, toast } = useStore();
  const project = data.projects.find((p) => p.id === task.projectId);
  if (task.status === "done" || !project || !repo.canEdit(project)) return null;
  const waiting = blockers(task, data.tasks, data.dependencies);
  const label = waiting.length
    ? `Waiting on ${waiting.map((t) => `"${t.title}"`).join(", ")}`
    : `Mark "${task.title}" complete`;

  async function complete() {
    const ok = await run(async () => {
      const { handedOff } = await repo.updateTask(task.id, { status: "done" });
      const open = subtasksOf(task.id, data.tasks).filter((s) => s.status !== "done").length;
      toast([
        "Marked complete.",
        handedOff.length ? handoffMessage(handedOff, data) : "",
        open ? `${open} subtask${open === 1 ? " is" : "s are"} still open.` : "",
      ].filter(Boolean).join(" "));
      return true;
    });
    if (ok) onDone?.();
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn("print:hidden", iconOnly && "h-7 w-7 px-0", className)}
      disabled={waiting.length > 0}
      title={label}
      aria-label={label}
      onClick={(e) => {
        // Rows that open the task on click should not open it here.
        e.stopPropagation();
        e.preventDefault();
        void complete();
      }}
    >
      <CheckCircle2 />{!iconOnly && "Complete"}
    </Button>
  );
}
