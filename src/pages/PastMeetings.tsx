import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Search } from "lucide-react";
import { useStore } from "@/data/store";
import type { ID, MeetingType } from "@/domain/types";
import { MEETING_TYPE_LABELS } from "@/domain/types";
import { departmentTree, isAdmin } from "@/domain/permissions";
import { monthLabel } from "@/domain/dates";
import { DepartmentSelect, Empty, PageHeader } from "@/components/common";
import { MeetingRow, byDateDesc } from "@/components/MeetingRow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";

/**
 * Every past meeting note the person may read (see canSeeMeeting), newest first, by month.
 * Searches titles, typed notes, and transcripts.
 */
export default function PastMeetingsPage() {
  const { data, me, repo, today } = useStore();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<ID | null>(null);
  const [type, setType] = useState<MeetingType | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const notes = useMemo(() => {
    const scope = dept ? departmentTree(dept, data.departments) : null;
    const words = q.trim().toLowerCase();
    return repo.visibleMeetings()
      .filter((m) => m.date <= today)
      .filter((m) => !scope || (m.departmentId && scope.has(m.departmentId)))
      .filter((m) => !type || m.meetingType === type)
      .filter((m) => (!from || m.date >= from) && (!to || m.date <= to))
      .filter((m) => !words || `${m.title}\n${m.notes}\n${m.transcript}`.toLowerCase().includes(words))
      .sort(byDateDesc);
  }, [repo, data, today, q, dept, type, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const months: { label: string; notes: typeof notes }[] = [];
  for (const m of notes) {
    const label = monthLabel(m.date);
    if (months[months.length - 1]?.label === label) months[months.length - 1].notes.push(m);
    else months.push({ label, notes: [m] });
  }

  return (
    <>
      <PageHeader
        title="Past meetings"
        description={isAdmin(me) ? "Every past meeting note, newest first. As an admin you see all of them." : "Past meeting notes you can see: your department's and meetings you were in, newest first."}
        actions={<Button variant="outline" asChild><Link to="/meeting"><ArrowLeft />Meeting notes</Link></Button>}
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search titles, notes, and transcripts" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <DepartmentSelect departments={data.departments} value={dept} onChange={setDept} allowEmpty emptyLabel="All departments" />
        <Select value={type} onChange={(e) => setType(e.target.value as MeetingType | "")}>
          <option value="">All meeting types</option>
          {Object.entries(MEETING_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{notes.length} meeting{notes.length === 1 ? "" : "s"}</p>
      {months.length === 0 ? <Empty>No past meetings match.</Empty> : (
        <div className="grid gap-5">
          {months.map((g) => (
            <section key={g.label}>
              <h2 className="mb-1.5 text-sm font-semibold">{g.label}</h2>
              <Card>
                <CardContent className="p-0">
                  <ul className="divide-y">
                    {g.notes.map((m) => <MeetingRow key={m.id} meeting={m} data={data} onOpen={() => nav(`/meeting?id=${m.id}`)} />)}
                  </ul>
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
