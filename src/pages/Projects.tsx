import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useStore } from "@/data/store";
import { canWrite } from "@/domain/permissions";
import { departmentTree } from "@/domain/permissions";
import { activeStage, nextMilestone } from "@/domain/transitions";
import type { Status } from "@/domain/types";
import { STATUS_LABELS } from "@/domain/types";
import { DateText, DepartmentSelect, DueFlag, Empty, PageHeader, StatusBadge, deptName, money, personName } from "@/components/common";
import { ProjectForm, blankProject } from "@/components/ProjectForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default function ProjectsPage() {
  const { data, me, today, run, repo } = useStore();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [status, setStatus] = useState<"open" | Status | "">("open");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const depts = dept ? departmentTree(dept, data.departments) : null;
    return data.projects
      .filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()))
      .filter((p) => !depts || depts.has(p.departmentId))
      .filter((p) => !type || p.outputTypeIds.includes(type))
      .filter((p) => (status === "open" ? p.status !== "done" : !status || p.status === status))
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  }, [data, q, dept, type, status]);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every FSI project, by department."
        actions={canWrite(me) && <Button onClick={() => setCreating(true)}><Plus />New project</Button>}
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <DepartmentSelect departments={data.departments} value={dept} onChange={setDept} allowEmpty />
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All output types</option>
          {data.outputTypes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="open">Open projects</option>
          <option value="">All projects</option>
          {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </div>

      {rows.length === 0 ? (
        <Empty>No projects match.</Empty>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Project</TH>
              <TH>Department</TH>
              <TH>Owner</TH>
              <TH>Stage</TH>
              <TH>Due</TH>
              <TH>Budget</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((p) => {
              const stage = activeStage(p.id, data.stages);
              const pct = p.plannedBudget > 0 ? Math.round((p.actualSpend / p.plannedBudget) * 100) : null;
              return (
                <TR key={p.id}>
                  <TD className="max-w-xs">
                    <Link to={`/projects/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.outputTypeIds.map((id) => data.outputTypes.find((o) => o.id === id)?.name).filter(Boolean).join(", ")}
                      {nextMilestone(p.id, data.tasks) && ` · Next milestone: ${nextMilestone(p.id, data.tasks)!.title}`}
                    </div>
                  </TD>
                  <TD>{deptName(data, p.departmentId)}</TD>
                  <TD>{personName(data, p.ownerId)}</TD>
                  <TD className="text-muted-foreground">{stage?.name ?? ""}</TD>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      <DateText date={p.dueDate} status={p.status} today={today} />
                      <DueFlag dueDate={p.dueDate} status={p.status} today={today} />
                    </div>
                  </TD>
                  <TD>
                    {pct === null ? <span className="text-muted-foreground">None</span> : (
                      <span className={pct > 100 ? "font-semibold text-red-700" : pct >= 90 ? "font-semibold text-amber-800" : ""}>
                        {money(p.actualSpend)} <span className="text-muted-foreground">of {money(p.plannedBudget)}</span>
                      </span>
                    )}
                  </TD>
                  <TD><StatusBadge status={p.status} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
          <ProjectForm
            initial={blankProject(me?.id ?? null, me?.departmentId ?? null)}
            submitLabel="Create project"
            onCancel={() => setCreating(false)}
            onSubmit={async (v) => {
              const p = await run(() => repo.createProject(v), "Project created");
              if (p) {
                setCreating(false);
                nav(`/projects/${p.id}`);
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
