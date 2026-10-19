import { useState } from "react";
import type { Horizon, Project, Status } from "@/domain/types";
import { HORIZON_LABELS, STATUS_LABELS } from "@/domain/types";
import type { ProjectInput } from "@/data/repository";
import { useStore } from "@/data/store";
import { DepartmentSelect, Field, PersonSelect } from "./common";
import { Input, Select, Textarea } from "./ui/input";
import { Button } from "./ui/button";

export function blankProject(ownerId: string | null, departmentId: string | null): ProjectInput {
  return {
    title: "", departmentId: departmentId ?? "", ownerId: ownerId ?? "", outputTypeIds: [], milestone: "", horizon: "immediate",
    operationalDetails: "", startDate: null, dueDate: null, status: "notStarted", plannedBudget: 0, actualSpend: 0,
  };
}

/** The Section 4 fields of a project, as one form. Used for new projects and edits. */
export function ProjectForm({ initial, onSubmit, submitLabel, onCancel, disabled }: {
  initial: ProjectInput | Project;
  onSubmit: (v: ProjectInput) => void;
  submitLabel: string;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  const { data } = useStore();
  const [v, setV] = useState<ProjectInput>({ ...initial });
  const set = <K extends keyof ProjectInput>(k: K, val: ProjectInput[K]) => setV((x) => ({ ...x, [k]: val }));
  const types = data.outputTypes.filter((o) => o.active || v.outputTypeIds.includes(o.id)).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <Field label="Project name">
        <Input value={v.title} onChange={(e) => set("title", e.target.value)} disabled={disabled} required autoFocus={!v.title} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Department">
          <DepartmentSelect departments={data.departments} value={v.departmentId || null} onChange={(id) => set("departmentId", id ?? "")} />
        </Field>
        <Field label="Owner">
          <PersonSelect people={data.people.filter((p) => p.role !== "viewer")} value={v.ownerId || null} onChange={(id) => set("ownerId", id ?? "")} />
        </Field>
      </div>
      <fieldset className="grid gap-1.5" disabled={disabled}>
        <legend className="mb-1.5 text-sm font-medium">Type of output <span className="font-normal text-muted-foreground">(choose any)</span></legend>
        <div className="flex flex-wrap gap-2">
          {types.map((o) => {
            const on = v.outputTypeIds.includes(o.id);
            return (
              <button
                type="button"
                key={o.id}
                aria-pressed={on}
                onClick={() => set("outputTypeIds", on ? v.outputTypeIds.filter((x) => x !== o.id) : [...v.outputTypeIds, o.id])}
                className={`rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}
              >
                {o.name}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Next milestone">
          <Input value={v.milestone} onChange={(e) => set("milestone", e.target.value)} disabled={disabled} placeholder="For example: draft to reviewers" />
        </Field>
        <Field label="Horizon">
          <Select value={v.horizon} onChange={(e) => set("horizon", e.target.value as Horizon)} disabled={disabled}>
            {Object.entries(HORIZON_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Start date">
          <Input type="date" value={v.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} disabled={disabled} />
        </Field>
        <Field label="Due date">
          <Input type="date" value={v.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} disabled={disabled} />
        </Field>
        <Field label="Status">
          <Select value={v.status} onChange={(e) => set("status", e.target.value as Status)} disabled={disabled}>
            {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Planned budget ($)">
          <Input type="number" min={0} step={100} value={v.plannedBudget} onChange={(e) => set("plannedBudget", Number(e.target.value))} disabled={disabled} />
        </Field>
        <Field label="Actual spend so far ($)">
          <Input type="number" min={0} step={100} value={v.actualSpend} onChange={(e) => set("actualSpend", Number(e.target.value))} disabled={disabled} />
        </Field>
      </div>
      <Field label="Operational details" hint="Logistics, constraints, anything the team needs to know.">
        <Textarea rows={4} value={v.operationalDetails} onChange={(e) => set("operationalDetails", e.target.value)} disabled={disabled} />
      </Field>
      {!disabled && (
        <div className="flex justify-end gap-2">
          {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
          <Button type="submit">{submitLabel}</Button>
        </div>
      )}
    </form>
  );
}
