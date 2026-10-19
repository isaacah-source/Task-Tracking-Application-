import { useMemo, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { useStore } from "@/data/store";
import { getAIProvider, type Answer } from "@/integrations/ai/provider";
import { buildHistory } from "@/integrations/ai/history";
import { PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";

const EXAMPLES = [
  "Which projects are most at risk of missing their due date, and why?",
  "Who is carrying the most work over the next month?",
  "Which projects are heading over budget?",
  "What were the most common reasons for delays this year?",
  "What does Comms have coming up in the next six weeks?",
];

export default function AskPage() {
  const { data, today, toast } = useStore();
  const ai = getAIProvider();
  const [q, setQ] = useState("");
  const [answers, setAnswers] = useState<{ q: string; a: Answer }[]>([]);
  const [busy, setBusy] = useState(false);
  const [showData, setShowData] = useState(false);
  const history = useMemo(() => (showData ? JSON.stringify(buildHistory(data, today), null, 2) : ""), [showData, data, today]);

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const a = await ai.analyze(question.trim(), data, today);
      setAnswers((x) => [{ q: question.trim(), a }, ...x]);
      setQ("");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Ask about the data" description="Ask a question in plain English. Claude answers from FSI's projects, tasks, people, and budgets." />
      {!ai.connected && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Claude is not connected yet. You can try the panel, and see below exactly what data Claude will read once it is.
        </div>
      )}
      <Card className="mb-6">
        <CardContent className="grid gap-3 pt-4">
          <form className="grid gap-3" onSubmit={(e) => (e.preventDefault(), ask(q))}>
            <Textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="For example: which research projects slipped last quarter, and why?" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button type="button" key={ex} className="rounded-full border bg-card px-3 py-1 text-xs hover:bg-accent" onClick={() => setQ(ex)}>{ex}</button>
                ))}
              </div>
              <Button type="submit" disabled={busy || !q.trim()}><MessageSquareText />{busy ? "Thinking..." : "Ask"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {answers.map((x, i) => (
          <Card key={i}>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">{x.q}</CardTitle></CardHeader>
            <CardContent><p className="whitespace-pre-wrap text-sm">{x.a.text}</p></CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <Button variant="link" className="px-0" onClick={() => setShowData((s) => !s)}>{showData ? "Hide" : "Show"} the data Claude reads</Button>
        {showData && <pre className="mt-2 max-h-[480px] overflow-auto rounded-md border bg-card p-3 text-xs">{history}</pre>}
      </div>
    </>
  );
}
