import { Captions } from "lucide-react";
import type { DataSet, MeetingNote } from "@/domain/types";
import { MEETING_TYPE_LABELS } from "@/domain/types";
import { formatDate } from "@/domain/dates";
import { deptName } from "@/components/common";

/** One meeting note in a list: title, date, type, and department. */
export function MeetingRow({ meeting, data, onOpen }: { meeting: MeetingNote; data: Pick<DataSet, "departments">; onOpen: () => void }) {
  return (
    <li>
      <button className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-left hover:bg-accent/50" onClick={onOpen}>
        <span className="font-medium">
          {meeting.title}
          {meeting.teamsMeetingId && <Captions className="ml-1.5 inline h-3.5 w-3.5 text-muted-foreground" aria-label="Teams transcription" />}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatDate(meeting.date)} · {MEETING_TYPE_LABELS[meeting.meetingType]}
          {meeting.departmentId ? ` · ${deptName(data, meeting.departmentId)}` : ""}
        </span>
      </button>
    </li>
  );
}

/** Newest first; same-day notes by most recently added. */
export function byDateDesc(a: MeetingNote, b: MeetingNote): number {
  return b.date.localeCompare(a.date) || Number(b.id) - Number(a.id);
}
