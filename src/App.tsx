import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { loadConfig, type AppConfig } from "@/auth/config";
import { Auth } from "@/auth/msal";
import { DataProvider } from "@/data/store";
import { Repository } from "@/data/repository";
import { MemoryBackend } from "@/data/memoryBackend";
import { GraphListsBackend } from "@/data/graphBackend";
import { buildSeed, STANDARD_DEPARTMENTS, STANDARD_OUTPUT_TYPES } from "@/data/seed";
import { today } from "@/domain/dates";
import { MockRelationshipTracker } from "@/integrations/relationships/mock";
import { UnconfiguredRelationshipTracker, WorkbookRelationshipTracker } from "@/integrations/relationships/workbook";
import type { RelationshipTracker } from "@/integrations/relationships/adapter";
import { MockTeamsTranscription } from "@/integrations/teams/mock";
import { GraphTeamsTranscription } from "@/integrations/teams/graph";
import type { TeamsTranscription } from "@/integrations/teams/adapter";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import HomePage from "@/pages/Home";
import ProjectsPage from "@/pages/Projects";
import LinesOfEffortPage from "@/pages/LinesOfEffort";
import ProjectDetailPage from "@/pages/ProjectDetail";
import TasksPage from "@/pages/Tasks";
import CalendarPage from "@/pages/Calendar";
import PeoplePage from "@/pages/People";
import OrgChartPage from "@/pages/OrgChart";
import MeetingPage from "@/pages/Meeting";
import PastMeetingsPage from "@/pages/PastMeetings";
import MeetingDisplayPage from "@/pages/MeetingDisplay";
import PlanPage from "@/pages/Plan";
import AskPage from "@/pages/Ask";
import AdminPage from "@/pages/Admin";

type Boot =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "signin"; auth: Auth }
  | { state: "setup"; repo: Repository; auth: Auth; cfg: AppConfig; missing: string[] }
  | { state: "ready"; repo: Repository; mode: "demo" | "sharepoint"; name: string; auth: Auth | null; tracker: RelationshipTracker; teams: TeamsTranscription };


async function start(): Promise<Boot> {
  const cfg = await loadConfig();
  if (cfg.demo) {
    const backend = new MemoryBackend(buildSeed(today()));
    const data = await backend.load();
    const me = data.people.find((p) => p.role === "admin") ?? null;
    const repo = new Repository(backend, me, me?.email ?? "");
    await repo.refresh();
    // Demo mode uses sample contacts; nothing is written anywhere.
    return { state: "ready", repo, mode: "demo", name: me?.name ?? "Demo", auth: null, tracker: new MockRelationshipTracker(), teams: new MockTeamsTranscription(true) };
  }

  const auth = new Auth(cfg);
  const account = await auth.init();
  if (!account) return { state: "signin", auth };
  const email = account.username.toLowerCase();
  const backend = new GraphListsBackend(cfg.siteUrl, auth.token);
  const repo = new Repository(backend, null, email);
  const missing = await backend.missingLists();
  if (missing.length) return { state: "setup", repo, auth, cfg, missing };
  await repo.refresh();
  repo.me = repo.data.people.find((p) => p.email.toLowerCase() === email && p.active) ?? null;
  const tracker = cfg.trackerFolderUrl
    ? new WorkbookRelationshipTracker(cfg.trackerFolderUrl, cfg.trackerWorkbookName, auth.token)
    : new UnconfiguredRelationshipTracker();
  return { state: "ready", repo, mode: "sharepoint", name: account.name ?? email, auth, tracker, teams: new GraphTeamsTranscription(auth.token) };
}

export default function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    start().then(setBoot, (e: Error) => setBoot({ state: "error", message: e.message }));
  }, []);

  if (boot.state === "loading") return <Centered><p className="text-muted-foreground">Loading...</p></Centered>;

  if (boot.state === "error") {
    return (
      <Centered>
        <Card className="max-w-md">
          <CardHeader><CardTitle>The app could not start</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>{boot.message}</p>
            <Button onClick={() => location.reload()}>Try again</Button>
          </CardContent>
        </Card>
      </Centered>
    );
  }

  if (boot.state === "signin") {
    return (
      <Centered>
        <Card className="max-w-sm text-center">
          <CardHeader>
            <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" className="mx-auto mb-2 h-14 w-14 rounded-xl" />
            <CardTitle className="text-xl">FSI Projects</CardTitle>
            <CardDescription>Sign in with your FSI Microsoft 365 account, the same one you use for Teams and Outlook.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => boot.auth.signIn()}>Sign in with Microsoft</Button>
          </CardContent>
        </Card>
      </Centered>
    );
  }

  if (boot.state === "setup") {
    const email = boot.repo.myEmail;
    const allowed = !boot.cfg.setupAdmins?.length || boot.cfg.setupAdmins.some((a) => a.toLowerCase() === email);
    return (
      <Centered>
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Set up the FSI Task Tracker site</CardTitle>
            <CardDescription>
              The app keeps its data in SharePoint lists on the FSI Task Tracker site. {boot.missing.length} list{boot.missing.length === 1 ? " is" : "s are"} not there yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {allowed ? (
              <>
                <p>Setup creates the lists, adds the standard departments (Comms, Research, Ops, Leadership) and output types, and makes you ({email}) the first admin. Microsoft may ask you to approve one extra permission for creating lists.</p>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await boot.repo.bootstrap(boot.auth.account?.name ?? email, email, { departments: STANDARD_DEPARTMENTS, outputTypes: STANDARD_OUTPUT_TYPES });
                      setBoot(await start());
                    } catch (e) {
                      setBoot({ state: "error", message: (e as Error).message });
                    }
                  }}
                >
                  {busy ? "Setting up..." : "Set up site"}
                </Button>
              </>
            ) : (
              <p>An admin needs to open the app first to set it up. Ask {boot.cfg.setupAdmins!.join(" or ")}.</p>
            )}
          </CardContent>
        </Card>
      </Centered>
    );
  }

  return (
    <DataProvider repo={boot.repo} mode={boot.mode} myName={boot.name} tracker={boot.tracker} teams={boot.teams} signOut={() => boot.auth?.signOut()}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="lines" element={<LinesOfEffortPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="people" element={<PeoplePage />} />
          <Route path="org" element={<OrgChartPage />} />
          <Route path="meeting" element={<MeetingPage />} />
          <Route path="meeting/past" element={<PastMeetingsPage />} />
          <Route path="display" element={<MeetingDisplayPage />} />
          <Route path="plan" element={<PlanPage />} />
          <Route path="ask" element={<AskPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="*" element={<p className="text-muted-foreground">Page not found.</p>} />
        </Route>
      </Routes>
    </DataProvider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-4">{children}</div>;
}
