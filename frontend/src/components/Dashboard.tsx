import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, ArrowRight, ArrowUpRight, Clock3, Coins, Edit3, Info, ListFilter, Plus, RotateCcw, WandSparkles } from "lucide-react";
import { isBreakEvenDecision, isSubscriptionDecision, usesLongTermStory, simulate, type Decision, type Tag, type ValidCalculationResult } from "../domain";
import { formatMoney as dollars } from "../domain/format";
import { useAppStore } from "../store";
import { BreakEvenComparison } from "./BreakEvenComparison";
import { SubscriptionComparison } from "./SubscriptionComparison";
import { NumericEditor } from "./NumericEditor";
import { StoryPanel, type SavedStory, type StorySetup } from "./StoryPanel";
import { Badge, Button, Card, importanceLabel, Sheet, SheetContent, SheetTrigger, Toggle } from "./ui";

const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;

function comparisonText(value: number, unit: "cost" | "time", first: string, second: string) {
  if (value === 0) return `${first} and ${second} use the same ${unit === "cost" ? "monthly budget" : "tracked time"}.`;
  const favorable = value > 0 ? first : second;
  const other = value > 0 ? second : first;
  const quantity = unit === "cost" ? dollars(Math.abs(value)) : hours(Math.abs(value));
  return `${favorable} uses ${quantity} less ${unit === "cost" ? "per month" : "tracked time per month"} than ${other}.`;
}

function MetricChart({ decision, calculation, metric }: { decision: Decision; calculation: ValidCalculationResult; metric: "cost" | "time" }) {
  const data = decision.options.map((option, index) => ({ name: option.name, value: metric === "cost" ? calculation.options[index].totalCostCents / 100 : calculation.options[index].totalTimeMinutes / 60, fill: index === 0 ? "#3f68ef" : "#13a99b" }));
  return <Card className="p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><p className="section-label">Monthly comparison</p><h3 className="mt-1 text-lg font-bold text-ink">{metric === "cost" ? "Cost" : "Tracked time"}</h3></div><div className={`rounded-xl p-2.5 ${metric === "cost" ? "bg-blue-50 text-near" : "bg-teal-50 text-far"}`}>{metric === "cost" ? <Coins size={19} /> : <Clock3 size={19} />}</div></div><div className="h-48 min-w-0 w-full" role="img" aria-label={`${metric === "cost" ? "Monthly cost" : "Monthly tracked time"} chart: ${data.map((entry) => `${entry.name} ${entry.value.toFixed(1)}`).join(", ")}`}><BarChart responsive style={{ width: "100%", height: "100%", minWidth: 0 }} data={data} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}><CartesianGrid stroke="#edf1f6" horizontal={false} /><XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: "#9aa8bd", fontSize: 11 }} /><YAxis type="category" dataKey="name" width={100} tickLine={false} axisLine={false} tick={{ fill: "#54657f", fontSize: 11 }} /><Tooltip cursor={{ fill: "#f4f7fb" }} formatter={(value) => `${metric === "cost" ? "$" : ""}${Number(value).toFixed(metric === "cost" ? 0 : 1)}${metric === "time" ? " hr" : ""}`} /><Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={23} /></BarChart></div><div className="mt-2 flex items-center gap-4 text-xs text-muted"><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-near" />{decision.options[0].name}</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-far" />{decision.options[1].name}</span></div></Card>;
}

function TagFields({ tag, tagIndex, decision }: { tag: Tag; tagIndex: number; decision: Decision }) {
  return <div className="space-y-6">{tag.targets.map((target, targetIndex) => {
    const option = decision.options.find((item) => item.id === target.optionId);
    const activity = "activityId" in target ? option?.activities.find((item) => item.id === target.activityId) : undefined;
    const base = ["tags", tagIndex, "targets", targetIndex] as (string | number)[];
    const factor = activity?.frequencyInput?.eventsPerUnit ?? 1;
    return <section key={`${target.optionId}:${"activityId" in target ? target.activityId : "fixed"}`}><div className="mb-3 flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${decision.options[0].id === target.optionId ? "bg-near" : "bg-far"}`} /><h3 className="text-sm font-bold text-ink">{option?.name ?? target.optionId}{activity ? ` · ${activity.name}` : ""}</h3></div><div className="space-y-3">
      {tag.type === "fixed" && "costCentsMonthly" in target && <><NumericEditor label="Extra monthly cost" field={target.costCentsMonthly} path={[...base, "costCentsMonthly"]} unit="USD / month" scale={100} /><NumericEditor label="Extra monthly time" field={target.minutesMonthly} path={[...base, "minutesMonthly"]} unit="min / month" /></>}
      {tag.type !== "fixed" && "eventsPerMonth" in target && <NumericEditor label={tag.type === "add_activity" ? "Added frequency" : tag.type === "reduce_activity" ? "Reduced frequency" : "Replaced frequency"} field={target.eventsPerMonth} path={[...base, "eventsPerMonth"]} unit={tag.type === "replace_activity" ? `${activity?.eventUnit === "one_way_trip" ? "One-way trips" : activity?.eventUnit === "meal" ? "Meals" : activity?.eventUnit === "session" ? "Sessions" : "Events"} / month` : activity?.frequencyInput?.label?.toLowerCase().includes("month") ? activity.frequencyInput.label : `${activity?.frequencyInput?.label ?? "Events"} / month`} scale={tag.type === "replace_activity" ? 1 : factor} note={tag.type !== "replace_activity" && factor > 1 ? `Each input unit equals ${factor} ${activity?.eventUnit === "one_way_trip" ? "one-way trips" : `${activity?.eventUnit ?? "event"}s`}.` : undefined} />}
      {tag.type === "replace_activity" && "costCentsPerEvent" in target && <><NumericEditor label={`${target.replacementName} cost`} field={target.costCentsPerEvent} path={[...base, "costCentsPerEvent"]} unit="USD / event" scale={100} /><NumericEditor label={`${target.replacementName} time`} field={target.minutesPerEvent} path={[...base, "minutesPerEvent"]} unit="min / event" /></>}
    </div></section>;
  })}</div>;
}

function TagCard({ tag, index, decision, enabled }: { tag: Tag; index: number; decision: Decision; enabled: boolean }) {
  const setEnabled = useAppStore((state) => state.setEnabled);
  const setImportance = useAppStore((state) => state.setImportance);
  const qualitative = tag.type === "consideration";
  const label = qualitative ? "Story factor" : tag.type === "fixed" ? "Fixed cost or time" : tag.type === "add_activity" ? "More activity" : tag.type === "reduce_activity" ? "Less activity" : "Replacement";
  const card = <Card className={`flex h-full flex-col p-5 transition-colors ${enabled ? "border-blue-200 bg-blue-50/30" : "hover:border-slate-300"}`}>
    <div className="flex items-start justify-between gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${enabled ? "bg-blue-100 text-near" : "bg-slate-100 text-muted"}`}>{qualitative ? <ListFilter size={19} /> : tag.type === "replace_activity" ? <RotateCcw size={19} /> : tag.type === "fixed" ? <Coins size={19} /> : <Plus size={19} />}</span><Toggle checked={enabled} onCheckedChange={(checked) => setEnabled(tag.id, checked)} label={`${enabled ? "Disable" : "Enable"} ${tag.name}`} /></div>
    <h3 className="mt-4 text-base font-bold text-ink">{tag.name}</h3><p className="mt-1.5 text-xs leading-5 text-muted">{tag.description}</p>
    {qualitative && enabled && <div className="mt-4 space-y-3 border-t border-blue-100 pt-4"><p className="text-xs font-semibold text-muted">Possible implications</p>{tag.targets.map((target) => <div key={target.optionId}><p className={`text-xs font-bold ${target.optionId === decision.options[0].id ? "text-near" : "text-far"}`}>{decision.options.find((option) => option.id === target.optionId)?.name}</p><p className="mt-1 text-xs leading-5 text-muted">{target.consideration}</p></div>)}</div>}
    {qualitative && <div className="mt-4 rounded-xl border border-line bg-white/80 p-3">
      <div className="flex items-start justify-between gap-2"><label htmlFor={`importance-${tag.id}`} className="text-xs font-semibold leading-5 text-ink">How important is this to you?</label>{tag.importance !== undefined && <button type="button" className="text-xs font-semibold text-near hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200" onClick={() => setImportance(tag.id, undefined)} aria-label={`Clear importance for ${tag.name}`}>Clear</button>}</div>
      <input id={`importance-${tag.id}`} type="range" min="1" max="5" step="1" value={tag.importance ?? 3} aria-label={`Importance of ${tag.name}`} aria-valuetext={tag.importance === undefined ? "Not set" : `${importanceLabel(tag.importance)}, ${tag.importance} out of 5`} onChange={(event) => setImportance(tag.id, Number(event.target.value))} onPointerUp={(event) => { if (tag.importance === undefined) setImportance(tag.id, Number(event.currentTarget.value)); }} className="mt-3 w-full cursor-pointer accent-[#3f68ef] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100" />
      <div className="mt-1 flex justify-between text-[11px] text-muted"><span>Less important</span><span>More important</span></div><p className="mt-2 text-xs font-semibold text-near">{tag.importance === undefined ? "Not set" : `${tag.importance}/5 · ${importanceLabel(tag.importance)}`}</p>
    </div>}
    <div className="mt-auto flex items-center justify-between gap-2 pt-4"><Badge>{label}</Badge>{!qualitative && <SheetTrigger asChild><Button variant="ghost" size="sm" className="-mr-2 text-near"><Edit3 size={14} /> Edit</Button></SheetTrigger>}</div>
  </Card>;
  if (qualitative) return card;
  return <Sheet>{card}<SheetContent title={tag.name} description={`${tag.description} Changes apply to the options shown below.`}><div className="mb-6 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className="text-sm font-semibold text-ink">Include this tag</span><Toggle checked={enabled} onCheckedChange={(checked) => setEnabled(tag.id, checked)} label={`${enabled ? "Disable" : "Enable"} ${tag.name}`} /></div><TagFields tag={tag} tagIndex={index} decision={decision} /><p className="mt-8 rounded-xl bg-blue-50 p-4 text-xs leading-6 text-muted">Changes update the comparison instantly. Story text updates only when you request a new story.</p></SheetContent></Sheet>;
}

function Factors({ decision, enabledTagIds }: { decision: Decision; enabledTagIds: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (decision.tags.length === 0) return null;
  const qualitative = usesLongTermStory(decision);
  const visibleTags = expanded || decision.tags.length <= 10 ? decision.tags : decision.tags.slice(0, 10);
  const groups = new Map<string, Tag[]>();
  for (const tag of visibleTags) {
    const group = decision.tags.length > 10 ? tag.group ?? "Other factors" : "";
    groups.set(group, [...(groups.get(group) ?? []), tag]);
  }
  return <section className={qualitative ? "mt-9" : "mt-14"} aria-labelledby="factors-title">
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="section-label">{qualitative ? "Choose your context" : "Make it real"}</p><h2 id="factors-title" className="display mt-2 text-3xl font-extrabold text-ink">{qualitative ? "What matters to your decision?" : "What if things change?"}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{qualitative ? "Select the factors that fit your life. Both storylines will explore your choices under these conditions." : "Turn on the details that matter to you. Edit numerical tags to match your situation; story factors add context."}</p></div><Badge className="w-fit bg-white">{enabledTagIds.length} of {decision.tags.length} factors selected</Badge></div>
    <div id="decision-factors" className="space-y-6">{Array.from(groups, ([group, tags]) => <div key={group}>{group && <h3 className="mb-3 text-sm font-bold text-ink">{group}</h3>}<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{tags.map((tag) => <TagCard key={tag.id} tag={tag} index={decision.tags.findIndex((item) => item.id === tag.id)} decision={decision} enabled={enabledTagIds.includes(tag.id)} />)}</div></div>)}</div>
    {decision.tags.length > 10 && <Button variant="secondary" className="mt-5" aria-expanded={expanded} aria-controls="decision-factors" onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer factors" : `Show all ${decision.tags.length} factors`}</Button>}
    {enabledTagIds.length > 0 && <p className="mt-5 rounded-xl border border-line bg-white px-4 py-3 text-xs leading-6 text-muted"><span className="font-bold text-ink">Your selected context: </span>{decision.tags.filter((tag) => enabledTagIds.includes(tag.id)).map((tag) => `${tag.name}${tag.type === "consideration" && tag.importance !== undefined ? ` (${importanceLabel(tag.importance)})` : ""}`).join(" · ")}</p>}
  </section>;
}

function Breakdown({ decision, calculation }: { decision: Decision; calculation: ValidCalculationResult }) {
  return <Card className="mt-7 p-5 sm:p-7"><div><p className="section-label">Trace every number</p><h2 className="mt-1 text-xl font-bold text-ink">Calculation details</h2><p className="mt-1 text-sm text-muted">Monthly totals are the sum of these line items.</p></div><div className="mt-5 grid gap-4 lg:grid-cols-2">{decision.options.map((option, index) => <details key={option.id} className="rounded-xl border border-line bg-slate-50/50 p-4" open><summary className="cursor-pointer text-sm font-bold text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">{option.name}</summary><div className="mt-4 space-y-3">{calculation.options[index].breakdown.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 border-t border-line pt-3 text-xs"><div><p className="font-semibold text-ink">{item.label}</p><p className="mt-1 text-muted">{item.eventsPerMonth !== undefined ? `${item.eventsPerMonth} events · ${dollars(item.costCentsPerEvent ?? 0)} and ${item.minutesPerEvent ?? 0} min each` : item.kind === "tag_fixed" ? "Fixed tag amount" : "Fixed baseline amount"}</p></div><div className="shrink-0 text-right number"><p className="font-semibold text-ink">{dollars(item.totalCostCents)}</p><p className="mt-1 text-muted">{hours(item.totalTimeMinutes)}</p></div></div>)}<div className="flex justify-between border-t border-line pt-3 text-sm font-bold text-ink"><span>Total</span><span className="number">{dollars(calculation.options[index].totalCostCents)} · {hours(calculation.options[index].totalTimeMinutes)}</span></div></div></details>)}</div></Card>;
}

export function Dashboard({ decision, onReview, onNew, savedStory, setSavedStory, storySetup, setStorySetup }: { decision: Decision; onReview: () => void; onNew: () => void; savedStory: SavedStory | null; setSavedStory: (story: SavedStory | null) => void; storySetup: StorySetup; setStorySetup: (setup: StorySetup) => void }) {
  const enabledTagIds = useAppStore((state) => state.enabledTagIds);
  const simulationVersion = useAppStore((state) => state.simulationVersion);
  const calculation = useMemo(() => simulate(decision, enabledTagIds), [decision, enabledTagIds]);
  const breakEven = isBreakEvenDecision(decision);
  const subscription = isSubscriptionDecision(decision);
  const qualitative = usesLongTermStory(decision);
  return <main className="page-wrap pb-24 pt-8"><div className="mb-7 flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" className="-ml-3" onClick={qualitative ? onNew : onReview}><ArrowLeft size={16} /> {qualitative ? "Back to decision" : "Review baseline"}</Button><Button variant="secondary" size="sm" onClick={onNew}>New decision <ArrowUpRight size={15} /></Button></div><div className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="section-label">{qualitative ? "Your decision" : "Your simulation"}</p><h1 className="display mt-3 max-w-3xl text-4xl font-extrabold leading-tight text-ink sm:text-5xl">{decision.title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{decision.description}</p></div>{(!qualitative || breakEven || subscription) && <Badge className="w-fit bg-white px-3 py-2 shadow-sm">USD · {subscription ? "Billing cycles" : breakEven ? "Per use" : "Per month"}</Badge>}</div>
    {qualitative && <div className="mt-5 flex flex-wrap items-center gap-2 text-sm" aria-label="Decision paths">{decision.options.map((option, index) => <Badge key={option.id} className={`px-3 py-2 ${index === 0 ? "bg-blue-50 text-near" : "bg-teal-50 text-far"}`}>{option.name}</Badge>)}</div>}
    {breakEven && <BreakEvenComparison key={`break-even:${decision.id}`} decision={decision} calculation={calculation} />}
    {subscription && <SubscriptionComparison key={`subscription:${decision.id}`} decision={decision} calculation={calculation} />}
    {!breakEven && !subscription && (calculation.status === "invalid" ? <Card className="mt-8 border-amber-200 bg-amber-50 p-6"><div className="flex items-start gap-3"><Info className="mt-0.5 shrink-0 text-amber-600" size={20} /><div><h2 className="text-base font-bold text-ink">This configuration needs attention</h2><p className="mt-1 text-sm text-muted">Current totals are unavailable until these values are corrected.</p><ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-amber-800">{calculation.issues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.message}</li>)}</ul><Button variant="secondary" size="sm" className="mt-5" onClick={onReview}>Review baseline <ArrowRight size={15} /></Button></div></div></Card> : calculation.status === "valid" ? <><div className="mt-8 grid gap-5 md:grid-cols-2">{decision.options.map((option, index) => <Card key={option.id} className="overflow-hidden"><div className={`h-1.5 ${index === 0 ? "bg-near" : "bg-far"}`} /><div className="p-6 sm:p-7"><div className="flex items-start justify-between"><div><p className="section-label">Option {index === 0 ? "A" : "B"}</p><h2 className="mt-2 text-xl font-bold text-ink">{option.name}</h2></div><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${index === 0 ? "bg-blue-50 text-near" : "bg-teal-50 text-far"}`}><ArrowUpRight size={21} /></span></div><div className="mt-7 grid grid-cols-2 gap-4"><div><p className="text-xs font-semibold text-muted">Monthly cost</p><p className="number mt-2 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{dollars(calculation.options[index].totalCostCents)}</p></div><div><p className="text-xs font-semibold text-muted">Tracked time</p><p className="number mt-2 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{hours(calculation.options[index].totalTimeMinutes)}</p></div></div></div></Card>)}</div><Card className="mt-5 border-blue-100 bg-gradient-to-r from-blue-50 to-teal-50 p-5 sm:p-7"><div className="flex items-start gap-3"><GitCompareArrowsIcon /><div><p className="section-label">What changes</p><h2 className="mt-1 text-lg font-bold text-ink">The difference between these paths</h2><div className="mt-3 space-y-1 text-sm leading-6 text-ink"><p>{comparisonText(calculation.comparison.costDeltaCents, "cost", decision.options[0].name, decision.options[1].name)}</p><p>{comparisonText(calculation.comparison.timeDeltaMinutes, "time", decision.options[0].name, decision.options[1].name)}</p></div></div></div></Card><div className="mt-5 grid gap-5 lg:grid-cols-2"><MetricChart decision={decision} calculation={calculation} metric="cost" /><MetricChart decision={decision} calculation={calculation} metric="time" /></div></> : null)}
    <Factors key={`factors:${decision.id}`} decision={decision} enabledTagIds={enabledTagIds} />
    {calculation.status === "valid" && <Breakdown decision={decision} calculation={calculation} />}
    <StoryPanel decision={decision} calculation={calculation} enabledTagIds={enabledTagIds} simulationVersion={simulationVersion} saved={savedStory} setSaved={setSavedStory} setup={storySetup} setSetup={setStorySetup} />
  </main>;
}

function GitCompareArrowsIcon() { return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-near shadow-sm"><WandSparkles size={19} /></span>; }
