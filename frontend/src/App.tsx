import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleHelp, Compass, GitCompareArrows, Layers3, Sparkles } from "lucide-react";
import { breakEvenDemoDecision, campusDemoDecision, subscriptionDemoDecision, usesLongTermStory, qualitativeDemoDecision, simulate, validateDecision, type Decision } from "./domain";
import { generateScenario } from "./lib/api";
import { useAppStore } from "./store";
import { NumericEditor } from "./components/NumericEditor";
import { Badge, Button, Card } from "./components/ui";
import { Dashboard } from "./components/Dashboard";
import type { SavedStory, StorySetup } from "./components/StoryPanel";

type Screen = "input" | "review" | "dashboard";
const defaultStorySetup = (): StorySetup => ({ mode: "campus", arrivalTime: "09:00", departureTime: "21:00", travel: {} });

function AppHeader({ screen, qualitative, hasStory, onHome }: { screen: Screen; qualitative: boolean; hasStory: boolean; onHome: () => void }) {
  const steps = qualitative ? ["Decision", "Factors", "Stories"] : ["Decision", "Review", "Explore"];
  const active = screen === "input" ? 0 : qualitative ? hasStory ? 2 : 1 : screen === "review" ? 1 : 2;
  return (
    <header className="border-b border-line/80 bg-white/80 backdrop-blur-xl">
      <div className="page-wrap flex min-h-[76px] items-center justify-between gap-4">
        <button type="button" onClick={onHome} className="flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200" aria-label="Dayfork home">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white"><Layers3 size={19} strokeWidth={2.3} /></span>
          <span className="text-lg font-extrabold tracking-[-.055em] text-ink">day<span className="text-near">fork</span><span className="text-near">.</span></span>
        </button>
        <nav aria-label="Progress" className="hidden items-center gap-2 sm:flex">
          {steps.map((step, index) => <span key={step} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${index === active ? "bg-blue-50 text-near" : index < active ? "text-ink" : "text-muted"}`}><span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${index < active ? "border-near bg-near text-white" : index === active ? "border-near text-near" : "border-slate-300"}`}>{index < active ? <Check size={12} /> : index + 1}</span>{step}</span>)}
        </nav>
        <Badge className="bg-emerald-50 text-emerald-700">Local MVP</Badge>
      </div>
    </header>
  );
}

function InputScreen({ onLoaded }: { onLoaded: (decision: Decision) => void }) {
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const submit = async () => {
    if (!description.trim()) { setError("Describe a decision to begin."); return; }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const generated = await generateScenario(description.trim(), controller.signal);
      if (controller.signal.aborted) return;
      const issues = validateDecision(generated);
      if (issues.length) throw new Error("The generated scenario could not be validated. Please try again.");
      onLoaded(generated);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Scenario generation failed. Please try again.");
    } finally { setBusy(false); }
  };

  return (
    <main className="page-wrap pb-24 pt-14 sm:pt-20">
      <div className="mx-auto max-w-4xl text-center">
        <Badge className="mb-6 border border-blue-100 bg-white px-3 py-1.5 text-near shadow-sm"><Sparkles size={13} className="mr-1.5" /> A clearer view of your next choice</Badge>
        <h1 className="display mx-auto max-w-3xl text-5xl font-extrabold leading-[1.1] text-ink sm:text-6xl lg:text-[4.7rem]">Two paths.<br /><span className="bg-gradient-to-r from-near to-far bg-clip-text text-transparent">One clearer picture.</span></h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-8 text-muted sm:text-lg">Explore a decision that shapes what comes next. Choose the factors that matter and see how both paths could unfold.</p>
      </div>
      <Card className="relative mx-auto mt-12 max-w-3xl overflow-hidden p-5 sm:p-8">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-near via-sky-400 to-far" />
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-xl bg-blue-50 p-2.5 text-near"><Compass size={21} /></div>
          <div><h2 className="text-lg font-bold text-ink">What decision are you weighing?</h2><p className="mt-1 text-sm text-muted">Describe your two options, your circumstances, and what matters to you.</p></div>
        </div>
        <label htmlFor="decision-input" className="sr-only">Describe your decision</label>
        <textarea id="decision-input" value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy} placeholder="For example, should I get a gaming laptop or an office laptop for work and occasional gaming?" rows={5} className="w-full rounded-xl border border-line bg-slate-50/50 p-4 text-sm leading-7 text-ink outline-none transition placeholder:text-slate-400 focus:border-near focus:ring-4 focus:ring-blue-100" />
        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <span className="text-xs leading-5 text-muted">Numbers are included when they meaningfully describe your decision.</span>
          <Button variant="blue" onClick={submit} disabled={busy || !description.trim()}>{busy ? "Building your scenario…" : "Explore this decision"}<ArrowRight size={17} /></Button>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4"><span className="mr-1 text-xs font-semibold text-muted">Offline demos</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setError(null); onLoaded(structuredClone(subscriptionDemoDecision)); }}>Annual vs. monthly membership <ArrowUpRight size={14} /></Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setError(null); onLoaded(structuredClone(breakEvenDemoDecision)); }}>Coffee machine vs. buying coffee <ArrowUpRight size={14} /></Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setError(null); onLoaded(structuredClone(qualitativeDemoDecision)); }}>Gaming vs. office laptop <ArrowUpRight size={14} /></Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setError(null); onLoaded(structuredClone(campusDemoDecision)); }}>Campus housing <ArrowUpRight size={14} /></Button></div>
      </Card>
      <div className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
        {[{ icon: GitCompareArrows, title: "Compare two paths", text: "Explore alternatives with lasting effects." }, { icon: Layers3, title: "Choose your factors", text: "Select the conditions that fit your life." }, { icon: Sparkles, title: "Read parallel stories", text: "See both choices in shared circumstances." }].map(({ icon: Icon, title, text }) => <div key={title} className="flex items-start gap-3 rounded-xl border border-line/70 bg-white/70 p-4"><Icon size={19} className="mt-0.5 shrink-0 text-near" /><div><p className="text-sm font-bold text-ink">{title}</p><p className="mt-1 text-xs leading-5 text-muted">{text}</p></div></div>)}
      </div>
    </main>
  );
}

function BaselineReview({ decision, onBack, onContinue }: { decision: Decision; onBack: () => void; onContinue: () => void }) {
  const result = useMemo(() => simulate(decision, []), [decision]);
  return (
    <main className="page-wrap pb-24 pt-9">
      <Button variant="ghost" className="-ml-3" onClick={onBack}><ArrowLeft size={16} /> Back to decision</Button>
      <div className="mt-8 max-w-3xl"><span className="section-label">Step 02 · Review the inputs</span><h1 className="display mt-3 text-4xl font-extrabold leading-tight text-ink sm:text-5xl">Make the numbers yours.</h1><p className="mt-4 text-base leading-7 text-muted">Check the monthly baseline for each option. Fill missing values and confirm any example assumptions before comparing.</p></div>
      <Card className="mt-8 flex flex-col gap-3 border-blue-100 bg-blue-50/40 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold text-ink">{decision.title}</p><p className="mt-1 text-sm text-muted">{decision.description}</p></div><Badge className="w-fit bg-white text-near">USD · Monthly</Badge></Card>
      <div className="mt-7 grid gap-5 lg:grid-cols-2">
        {decision.options.map((option, optionIndex) => <Card key={option.id} className="overflow-hidden"><div className={`h-1.5 ${optionIndex === 0 ? "bg-near" : "bg-far"}`} /><div className="p-5 sm:p-7"><div className="mb-6 flex items-center justify-between"><div><p className="section-label">Option {optionIndex === 0 ? "A" : "B"}</p><h2 className="mt-2 text-2xl font-bold text-ink">{option.name}</h2></div><span className={`h-10 w-10 rounded-2xl ${optionIndex === 0 ? "bg-blue-50" : "bg-teal-50"}`} /></div>
          <div className="space-y-6">
            {option.fixedCosts.length > 0 && <section><h3 className="mb-3 text-sm font-bold text-ink">Fixed monthly costs</h3><div className="space-y-3">{option.fixedCosts.map((cost, costIndex) => <NumericEditor key={cost.id} label={cost.name} field={cost.amountCentsMonthly} path={["options", optionIndex, "fixedCosts", costIndex, "amountCentsMonthly"]} unit="USD / month" scale={100} />)}</div></section>}
            {option.activities.map((activity, activityIndex) => { const base: (string | number)[] = ["options", optionIndex, "activities", activityIndex]; const factor = activity.frequencyInput?.eventsPerUnit ?? 1; const label = activity.frequencyInput?.label ?? "Events / month"; return <section key={activity.id}><h3 className="mb-3 text-sm font-bold text-ink">{activity.name}</h3><div className="space-y-3"><NumericEditor label="Frequency" field={activity.eventsPerMonth} path={[...base, "eventsPerMonth"]} unit={label.toLowerCase().includes("month") ? label : `${label} / month`} scale={factor} note={factor > 1 ? `Each input unit equals ${factor} ${activity.eventUnit === "one_way_trip" ? "one-way trips" : `${activity.eventUnit}s`}.` : undefined} /><NumericEditor label="Cost per event" field={activity.costCentsPerEvent} path={[...base, "costCentsPerEvent"]} unit="USD / event" scale={100} /><NumericEditor label="Time per event" field={activity.minutesPerEvent} path={[...base, "minutesPerEvent"]} unit="min / event" /></div></section>; })}
          </div>
        </div></Card>)}
      </div>
      <div className="mt-7 flex flex-col items-start justify-between gap-4 rounded-2xl border border-line bg-white p-5 sm:flex-row sm:items-center"><div className="flex items-start gap-3"><CircleHelp size={19} className={result.status === "valid" ? "mt-0.5 text-far" : "mt-0.5 text-amber-600"} /><div><p className="text-sm font-bold text-ink">{result.status === "valid" ? "Ready to explore" : result.status === "invalid" ? `${result.issues.length} item${result.issues.length === 1 ? "" : "s"} need attention` : "Ready to explore"}</p><p className="mt-1 text-xs leading-5 text-muted">{result.status === "valid" ? "You can still edit these numbers later." : result.status === "invalid" ? result.issues[0]?.message : "Choose the factors that matter to you."}</p></div></div><Button variant="blue" disabled={result.status !== "valid"} onClick={onContinue}>Compare options <ArrowUpRight size={17} /></Button></div>
    </main>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("input");
  const [savedStory, setSavedStory] = useState<SavedStory | null>(null);
  const [storySetup, setStorySetup] = useState<StorySetup>(defaultStorySetup);
  const decision = useAppStore((state) => state.decision);
  const setDecision = useAppStore((state) => state.setDecision);
  const decisionRef = useRef(decision);
  decisionRef.current = decision;
  const setCurrentStory = (next: SavedStory | null) => {
    if (next === null || next.snapshotDecisionId === decisionRef.current?.id) setSavedStory(next);
  };
  const openDecision = (next: Decision) => { decisionRef.current = next; setDecision(next); setSavedStory(null); setStorySetup({ ...defaultStorySetup(), mode: usesLongTermStory(next) ? "qualitative" : next.options.every((option) => option.activities.some((activity) => activity.eventUnit === "one_way_trip")) ? "campus" : "general" }); setScreen(usesLongTermStory(next) ? "dashboard" : "review"); window.scrollTo({ top: 0 }); };
  const navigate = (next: Screen) => { setScreen(next); window.scrollTo({ top: 0 }); };
  return <div className="app-shell"><AppHeader screen={screen} qualitative={!!decision && usesLongTermStory(decision)} hasStory={!!savedStory} onHome={() => navigate("input")} />{screen === "input" || !decision ? <InputScreen onLoaded={openDecision} /> : screen === "review" ? <BaselineReview decision={decision} onBack={() => navigate("input")} onContinue={() => navigate("dashboard")} /> : <Dashboard decision={decision} onReview={() => navigate("review")} onNew={() => navigate("input")} savedStory={savedStory} setSavedStory={setCurrentStory} storySetup={storySetup} setStorySetup={setStorySetup} />}<footer className="border-t border-line/70 bg-white/60 py-7"><div className="page-wrap flex flex-col justify-between gap-2 text-xs text-muted sm:flex-row"><span>Dayfork · Explore your tradeoffs with clarity.</span><span>Stories explore possibilities. Calculations appear when the decision supports them.</span></div></footer></div>;
}
