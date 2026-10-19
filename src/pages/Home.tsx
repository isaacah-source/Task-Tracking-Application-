import { Link } from "react-router-dom";
import { useStore } from "@/data/store";
import { blockedTaskIds, blockers } from "@/domain/dependencies";
import { dueFlag } from "@/domain/flags";
import { formatDate } from "@/domain/dates";
import { BlockedBadge, DateText, DueFlag, Empty, PageHeader, Stat, StatusBadge } from "@/components/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const { data, me, today, run, repo, myName } = useStore();
  if (!me) {
    return (
      <>
        <PageHeader title={`Welcome, ${myName.split(" ")[0]}`} />
        <Empty>You can browse projects, the task list, and the calendar. To own work, ask an admin to add you on the Admin page.</Empty>
      </>
    );
  }

  const blocked = blockedTaskIds(data.tasks, data.dependencies);
  const mine = data.tasks
    .filter((t) => t.ownerId === me.id && t.status !== "done")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const overdue = mine.filter((t) => dueFlag(t.dueDate, t.status, today) === "overdue");
  const soon = mine.filter((t) => dueFlag(t.dueDate, t.status, today) === "dueSoon");
  const invites = data.memberships.filter((m) => m.personId === me.id && m.status === "invited");
  const myProjects = data.projects.filter(
    (p) => p.status !== "done" && (p.ownerId === me.id || data.memberships.some((m) => m.targetType === "project" && m.targetId === p.id && m.personId === me.id && m.status === "accepted")),
  );
  const projectTitle = (id: string) => data.projects.find((p) => p.id === id)?.title ?? "";

  return (
    <>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${me.name.split(" ")[0]}`} description={formatDate(today)} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : undefined} />
        <Stat label="Due this week" value={soon.length} tone={soon.length ? "warning" : undefined} />
        <Stat label="Blocked" value={mine.filter((t) => blocked.has(t.id)).length} />
        <Stat label="Open tasks" value={mine.length} />
      </div>

      {invites.length > 0 && (
        <Card className="mb-6 border-blue-200 bg-blue-50/50">
          <CardHeader><CardTitle>You have been invited</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {invites.map((m) => {
              const target = m.targetType === "project" ? data.projects.find((p) => p.id === m.targetId) : data.tasks.find((t) => t.id === m.targetId);
              if (!target) return null;
              const projectId = m.targetType === "project" ? m.targetId : (target as { projectId: string }).projectId;
              const by = data.people.find((p) => p.id === m.invitedById)?.name;
              return (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3">
                  <div>
                    <Link to={`/projects/${projectId}`} className="font-medium hover:underline">{target.title}</Link>
                    <div className="text-xs text-muted-foreground">{m.targetType === "project" ? "Project" : "Event or task"}{by ? ` · invited by ${by}` : ""}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => run(() => repo.respond(m.id, "accepted"), "Joined")}>Join</Button>
                    <Button size="sm" variant="outline" onClick={() => run(() => repo.respond(m.id, "declined"), "Declined")}>Decline</Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>My tasks</CardTitle></CardHeader>
          <CardContent>
            {mine.length === 0 ? (
              <Empty>Nothing assigned to you right now.</Empty>
            ) : (
              <ul className="divide-y">
                {mine.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <Link to={`/projects/${t.projectId}?task=${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                      <div className="truncate text-xs text-muted-foreground">{projectTitle(t.projectId)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {blocked.has(t.id) && <BlockedBadge waitingOn={blockers(t, data.tasks, data.dependencies).map((b) => b.title)} />}
                      <DueFlag dueDate={t.dueDate} status={t.status} today={today} />
                      <StatusBadge status={t.status} />
                      <DateText date={t.dueDate} status={t.status} today={today} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>My projects</CardTitle></CardHeader>
          <CardContent>
            {myProjects.length === 0 ? (
              <Empty>No active projects.</Empty>
            ) : (
              <ul className="divide-y">
                {myProjects.map((p) => (
                  <li key={p.id} className="py-2.5">
                    <Link to={`/projects/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {p.ownerId === me.id ? "Owner" : "Member"}
                      {p.dueDate && <> · due {formatDate(p.dueDate)}</>}
                      <DueFlag dueDate={p.dueDate} status={p.status} today={today} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
