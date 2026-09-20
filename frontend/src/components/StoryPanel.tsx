import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, Clock3, Compass, GitBranch, Info, Moon, Sparkles, Sun, Sunrise } from "lucide-react";
import {
  buildCampusDaySchedule,
  buildStoryFacts,
  buildQualitativeStoryFacts,
  buildBreakEvenStoryFacts,
  buildSubscriptionStoryFacts,
  usesLongTermStory,
  listTravelChoices,
  type CalculationResult,
  type CampusTravelSelection,
  type Decision,
  type TravelChoice,
  type ValidCalculationResult,
} from "../domain";
import { generateStory, type Story, type StoryContext, type StoryMode, type StoryRequest } from "../lib/api";
import { Badge, Button, Card, Input } from "./ui";
import { createOfflineStory } from "./offlineStories";

export type SavedStory = {
  story: Story;
  facts: Record<string, string>;
  snapshot: StoryRequest["snapshot"];
  source: "model" | "offline preview";
  snapshotVersion: number;
  snapshotDecisionId: string;
  contextSignature: string;
};

type TravelSetup = { activityId: string; outboundChoiceId: string; inboundChoiceId: string };

export type StorySetup = {
  mode: StoryMode;
  arrivalTime: string;
  departureTime: string;
  travel: Record<string, TravelSetup>;
};

const requiredMoments = ["morning", "daytime", "evening"] as const;
const qualitativeMoments = ["beginning", "during", "later"] as const;

function filledStory(story: Story, facts: Record<string, string>): boolean {
  const text = [story.sharedScenario.title, story.sharedScenario.description, ...story.moments.flatMap((moment) => moment.options.map((option) => option.text)), ...story.monthlyReflections.map((reflection) => reflection.text), ...(story.advice ?? []).map((entry) => entry.text)].join(" ");
  return Array.from(text.matchAll(/\{\{([^{}]+)\}\}/g)).every((match) => Object.hasOwn(facts, match[1]));
}

function insertFacts(text: string, facts: Record<string, string>) {
  return text.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (_, id: string) => facts[id] ?? "[unavailable fact]");
}

function matchesStory(story: Story, snapshot: StoryRequest["snapshot"], facts: Record<string, string>): boolean {
  const qualitative = usesLongTermStory(snapshot.decision);
  const keys = qualitative ? qualitativeMoments : requiredMoments;
  const ids = snapshot.decision.options.map((option) => option.id);
  return !!story && story.decisionId === snapshot.decision.id && story.simulationVersion === snapshot.simulationVersion
    && (qualitative ? story.mode === "qualitative" : story.mode !== "qualitative")
    && typeof story.sharedScenario?.title === "string" && story.sharedScenario.title.trim().length > 0 && typeof story.sharedScenario?.description === "string" && story.sharedScenario.description.trim().length > 0
    && Array.isArray(story.moments) && story.moments.length === keys.length
    && story.moments.every((moment, index) => !!moment && moment.key === keys[index] && Array.isArray(moment.options)
      && moment.options.length === ids.length && ids.every((id) => moment.options.filter((option) => !!option && option.optionId === id && typeof option.text === "string" && option.text.trim().length > 0).length === 1))
    && Array.isArray(story.monthlyReflections)
    && (qualitative ? story.monthlyReflections.length === 0 : story.monthlyReflections.length === ids.length && ids.every((id) => story.monthlyReflections.filter((reflection) => !!reflection && reflection.optionId === id && typeof reflection.text === "string" && reflection.text.trim().length > 0).length === 1))
    && (story.advice === undefined || Array.isArray(story.advice) && story.advice.length === ids.length && ids.every((id) => story.advice!.filter((entry) => !!entry && entry.optionId === id && typeof entry.text === "string" && entry.text.trim().length > 0).length === 1))
    && filledStory(story, facts);
}

function resolveTravelSetup(decision: Decision, result: ValidCalculationResult, optionIndex: number, preferred?: TravelSetup) {
  const option = decision.options[optionIndex];
  const available = option.activities.filter((activity) => activity.eventUnit === "one_way_trip")
    .map((activity) => ({ activityId: activity.id, choices: listTravelChoices(decision, result, option.id, activity.id) }))
    .filter((entry) => entry.choices.length > 0);
  const chosen = available.find((entry) => entry.activityId === preferred?.activityId) ?? available[0];
  if (!chosen) return null;
  const outbound = chosen.choices.find((choice) => choice.id === preferred?.outboundChoiceId) ?? chosen.choices.find((choice) => choice.eventsPerMonth >= 2) ?? chosen.choices[0];
  const inbound = chosen.choices.find((choice) => choice.id === preferred?.inboundChoiceId) ?? (outbound.eventsPerMonth >= 2 ? outbound : chosen.choices.find((choice) => choice.id !== outbound.id) ?? outbound);
  return { activityId: chosen.activityId, outboundChoiceId: outbound.id, inboundChoiceId: inbound.id, choices: chosen.choices, available };
}

function StoryView({ saved, stale }: { saved: SavedStory; stale: boolean }) {
  const { story, facts } = saved;
  const decision = saved.snapshot.decision;
  const qualitative = usesLongTermStory(decision);
  const moments = (qualitative ? qualitativeMoments : requiredMoments).map((key) => story.moments.find((moment) => moment.key === key));
  const [activeStage, setActiveStage] = useState(0);
  const stageId = useId();
  const stageRefs = useRef<Array<HTMLElement | null>>([]);
  useEffect(() => { setActiveStage(0); }, [saved.story]);
  const labels: Record<Story["moments"][number]["key"], string> = { beginning: "Beginning", during: "During", later: "Later", morning: "Morning", daytime: "Daytime", evening: "Evening" };
  const jumpToStage = (index: number) => {
    setActiveStage(index);
    const target = stageRefs.current[index];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };
  const pairedText = (entries: Array<{ optionId: string; text: string }>) => <div className="grid gap-4 md:grid-cols-2">{decision.options.map((option, optionIndex) => <div key={option.id} className={`rounded-xl border p-4 sm:p-5 ${optionIndex === 0 ? "border-blue-100 bg-blue-50/40" : "border-teal-100 bg-teal-50/40"}`}><p className={`mb-2 text-xs font-extrabold uppercase tracking-wider ${optionIndex === 0 ? "text-near" : "text-far"}`}>{option.name}</p><p className="text-sm leading-7 text-ink">{insertFacts(entries.find((entry) => entry.optionId === option.id)?.text ?? "", facts)}</p></div>)}</div>;
  return <Card className="mt-6 overflow-hidden">
    <div className="border-b border-line bg-gradient-to-r from-blue-50 to-teal-50 p-6 sm:p-8"><div className="flex flex-wrap items-center gap-2"><Badge className="bg-white text-near">{saved.source === "model" ? "Generated story" : "Offline example preview"}</Badge>{stale && <Badge className="bg-amber-100 text-amber-800">Your configuration has changed</Badge>}</div><h3 className="display mt-4 text-2xl font-extrabold text-ink sm:text-3xl">{insertFacts(story.sharedScenario.title, facts)}</h3><p className="mt-2 max-w-2xl text-sm leading-7 text-muted">{insertFacts(story.sharedScenario.description, facts)}</p>{stale && <p className="mt-4 text-xs font-semibold text-amber-800">This story reflects an earlier configuration. Select Update Story to refresh it.</p>}</div>
    <nav aria-label="Story path timeline" className="border-b border-line bg-slate-50/60 p-6 sm:p-8"><div className="mb-5"><p className="section-label">Two paths · Shared stages</p><p className="mt-2 text-xs leading-5 text-muted">Choose a stage to follow both paths at the same moment.</p></div><div className="space-y-5">{decision.options.map((option, optionIndex) => <div key={option.id} className="grid gap-3 sm:grid-cols-[minmax(0,180px)_1fr] sm:items-center"><p className={`text-sm font-bold ${optionIndex === 0 ? "text-near" : "text-far"}`}>{option.name}</p><div className="relative grid grid-cols-3 gap-2" role="group" aria-label={`${option.name} stages`}><div aria-hidden="true" className={`absolute left-[16%] right-[16%] top-3.5 h-0.5 ${optionIndex === 0 ? "bg-blue-200" : "bg-teal-200"}`} />{moments.map((moment, index) => moment && <button key={moment.key} type="button" onClick={() => jumpToStage(index)} aria-label={`Read ${labels[moment.key]} for ${option.name}`} aria-controls={`${stageId}-${moment.key}`} aria-pressed={activeStage === index} className={`relative flex min-w-0 flex-col items-center gap-2 rounded-lg px-1 py-0.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 ${activeStage === index ? optionIndex === 0 ? "text-near" : "text-far" : "text-muted"}`}><span aria-hidden="true" className={`z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white ${activeStage === index ? optionIndex === 0 ? "border-near" : "border-far" : optionIndex === 0 ? "border-blue-200" : "border-teal-200"}`}><span className={`h-2.5 w-2.5 rounded-full ${activeStage === index ? optionIndex === 0 ? "bg-near" : "bg-far" : "bg-white"}`} /></span><span>{labels[moment.key]}</span></button>)}</div></div>)}</div></nav>
    <div className="divide-y divide-line">{moments.map((moment, index) => {
      if (!moment) return null;
      const Icon = qualitative ? index === 0 ? Compass : index === 1 ? GitBranch : ArrowUpRight : index === 0 ? Sunrise : index === 1 ? Sun : Moon;
      return <section key={moment.key} id={`${stageId}-${moment.key}`} ref={(element) => { stageRefs.current[index] = element; }} tabIndex={-1} aria-label={labels[moment.key]} className={`scroll-mt-6 p-6 outline-none transition-colors focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-100 sm:p-8 ${activeStage === index ? "bg-slate-50/70" : ""}`}><div className="mb-5 flex items-center gap-2 text-sm font-bold text-ink"><Icon size={17} className="text-near" />{labels[moment.key]}{activeStage === index && <span className="ml-auto text-[11px] font-semibold text-muted">Selected stage</span>}</div>{pairedText(moment.options)}</section>;
    })}
      {!qualitative && story.monthlyReflections.length > 0 && <section className="p-6 sm:p-8"><div className="mb-5 flex items-center gap-2 text-sm font-bold text-ink"><Clock3 size={17} className="text-near" />Monthly reflection</div>{pairedText(story.monthlyReflections)}</section>}
      {story.advice && story.advice.length > 0 && <section className="p-6 sm:p-8" aria-label="Next steps for each path"><div className="mb-5"><p className="section-label">From the story to a next step</p><h4 className="mt-2 text-xl font-bold text-ink">Next steps for each path</h4><p className="mt-2 text-xs leading-5 text-muted">Practical actions to test the fit of either choice before committing.</p></div>{pairedText(story.advice)}</section>}
    </div>
  </Card>;
}

export function StoryPanel({ decision, calculation, enabledTagIds, simulationVersion, saved, setSaved, setup, setSetup }: { decision: Decision; calculation: CalculationResult; enabledTagIds: string[]; simulationVersion: number; saved: SavedStory | null; setSaved: (story: SavedStory | null) => void; setup: StorySetup; setSetup: (setup: StorySetup) => void }) {
  const { arrivalTime, departureTime, travel } = setup;
  const qualitative = usesLongTermStory(decision);
  const mode: StoryMode = qualitative ? "qualitative" : setup.mode === "qualitative" ? "general" : setup.mode;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setError(null);
    setBusy(false);
    return () => { activeRequest.current?.abort(); requestId.current++; };
  }, [decision.id]);

  const setups = useMemo(() => calculation.status === "valid" ? decision.options.map((option, index) => resolveTravelSetup(decision, calculation, index, travel[option.id])) : [null, null], [calculation, decision, travel]);
  const typedSetups = setups as [ReturnType<typeof resolveTravelSetup>, ReturnType<typeof resolveTravelSetup>];
  const selections: [CampusTravelSelection, CampusTravelSelection] | null = typedSetups[0] && typedSetups[1] ? decision.options.map((option, index) => ({ optionId: option.id, activityId: typedSetups[index]!.activityId, outboundChoiceId: typedSetups[index]!.outboundChoiceId, inboundChoiceId: typedSetups[index]!.inboundChoiceId })) as [CampusTravelSelection, CampusTravelSelection] : null;
  const choiceGroups: [TravelChoice[], TravelChoice[]] | null = typedSetups[0] && typedSetups[1] ? [typedSetups[0].choices, typedSetups[1].choices] : null;
  const schedule = mode === "campus" && selections && choiceGroups ? buildCampusDaySchedule(arrivalTime, departureTime, selections, choiceGroups) : null;
  const campusAvailable = !!selections && !!choiceGroups;
  const currentSignature = JSON.stringify(mode === "campus" ? { mode, arrivalTime, departureTime, selections } : { mode });
  const stale = !!saved && (saved.snapshotVersion !== simulationVersion || saved.snapshotDecisionId !== decision.id || saved.contextSignature !== currentSignature);
  const canGenerate = qualitative ? calculation.status === "qualitative" || calculation.status === "break_even" || calculation.status === "subscription" : calculation.status === "valid" && (mode === "general" || !!schedule);

  const changeTravel = (optionId: string, patch: Partial<TravelSetup>) => {
    const index = decision.options.findIndex((option) => option.id === optionId);
    const chosen = typedSetups[index];
    if (!chosen) return;
    setSetup({ ...setup, travel: { ...travel, [optionId]: { activityId: chosen.activityId, outboundChoiceId: chosen.outboundChoiceId, inboundChoiceId: chosen.inboundChoiceId, ...patch } } });
  };

  const buildCurrent = () => {
    if (calculation.status === "subscription") return { facts: buildSubscriptionStoryFacts(decision, calculation), context: { mode: "qualitative" } as StoryContext };
    if (calculation.status === "break_even") return { facts: buildBreakEvenStoryFacts(decision, calculation), context: { mode: "qualitative" } as StoryContext };
    if (qualitative && calculation.status === "qualitative") return { facts: buildQualitativeStoryFacts(decision), context: { mode: "qualitative" } as StoryContext };
    if (calculation.status !== "valid") return null;
    const currentSchedule = mode === "campus" ? schedule ?? undefined : undefined;
    const facts = buildStoryFacts(decision, calculation, currentSchedule);
    const context: StoryContext = mode === "campus" && selections ? { mode, arrivalTime, departureTime, selections } : { mode: "general" };
    return { facts, context };
  };

  const preview = () => {
    const current = buildCurrent();
    if (!current || !canGenerate) return;
    activeRequest.current?.abort();
    requestId.current++;
    setBusy(false);
    setError(null);
    setSaved({ story: createOfflineStory(decision, enabledTagIds, simulationVersion, calculation, mode === "campus" ? schedule ?? undefined : undefined), facts: current.facts, snapshot: structuredClone({ decision, enabledTagIds, simulationVersion, calculation }), source: "offline preview", snapshotVersion: simulationVersion, snapshotDecisionId: decision.id, contextSignature: currentSignature });
  };

  const generate = async () => {
    const current = buildCurrent();
    if (!current || !canGenerate) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const serial = ++requestId.current;
    const frozen = structuredClone({ decision, enabledTagIds, simulationVersion, calculation });
    setError(null);
    setBusy(true);
    try {
      const story = await generateStory({ snapshot: frozen, context: current.context, facts: current.facts }, controller.signal);
      if (serial !== requestId.current) return;
      if (!matchesStory(story, frozen, current.facts)) throw new Error("The story did not match its simulation snapshot. Please try again.");
      setSaved({ story, facts: current.facts, snapshot: frozen, source: "model", snapshotVersion: frozen.simulationVersion, snapshotDecisionId: frozen.decision.id, contextSignature: JSON.stringify(current.context) });
    } catch (cause) {
      if (serial === requestId.current && !(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Story generation failed. Please try again.");
    } finally { if (serial === requestId.current) setBusy(false); }
  };

  return <section className="mt-14" aria-labelledby="story-title"><div className="mb-6 flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-near"><BookOpen size={20} /></span><div><p className="section-label">Parallel stories</p><h2 id="story-title" className="display mt-1 text-3xl font-extrabold text-ink">{qualitative ? "See how both paths could unfold." : "See both paths in one day."}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{qualitative ? "Explore two storylines at corresponding stages, shaped by the factors you selected." : "Choose a shared setting. The day is illustrative; monthly totals use your full simulation."}</p></div></div>
    <Card className="p-5 sm:p-7">{!qualitative && <div className="flex flex-wrap gap-2" role="group" aria-label="Story setting"><Button variant={mode === "general" ? "blue" : "secondary"} size="sm" onClick={() => setSetup({ ...setup, mode: "general" })}>General day</Button><Button variant={mode === "campus" ? "blue" : "secondary"} size="sm" onClick={() => setSetup({ ...setup, mode: "campus" })}>Campus day</Button></div>}
      {mode === "campus" && <div className="mt-6">{campusAvailable ? <><p className="text-sm font-semibold text-ink">Shared campus schedule</p><p className="mt-1 text-xs leading-5 text-muted">Both options use the same arrival and departure time. Choose one outbound and one inbound trip per option.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-muted">Arrive on campus<Input type="time" className="mt-2" value={arrivalTime} onChange={(event) => setSetup({ ...setup, arrivalTime: event.target.value })} /></label><label className="text-xs font-semibold text-muted">Leave campus<Input type="time" className="mt-2" value={departureTime} onChange={(event) => setSetup({ ...setup, departureTime: event.target.value })} /></label></div><div className="mt-5 grid gap-4 md:grid-cols-2">{decision.options.map((option, index) => { const chosen = typedSetups[index]!; return <div key={option.id} className="rounded-xl border border-line bg-slate-50/50 p-4"><p className={`mb-3 text-sm font-bold ${index === 0 ? "text-near" : "text-far"}`}>{option.name}</p><div className="space-y-3"><label className="block text-xs font-semibold text-muted">Travel activity<select className="mt-1.5 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink focus:outline-none focus:ring-4 focus:ring-blue-100" value={chosen.activityId} onChange={(event) => changeTravel(option.id, { activityId: event.target.value, outboundChoiceId: "", inboundChoiceId: "" })}>{chosen.available.map((entry) => <option key={entry.activityId} value={entry.activityId}>{option.activities.find((activity) => activity.id === entry.activityId)?.name}</option>)}</select></label>{(["outboundChoiceId", "inboundChoiceId"] as const).map((field) => <label key={field} className="block text-xs font-semibold text-muted">{field === "outboundChoiceId" ? "Trip to campus" : "Trip home"}<select className="mt-1.5 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink focus:outline-none focus:ring-4 focus:ring-blue-100" value={chosen[field]} onChange={(event) => changeTravel(option.id, { [field]: event.target.value })}>{chosen.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label} · {choice.minutesPerEvent} min · {choice.eventsPerMonth}/month</option>)}</select></label>)}</div>{schedule && <p className="mt-3 text-xs leading-5 text-muted">Leave home {schedule.options[index].leaveHome} · Home again {schedule.options[index].arriveHome}</p>}</div>; })}</div>{!schedule && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Choose a valid day: departure must follow arrival, and selected travel modes need enough monthly trips. General day is also available.</p>}</> : <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Campus day needs a one-way travel activity and sufficient trips for both options. Choose General day to continue.</div>}</div>}
      {qualitative && <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 text-sm leading-6 text-muted"><p className="font-semibold text-ink">Beginning · During · Later</p><p className="mt-1">Both paths start from the same circumstances. Selected factors guide possible implications without turning them into scores or predictions.</p></div>}
      {mode === "general" && <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50/40 p-4 text-sm leading-6 text-muted"><Info size={17} className="mr-2 inline-block text-near" />Morning, daytime, and evening will share the same circumstances without invented clock times.</div>}
      <div className="mt-6 flex flex-col items-stretch justify-between gap-3 border-t border-line pt-5 sm:flex-row sm:items-center"><p className="text-xs leading-5 text-muted">Stories update only when you request them. Changing factors or numbers does not contact the model.</p><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={preview} disabled={!canGenerate || busy}>View offline example</Button><Button variant="blue" onClick={generate} disabled={!canGenerate || busy}><Sparkles size={16} />{busy ? "Writing stories…" : stale ? "Update Story" : "Generate Stories"}</Button></div></div>
      {calculation.status === "invalid" && <p className="mt-4 text-sm text-amber-700">Correct the configuration before generating a story.</p>}{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </Card>
    {saved && <StoryView saved={saved} stale={stale} />}
  </section>;
}
