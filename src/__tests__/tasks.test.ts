import { describe, expect, it } from "vitest";
import { formatEffort, roundEffort, withSubtasks } from "@/domain/tasks";
import type { Task } from "@/domain/types";

const t = (id: string, parentTaskId: string | null = null) => ({ id, parentTaskId }) as Task;

describe("effort", () => {
  it("rounds to the nearest 15 minutes and never goes below zero", () => {
    expect(roundEffort(1.1)).toBe(1);
    expect(roundEffort(1.13)).toBe(1.25);
    expect(roundEffort(-3)).toBe(0);
    expect(roundEffort(Number.NaN)).toBe(0);
  });

  it("reads as hours and minutes", () => {
    expect(formatEffort(0)).toBe("");
    expect(formatEffort(0.25)).toBe("15 min");
    expect(formatEffort(1.5)).toBe("1 h 30 min");
    expect(formatEffort(3)).toBe("3 h");
  });
});

describe("withSubtasks", () => {
  it("lists each subtask straight after its parent", () => {
    const out = withSubtasks([t("1"), t("3", "2"), t("2"), t("4", "1"), t("5", "gone")]);
    expect(out.map((r) => `${r.task.id}:${r.depth}`)).toEqual(["1:0", "4:1", "2:0", "3:1", "5:0"]);
  });
});
