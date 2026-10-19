// React glue: holds the loaded data, the signed-in person, and a `run` helper every screen
// uses to make changes. `run` catches the repository's errors and turns them into the
// right prompt: a "why did the date change?" box, a list of problems, or a toast.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DataSet, Person } from "@/domain/types";
import { today as todayIso } from "@/domain/dates";
import { PermissionError, ReasonRequiredError, Repository, RuleError, fieldLabel } from "./repository";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea, Label } from "@/components/ui/input";
import type { RelationshipTracker } from "@/integrations/relationships/adapter";
import type { ProjectInvolvement } from "@/integrations/relationships/adapter";

interface Toast {
  id: number;
  text: string;
}

export interface Store {
  data: DataSet;
  me: Person | null;
  myEmail: string;
  myName: string;
  repo: Repository;
  today: string;
  mode: "demo" | "sharepoint";
  lastSync: Date | null;
  tracker: RelationshipTracker;
  /** Project links removed since the last relationship sync, so the tracker hears about them. */
  removedInvolvement: ProjectInvolvement[];
  /**
   * Runs a change. `fn` gets a reason ("" at first). If the change needs a reason, the person
   * is asked for one and `fn` runs again with it. Errors become messages. Returns undefined
   * when the change did not happen.
   */
  run: <T>(fn: (reason: string) => Promise<T>, success?: string) => Promise<T | undefined>;
  refresh: () => Promise<void>;
  toast: (text: string) => void;
  signOut: () => void;
  /** Demo only: act as someone else to try roles. */
  switchUser?: (personId: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside DataProvider");
  return s;
}

const POLL_MS = 30_000;

export function DataProvider(props: {
  repo: Repository;
  mode: Store["mode"];
  myName: string;
  tracker: RelationshipTracker;
  signOut: () => void;
  children: ReactNode;
}) {
  const { repo } = props;
  const [data, setData] = useState<DataSet>(repo.data);
  const [me, setMe] = useState<Person | null>(repo.me);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [reasonAsk, setReasonAsk] = useState<{ fields: string[]; resolve: (r: string | null) => void } | null>(null);
  const [reason, setReason] = useState("");
  const removed = useRef<ProjectInvolvement[]>([]);
  const busy = useRef(0);

  const publish = useCallback(() => {
    // New array identities so React re-renders every list.
    setData({ ...repo.data });
    setMe(repo.me);
  }, [repo]);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      await repo.refresh();
      setLastSync(new Date());
      publish();
    } catch (e) {
      toast((e as Error).message);
    }
  }, [repo, publish, toast]);

  // Keep the screen current with changes other people make.
  useEffect(() => {
    if (props.mode !== "sharepoint") return;
    const tick = () => {
      if (document.visibilityState === "visible" && busy.current === 0) void refresh();
    };
    const t = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [props.mode, refresh]);

  const askReason = (fields: string[]) =>
    new Promise<string | null>((resolve) => {
      setReason("");
      setReasonAsk({ fields, resolve });
    });

  const run = useCallback(
    async <T,>(fn: (reason: string) => Promise<T>, success?: string): Promise<T | undefined> => {
      busy.current++;
      try {
        let why = "";
        for (;;) {
          try {
            const out = await fn(why);
            publish();
            if (success) toast(success);
            return out;
          } catch (e) {
            if (e instanceof ReasonRequiredError) {
              const r = await askReason(e.fields);
              if (r === null) return undefined;
              why = r;
              continue;
            }
            throw e;
          }
        }
      } catch (e) {
        publish(); // show whatever part of a multi-step change did save
        if (e instanceof RuleError) setProblems(e.problems);
        else if (e instanceof PermissionError) setProblems([e.message]);
        else setProblems([(e as Error).message || "Something went wrong."]);
        return undefined;
      } finally {
        busy.current--;
      }
    },
    [publish, toast],
  );

  const switchUser = useMemo(
    () =>
      props.mode === "demo"
        ? (id: string) => {
            repo.me = repo.data.people.find((p) => p.id === id) ?? null;
            repo.myEmail = repo.me?.email ?? "";
            publish();
          }
        : undefined,
    [props.mode, repo, publish],
  );

  const store: Store = {
    data,
    me,
    myEmail: repo.myEmail,
    myName: props.myName,
    repo,
    today: todayIso(),
    mode: props.mode,
    lastSync,
    tracker: props.tracker,
    removedInvolvement: removed.current,
    run,
    refresh,
    toast,
    signOut: props.signOut,
    switchUser,
  };

  return (
    <Ctx.Provider value={store}>
      {props.children}

      <Dialog open={!!reasonAsk} onOpenChange={(o) => !o && (reasonAsk?.resolve(null), setReasonAsk(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Why is the date changing?</DialogTitle>
            <DialogDescription>
              {reasonAsk?.fields.map(fieldLabel).join(" and ")} changed. The reason is saved with your name so future planning can learn from it.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason.trim()) return;
              reasonAsk?.resolve(reason.trim());
              setReasonAsk(null);
            }}
          >
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: reviewer needed another week" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => (reasonAsk?.resolve(null), setReasonAsk(null))}>Cancel</Button>
              <Button type="submit" disabled={!reason.trim()}>Save change</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!problems} onOpenChange={(o) => !o && setProblems(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>That change was not saved</DialogTitle>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {problems?.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
          <DialogFooter>
            <Button onClick={() => setProblems(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 md:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} className="rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg">{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
