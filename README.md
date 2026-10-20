# FSI Projects

A project and task tracker for the Frontier Security Institute. Staff sign in with their FSI
Microsoft 365 account, and the app keeps its data in SharePoint lists on the
**FSI Task Tracker** site, next to the Relationship Tracker. There is no separate server,
database, or password.

Try it without signing in: open the app with `?demo` at the end of the address. Demo mode
loads sample departments, people, and projects. Nothing is saved.

## What it does

- **Projects** belong to one department (Comms, Research, Ops with its Resourcing
  sub-department, Leadership) and carry an owner, one or more output types, the next
  milestone, an immediate or long-term horizon, operational details, dates, a planned
  budget, and actual spend.
- **Tasks, events, and milestones** sit inside projects. Each has an owner, dates, an effort
  estimate in hours, and an estimated cost.
- **Task order.** A task can wait on other tasks, in any project. The app will not let a task
  start, or move its dates, ahead of the work it waits on. It marks waiting tasks as
  **Blocked** everywhere. Moving a due date later can push all downstream work by the same
  amount, under one reason.
- **Date changes need a reason.** Changing a project or task start or due date asks why. The
  reason, the old and new dates, and the person's name and email go into the History tab
  and the audit log for good.
- **Budget log.** Every change to planned budget or actual spend lands in the budget log
  with a note. Open tasks' estimated costs count as committed spend.
- **Timeline and calendar.** Each project has a Gantt chart with dependency arrows. The
  Calendar shows the whole org, or one department or sub-department.
- **Task list** for daily meetings and monthly, quarterly, and yearly reviews. Click any column
  to sort. Overdue work and work due within a week carry a flag and always appear.
- **Meeting notes mode.** Take notes and assign work during a meeting. While you fill in an
  assignment, the app checks it against existing commitments: other deadlines and events
  for that person, their hours against capacity, the project budget, and task order. When
  someone is over capacity, it suggests colleagues with room.
- **Handoffs.** Give a project ordered stages, each with its own owner and department.
  Completing a stage hands the project to the next owner. For example, when Research
  completes, Comms takes over for rollout.
- **People and events.** Invite FSI colleagues to projects and to events inside them. Invited
  people see the invitation on their My work page.
- **Org chart.** Who reports to whom, from each person's "Reports to" (set by admins). Anyone
  without one appears under their department's owner. Filter to one department.
- **Deletion log.** Every deletion is recorded with who and when before anything is removed,
  in a SharePoint list only admins can read (see *Deletion log*).
- **Workload.** A live card per person: open tasks, booked hours for the next 7 days and 4
  weeks against capacity, overdue and blocked counts, and upcoming deadlines.
- **Relationships.** Link projects to external contacts and organizations from the
  Relationship Tracker, grouped as Government, Industry, and Research Partners, and Media.
  Sync pulls name and organization changes from the tracker and sends project involvement
  back.
- **Planning and Ask.** The Planning page builds daily, weekly, monthly, and yearly plans from
  FSI's own history. The Ask page answers plain-English questions about the data. Both run
  through Claude once an admin connects it (see *Connecting Claude*). Until then, Planning
  uses built-in rules over the same history, and Ask shows what data Claude will read.

## Roles

| Role | Can do |
|------|--------|
| Admin | Everything: departments, sub-departments, output types, people, deleting anything, and the deletion log |
| Department Task Lead | Keeps the data for their assigned departments (and sub-departments): adds, edits, and deletes there. Reports to the department owner |
| Staff | Adds projects and tasks; edits projects they own or have joined. Cannot delete |
| Viewer | Read-only |

**Department owners** (set on Admin, Departments) are the senior person in each department.
They can edit every project in their department and its sub-departments, but deleting is
for admins and Department Task Leads only. Anyone signed in but missing from the People list
gets read-only access until an admin adds them.

"Deleting" covers projects, tasks, task links, people on projects and events, project links,
handoff stages, and relationship links. People are never deleted: an admin marks them
inactive instead.

## Where the data lives

Setup creates these lists on the SharePoint site. People can open them in SharePoint, but
should not rename the lists or their columns.

| List | Holds |
|------|-------|
| FSI Departments | Departments and sub-departments, with owners |
| FSI People | Staff, role, department, weekly capacity |
| FSI Output Types | The editable list of output types |
| FSI Projects | Projects |
| FSI Tasks | Tasks, events, and milestones |
| FSI Task Dependencies | Which task waits on which |
| FSI Project People | Invitations and membership for projects and events |
| FSI Project Links | Projects linked to other projects |
| FSI Project Stages | Handoff stages |
| FSI Project Relationships | Links to Relationship Tracker contacts and organizations |
| FSI Budget Log | Every budget and spend change |
| FSI Audit Log | Every change, with reasons for date changes |
| FSI Meeting Notes | Meeting notes |
| FSI Deletion Log | Every deletion: what, who, when, and a copy of the deleted records. Admins only |

Dates are stored as plain text (`2026-11-03`) so a deadline never shifts with time zones.
Lists and items belong to the **site**, not to a folder. The Teams folder link for this app
points at the site's document library; the app uses the site address
`https://frontiersecurityinstitute11.sharepoint.com/sites/FSITaskTrackerApp`.

## Deletion log

Before the app deletes anything, it writes an entry to the **FSI Deletion Log** list: what was
deleted, the person's name and Microsoft email, the time, and a copy of the deleted records
(so an admin can restore them by hand). If the entry cannot be written, nothing is deleted.
Deletions do not appear in the project History tab, which everyone can see.

In the app, only admins see the log (Admin, Deletion log). To keep it admin-only in
SharePoint itself, a site owner turns on item-level permissions once:

1. Open the FSI Task Tracker site, then **Site contents**, then **FSI Deletion Log**.
2. Click the gear icon, then **List settings**, then **Advanced settings**.
3. Under **Item-level Permissions**, set **Read access** to *Read items that were created by
   the user* and **Create and Edit access** to *Create items and edit items that were created
   by the user*. Click **OK**.

After that, someone who deletes can add log entries but sees only their own. Site owners see
every entry.

Two things to know:

- **App admins need to be SharePoint site owners** to read every entry. The app's Admin role
  does not change SharePoint permissions.
- **Members with "Edit" permission can change list settings**, including this one, and could
  edit their own entries directly in SharePoint. List version history keeps the original
  either way. For a stricter setup, change the site's Members group to the **Contribute**
  permission level (Site settings, Site permissions), which can add and edit items but not
  change list settings.

**Upgrading a site set up before this version:** the first admin to open the app sees **Set up
site** again. Clicking it adds the new list and the new People columns (Reports to, lead
departments). Nothing existing is changed.

## One-time setup

You need someone who can register apps in FSI's Microsoft 365 tenant. No Azure subscription is
required.

### 1. Register the app in Microsoft Entra ID

1. Open the Microsoft Entra admin center (entra.microsoft.com), then **App registrations**,
   then **New registration**.
2. Name: `FSI Projects`. Supported account types: **Accounts in this organizational directory
   only**.
3. Redirect URI: platform **Single-page application (SPA)**, address
   `https://isaacah-source.github.io/Task-Tracking-Application-/` (keep the trailing slash).
   Add `http://localhost:5176/` as a second SPA redirect URI for testing on a laptop.
4. Under **API permissions**, add Microsoft Graph **delegated** permissions `User.Read`,
   `Sites.ReadWrite.All`, and `Sites.Manage.All`, then click **Grant admin consent**.
   `Sites.Manage.All` lets an admin create the lists during setup. Everyday use needs only
   `Sites.ReadWrite.All`.
5. From **Overview**, copy the **Application (client) ID** and **Directory (tenant) ID**.

The app acts as the signed-in person. It reaches only what that person can open in
SharePoint.

### 2. Publish with GitHub Pages

1. In this repository, open **Settings**, **Pages**, and set **Source** to **GitHub Actions**.
2. Open **Settings**, **Secrets and variables**, **Actions**, **Variables**, and add:

   | Variable | Value |
   |----------|-------|
   | `FSI_TENANT_ID` | Directory (tenant) ID from step 1 |
   | `FSI_CLIENT_ID` | Application (client) ID from step 1 |
   | `FSI_SITE_URL` | `https://frontiersecurityinstitute11.sharepoint.com/sites/FSITaskTrackerApp` |
   | `FSI_SETUP_ADMINS` | Optional: comma-separated emails allowed to run first-time setup |

3. Push to `main`, or run **Deploy to GitHub Pages** from the **Actions** tab.

None of these values is a secret. Microsoft only lets a person in after sign-in, and only
shows them the site if they belong to it.

### 3. Set up and invite people

1. Open the app and sign in. Click **Set up site**. Microsoft may ask you to approve the
   permission to create lists. Setup creates the lists, adds the four standard departments
   and five output types, and makes you the first admin.
2. Make sure staff are members of the FSI Task Tracker site (or its Team). Members can edit;
   visitors can only read.
3. On **Admin, People and roles**, add each person with their Microsoft email, role,
   department, and weekly hours. On **Admin, Departments**, set each department's owner and
   add Resourcing under Ops.

## Connecting Claude

The Planning and Ask pages call Claude through `src/integrations/ai/provider.ts`. A static
site cannot keep an API key secret, so Claude needs a small proxy: an Azure Function or
Cloudflare Worker that holds FSI's Anthropic key, checks the caller's Microsoft sign-in token,
and forwards the request to the Anthropic Messages API.

To connect it:

1. Deploy the proxy with the key as a secret.
2. Write a class implementing `AIProvider` that posts `buildAnalysisRequest(...)` or
   `buildPlanningRequest(...)` to the proxy, and return it from `getAIProvider()`.

`buildHistory()` in `src/integrations/ai/history.ts` assembles the structured history Claude
reads: each project's tasks, date changes and their reasons, budget changes, stage handoffs,
and per-output-type averages for duration, slip, and budget variance.

## Relationship Tracker

The Relationship Tracker has no API yet. All contact with it goes through the
`RelationshipTracker` interface in `src/integrations/relationships/adapter.ts`:

- `listContacts()` and `listOrganizations()` pull from the tracker.
- `pushInvolvement()` sends which projects involve each contact, including links that were
  removed.

`MockRelationshipTracker` stands in for now. A real adapter could read and write the tracker
workbook through Microsoft Graph the same way the Relationship Tracker app does, or call its
API once one exists. `groupForType()` maps the tracker's relationship types (Policy/NatSec/Gov,
Congress, AI Labs, Media, ...) onto this app's four groups.

## Development

```bash
npm install
npm run dev        # http://localhost:5176/?demo  (sample data, no sign-in)
npm test           # rules, data layer, SharePoint mapping, sync, planner
npm run typecheck
npm run build
```

To run against SharePoint locally, copy `config.example.json` to `public/config.json`, fill in
the tenant ID, client ID, and site URL, and open `http://localhost:5176/`.

Code layout:

- `src/domain/`: business rules with no UI or storage code. `dependencies.ts` (order,
  blocking, loops, shifting), `conflicts.ts` (meeting assignment checks), `load.ts`
  (workload), `flags.ts` (due flags, review windows), `transitions.ts` (stage handoffs),
  `permissions.ts`.
- `src/data/repository.ts`: every change goes through here. Enforces the rules, writes the
  audit and budget logs, and requires reasons for date changes.
- `src/data/graphBackend.ts`: SharePoint lists through Microsoft Graph, including setup.
- `src/data/memoryBackend.ts` and `src/data/seed.ts`: demo mode and tests.
- `src/integrations/`: Relationship Tracker adapter and the Claude provider.
- `src/pages/`, `src/components/`: the UI (React, Tailwind, shadcn/ui components).
