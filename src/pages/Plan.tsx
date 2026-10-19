import { useState } from "react";
import { Copy, Sparkles } from "lucide-react";
import { useStore } from "@/data/store";
import { getAIProvider, PLAN_HORIZON_LABELS, type Plan, type PlanHorizon } from "@/integrations/ai/provider";
import { PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function PlanPage() {
  const { data, today, toast } = useStore();
  const ai = getAIProvider();
  const [horizon, setHorizon] = useState<PlanHorizon>("weekly");
  const [focus, setFocus] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      setPlan(await ai.plan(horizon, data, today, focus.trim()));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const asText = (p: Plan) => [`${PLAN_HORIZON_LABELS[p.horizon]} plan`, p.summary, ...p.sections.flatMap((s) => ["", s.heading, ...s.items.map((i) => `- ${i}`)])].join("\n");

  return (
    <>
      <PageHeader
        title="Planning"
        description="Plans for continuing and future projects, built from FSI's own history: past date changes and why, budget changes, and how long each kind of output took."
      />
      {!ai.connected && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Claude is not connected yet, so plans come from built-in rules using the same history. Once an admin connects Claude, this page will use it with no other change.
        </div>
      )}
      <Card className="mb-6">
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {(Object.keys(PLAN_HORIZON_LABELS) as PlanHorizon[]).map((h) => (
              <button key={h} onClick={() => setHorizon(h)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground", horizon === h && "bg-card text-foreground shadow")}>
                {PLAN_HORIZON_LABELS[h]}
              </button>
            ))}
          </div>
          <Input placeholder={ai.connected ? "Focus (optional): for example, the wargame" : "Focus on a topic (available once Claude is connected)"} value={focus} onChange={(e) => setFocus(e.target.value)} disabled={!ai.connected} />
          <Button onClick={generate} disabled={busy}><Sparkles />{busy ? "Working..." : "Make plan"}</Button>
        </CardContent>
      </Card>

      {plan && (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{plan.summary}</p>
            <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(asText(plan)).then(() => toast("Copied"))}><Copy />Copy as text</Button>
          </div>
          {plan.sections.length === 0 && <p className="text-sm text-muted-foreground">Nothing to plan in this period.</p>}
          <div className="grid gap-4 md:grid-cols-2">
            {plan.sections.map((s) => (
              <Card key={s.heading}>
                <CardHeader><CardTitle>{s.heading}</CardTitle></CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {s.items.map((i, n) => <li key={n}>{i}</li>)}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Made by {plan.generatedBy === "claude" ? "Claude" : "built-in rules"} on {new Date().toLocaleString()}.</p>
        </div>
      )}
    </>
  );
}
