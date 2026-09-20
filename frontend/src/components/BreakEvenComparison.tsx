import { useMemo, useState } from "react";
import { Line, LineChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { GitCompareArrows, Info } from "lucide-react";
import { breakEvenSummary, costAtUses, type CalculationResult, type Decision } from "../domain";
import { formatMoney } from "../domain/format";
import { NumericEditor } from "./NumericEditor";
import { Card, Input } from "./ui";

type BreakEvenResult = Extract<CalculationResult, { status: "break_even" }>;

function UsageChart({ decision, result }: { decision: Decision; result: BreakEvenResult }) {
  const suggestedEnd = result.crossover.kind === "crossing"
    ? Math.min(10_000, Math.max(100, result.crossover.firstWholeUse * 2))
    : 100;
  const [range, setRange] = useState(String(suggestedEnd));
  const end = /^\d+$/.test(range.trim()) ? Number(range) : NaN;
  const validRange = Number.isSafeInteger(end) && end >= 1;
  const chart = useMemo(() => {
    if (!validRange) return null;
    const uses = new Set<number>([0, end]);
    for (let point = 1; point < 30; point++) uses.add(Number(BigInt(end) * BigInt(point) / 30n));
    if (result.crossover.kind === "crossing" && result.crossover.firstWholeUse <= end) {
      uses.add(result.crossover.firstWholeUse);
      uses.add(Math.max(0, result.crossover.firstWholeUse - 1));
    }
    const points = Array.from(uses).sort((first, second) => first - second).map((count) => ({
      uses: count,
      optionA: costAtUses(result.options[0], count),
      optionB: costAtUses(result.options[1], count),
    }));
    return points.some((point) => point.optionA === null || point.optionB === null) ? null : points;
  }, [end, validRange, result]);
  const crossing = result.crossover.kind === "crossing" ? result.crossover.numerator / result.crossover.denominator : null;
  return <Card className="mt-5 p-5 sm:p-7">
    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start"><div><p className="section-label">Cumulative cost</p><h2 className="mt-1 text-xl font-bold text-ink">How costs change with use</h2><p className="mt-2 text-sm leading-6 text-muted">Upfront cost + cost per {decision.usageUnit} × number of uses.</p></div><label className="block w-full max-w-52 text-xs font-semibold text-muted">Show up to this many uses<Input inputMode="numeric" value={range} onChange={(event) => setRange(event.target.value)} aria-label="Chart usage range" aria-invalid={!validRange} className="mt-2" /></label></div>
    {!validRange ? <p role="alert" className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Enter a positive whole number within the supported integer range.</p> : !chart ? <p role="alert" className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">This range produces costs too large to calculate precisely. Use a smaller range to view the chart.</p> : <>
      <div className="mt-7 h-72 min-w-0 w-full" role="img" aria-label={`Cumulative cost over 0 to ${end} uses for ${decision.options[0].name} and ${decision.options[1].name}. ${breakEvenSummary(decision, result)}`}>
        <LineChart responsive style={{ width: "100%", height: "100%", minWidth: 0 }} data={chart} margin={{ top: 12, right: 16, bottom: 26, left: 8 }}><CartesianGrid stroke="#edf1f6" /><XAxis dataKey="uses" type="number" domain={[0, end]} allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#738298", fontSize: 11 }} tickFormatter={(value: number) => value.toLocaleString("en-US")} label={{ value: `Number of uses (${decision.usageUnit})`, position: "insideBottom", offset: -16, fill: "#738298", fontSize: 12 }} /><YAxis tickLine={false} axisLine={false} width={70} tick={{ fill: "#738298", fontSize: 11 }} tickFormatter={(value: number) => `$${(value / 100).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })}`} /><Tooltip labelFormatter={(value) => `${Number(value).toLocaleString("en-US")} uses`} formatter={(value) => formatMoney(Number(value))} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />{crossing !== null && crossing <= end && <ReferenceLine x={crossing} stroke="#94a3b8" strokeDasharray="4 4" />}<Line type="linear" dataKey="optionA" name={decision.options[0].name} stroke="#3f68ef" strokeWidth={3} dot={false} isAnimationActive={false} /><Line type="linear" dataKey="optionB" name={decision.options[1].name} stroke="#13a99b" strokeWidth={3} dot={false} isAnimationActive={false} /></LineChart>
      </div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">{decision.options.map((option, index) => <span key={option.id}><i className={`mr-1.5 inline-block h-2 w-2 rounded-full ${index === 0 ? "bg-near" : "bg-far"}`} />{option.name}</span>)}</div>
      {crossing !== null && crossing > end && <p className="mt-3 text-xs leading-5 text-muted">The cost crossover is beyond the displayed range. Increase the range to include it.</p>}
    </>}
    <p className="mt-5 border-t border-line pt-4 text-xs leading-5 text-muted">The chart uses your entered prices and the same number of uses for both options. Changes to this range stay local.</p>
  </Card>;
}

export function BreakEvenComparison({ decision, calculation }: { decision: Decision; calculation: CalculationResult }) {
  return <section className="mt-8" aria-labelledby="usage-cost-title">
    <div><p className="section-label">Compare at the same level of use</p><h2 id="usage-cost-title" className="display mt-2 text-3xl font-extrabold text-ink">When does the upfront cost pay off?</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Enter the upfront price and the cost of each {decision.usageUnit}. Zero is appropriate only when there is no charge.</p></div>
    <div className="mt-5 grid gap-5 md:grid-cols-2">{decision.options.map((option, index) => <Card key={option.id} className="overflow-hidden"><div className={`h-1.5 ${index === 0 ? "bg-near" : "bg-far"}`} /><div className="p-5 sm:p-6"><h3 className={`mb-5 text-xl font-bold ${index === 0 ? "text-near" : "text-far"}`}>{option.name}</h3>{option.usageCosts && <div className="space-y-3"><NumericEditor label="Upfront cost" field={option.usageCosts.upfrontCents} path={["options", index, "usageCosts", "upfrontCents"]} unit="USD" scale={100} /><NumericEditor label={`Cost per ${decision.usageUnit}`} field={option.usageCosts.perUseCents} path={["options", index, "usageCosts", "perUseCents"]} unit={`USD / ${decision.usageUnit}`} scale={100} /></div>}</div></Card>)}</div>
    {calculation.status === "invalid" && <Card className="mt-5 border-amber-200 bg-amber-50 p-5"><div className="flex items-start gap-3"><Info size={20} className="mt-0.5 shrink-0 text-amber-600" /><div><h3 className="text-sm font-bold text-ink">Complete the prices to compare costs</h3><ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-6 text-amber-800">{calculation.issues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.message}</li>)}</ul></div></div></Card>}
    {calculation.status === "break_even" && <><Card className="mt-5 border-blue-100 bg-gradient-to-r from-blue-50 to-teal-50 p-5 sm:p-7"><div className="flex items-start gap-3"><GitCompareArrows size={20} className="mt-1 shrink-0 text-near" /><div><p className="section-label">Cost crossover</p><p className="mt-2 text-base font-semibold leading-7 text-ink">{breakEvenSummary(decision, calculation)}</p><p className="mt-2 text-xs leading-5 text-muted">A cost comparison is one part of this decision. Choose the other factors below to shape both stories.</p></div></div></Card><UsageChart decision={decision} result={calculation} /></>}
  </section>;
}
