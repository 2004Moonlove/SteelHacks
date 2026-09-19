import { describe, expect, it } from 'vitest';
import { calculateChoice, formatMoney, mergeSuggestedFactors } from './engine';
import { makeDemo, makeManualDecision } from './fixtures';
import { choiceDecisionSchema, factorSchema, materialAnalysisSchema } from './schema';
import type { ChoiceDecision, Factor, MaterialAnalysis, Value } from './types';
const edit = (value: number | string | boolean): Value => ({ value, source: 'user_edit', note: 'User confirmed.' });
const missing = (): Value => ({ value: null, source: 'unknown', note: 'Need to confirm.' });
const costs = (d: ChoiceDecision) => calculateChoice(d).options.map((o) => o.totalCostCents);
const gym = () => makeDemo('gym');
function custom(d: ChoiceDecision, changes: Partial<Factor> = {}): Factor {
  return { id: 'custom', name: 'Custom requirement', reason: 'Explicit user request.', optionIds: d.options.map((o) => o.id), dataType: 'boolean', unit: '', allowedValues: [], direction: 'target', purpose: 'hard', importance: 5, target: { min: null, max: null, desired: true }, values: Object.fromEntries(d.options.map((o) => [o.id, edit(true)])), origin: 'user', confirmed: true, ...changes };
}
describe('Clear Choice deterministic acceptance', () => {
  it.each(['gym', 'housing', 'laptop', 'course'] as const)('validates the %s fixture without concealing its demo source', (kind) => {
    const d = makeDemo(kind); expect(choiceDecisionSchema.safeParse(d).success).toBe(true); expect(d.mode).toBe('demo');
    expect(calculateChoice(d).issues.some((i) => i.includes('Duplicate'))).toBe(false);
  });
  it('keeps manual and unfamiliar course decisions possible with explicit unknowns', () => {
    const d = makeManualDecision(); expect(choiceDecisionSchema.safeParse(d).success).toBe(true);
    expect(calculateChoice(d).options.every((o) => o.totalCostCents === null)).toBe(true);
    const course = makeDemo('course'); expect(course.template).toBe('general');
    expect(calculateChoice(course).comparison.status).toBe('insufficient');
  });
  it('completes the no-material four-month gym comparison', () => {
    const d = gym(), r = calculateChoice(d);
    expect(d.options.every((o) => o.materials.length === 0)).toBe(true);
    expect(costs(d)).toEqual([120000, 60000]); expect(r.comparison.preferredIds).toEqual(['monthly']);
    expect(r.options.map((o) => o.firstPaymentCents)).toEqual([120000, 15000]);
    expect(r.options.map((o) => o.monthlyPaymentCents)).toEqual([0, 15000]);
  });
  it('ties at eight months and changes total-cost preference at nine', () => {
    const d = gym(); d.context.months = edit(8); expect(costs(d)).toEqual([120000, 120000]); expect(calculateChoice(d).comparison.status).toBe('tie');
    d.context.months = edit(9); expect(costs(d)).toEqual([120000, 135000]); expect(calculateChoice(d).comparison.preferredIds).toEqual(['annual']);
    expect(calculateChoice(d).breakEven).toEqual(expect.arrayContaining([expect.objectContaining({ month: 8, kind: 'tie' }), expect.objectContaining({ month: 9, kind: 'switch' })]));
  });
  it('charges annual renewal upfront at month thirteen, including ranking reversal', () => {
    const d = gym(); d.context.months = edit(13); expect(costs(d)).toEqual([240000, 195000]);
    const r = calculateChoice(d); expect(r.options[0].cumulativeCosts.slice(11)).toEqual([{ month: 12, costCents: 120000 }, { month: 13, costCents: 240000 }]);
    expect(r.breakEven.some((b) => b.month === 13 && b.kind === 'switch')).toBe(true);
  });
  it('frequency changes unit cost and tracked time, but not unlimited total-cost ordering', () => {
    const d = gym(), before = calculateChoice(d); d.context.usesPerMonth = edit(20); const after = calculateChoice(d);
    expect(after.options.map((o) => o.totalCostCents)).toEqual(before.options.map((o) => o.totalCostCents));
    expect(after.comparison).toEqual(before.comparison); expect(after.options[0].costPerUseCents).toBe(1500);
    expect(after.options[0].costPerUseCents).not.toBe(before.options[0].costPerUseCents);
    expect(after.options[0].totalMinutes).toBe(4800);
  });
  it('changes only one option for an exclusive price edit, with common-horizon effects on all', () => {
    const d = gym(); d.options[0].costs[0].amount = edit(50000);
    expect(costs(d)).toEqual([50000, 60000]); expect(calculateChoice(d).comparison.preferredIds).toEqual(['annual']);
    d.context.months = edit(13); expect(costs(d)).toEqual([100000, 195000]);
  });
  it('uses first payment, per-use charges, and monthly time from the same current values', () => {
    const d = gym(); d.options[0].costs.push({ id: 'signup', name: 'Sign-up', cadence: 'one_time', amount: edit(1000) }, { id: 'locker', name: 'Locker', cadence: 'per_use', amount: edit(50) });
    d.options[0].minutesPerMonth = edit(10);
    const r = calculateChoice(d).options[0]; expect(r.firstPaymentCents).toBe(121600); expect(r.monthlyPaymentCents).toBe(600); expect(r.totalCostCents).toBe(123400); expect(r.monthlyMinutes).toBe(730); expect(r.totalMinutes).toBe(2920);
    expect(r.cumulativeCosts.at(-1)?.costCents).toBe(r.totalCostCents); expect(r.factorValues['total-cost'].value).toBe(r.totalCostCents);
    expect(r.summary.start).toContain(formatMoney(r.firstPaymentCents, d.currency)); expect(r.summary.horizon).toContain(formatMoney(r.totalCostCents, d.currency)); expect(r.summary.routine).toContain('730 minutes');
  });
  it('summarizes known usage time without filling in unknown additional time', () => {
    const d = gym(); d.context.usesPerMonth = edit(8); d.options[0].minutesPerUse = edit(60); d.options[0].minutesPerMonth = missing();
    let result = calculateChoice(d).options[0];
    expect(result.summary.routine).toContain('Known usage takes 8 hr per month; additional monthly time remains unknown.');
    expect(result.monthlyMinutes).toBeNull(); expect(result.totalMinutes).toBeNull();
    d.context.usesPerMonth = edit(16); result = calculateChoice(d).options[0];
    expect(result.summary.routine).toContain('Known usage takes 16 hr per month; additional monthly time remains unknown.');
    expect(result.monthlyMinutes).toBeNull(); expect(result.totalMinutes).toBeNull();
    expect(d.options[0].minutesPerMonth.value).toBeNull();
    d.options[0].minutesPerUse = missing(); result = calculateChoice(d).options[0];
    expect(result.summary.routine).toContain('Routine time is still unknown.');
    expect(result.summary.routine).not.toContain('Known usage takes');
  });
  it('treats zero or missing usage without dividing by zero or inventing usage', () => {
    const d = gym(); d.context.usesPerMonth = edit(0); let r = calculateChoice(d);
    expect(r.options[0].costPerUseCents).toBeNull(); expect(r.options[0].totalMinutes).toBe(0); expect(costs(d)).toEqual([120000, 60000]);
    d.context.usesPerMonth = missing(); r = calculateChoice(d); expect(r.options[0].totalMinutes).toBeNull(); expect(r.options[0].costPerUseCents).toBeNull(); expect(costs(d)).toEqual([120000, 60000]);
    d.options[0].costs.push({ id: 'per-use', name: 'Per use', cadence: 'per_use', amount: edit(100) }); expect(costs(d)[0]).toBeNull();
  });
  it('does not require irrelevant unknown usage for zero per-use charges or time', () => {
    const d = gym(); d.context.usesPerMonth = missing(); d.options[0].minutesPerUse = edit(0); d.options[0].costs.push({ id: 'free-use', name: 'No usage fee', cadence: 'per_use', amount: edit(0) });
    const r = calculateChoice(d).options[0]; expect(r.totalCostCents).toBe(120000); expect(r.totalMinutes).toBe(0);
  });
  it('rounds estimated per-use monthly costs consistently before extending the horizon', () => {
    const d = gym(); d.context.usesPerMonth = edit(0.5); d.options[0].costs = [{ id: 'per-use', name: 'Per use', cadence: 'per_use', amount: edit(101) }];
    const r = calculateChoice(d).options[0]; expect(r.firstPaymentCents).toBe(51); expect(r.totalCostCents).toBe(204); expect(r.cumulativeCosts.at(-1)?.costCents).toBe(204);
  });
  it('does not treat an empty or incomplete list of charges as free', () => {
    const d = gym(); d.options[0].costs = []; expect(costs(d)[0]).toBeNull();
    d.options[0].costs = [{ id: 'free', name: 'Explicitly no costs', cadence: 'one_time', amount: edit(0) }]; expect(costs(d)[0]).toBe(0);
    d.options[0].costsComplete = false; expect(costs(d)[0]).toBeNull();
  });
  it('retains independently known first payment when the horizon is unknown', () => {
    const d = gym(); d.context.months = missing(); const r = calculateChoice(d).options[0]; expect(r.totalCostCents).toBeNull(); expect(r.firstPaymentCents).toBe(120000); expect(r.cumulativeCosts).toEqual([]);
  });
});
describe('Requirements and explicit preference semantics', () => {
  it('checks a total-horizon budget before preferring a candidate', () => {
    const d = gym(); d.context.budgetCents = edit(70000); let r = calculateChoice(d);
    expect(r.options.map((o) => o.eligibility)).toEqual(['ineligible', 'eligible']); expect(r.comparison.preferredIds).toEqual(['monthly']);
    d.context.budgetCents = edit(50000); r = calculateChoice(d); expect(r.comparison.status).toBe('no_feasible');
    d.options[1].costs[0].amount = missing(); r = calculateChoice(d); expect(r.options[1].eligibility).toBe('pending'); expect(r.comparison.status).toBe('insufficient');
  });
  it('enforces a grounded unit-converted budget just like the explicit user amount', () => {
    const d = gym(); d.originalInput += ' My total budget is CNY 500.';
    d.context.budgetCents = { value: 50000, source: 'derived', quote: 'CNY 500', note: 'CNY 500 converted to 50000 minor units.' };
    const derived = calculateChoice(d); expect(derived.comparison.status).toBe('no_feasible');
    expect(derived.options.every((o) => o.eligibility === 'ineligible')).toBe(true);
    d.context.budgetCents.source = 'user_input'; expect(calculateChoice(d).comparison).toEqual(derived.comparison);
    d.context.budgetCents.source = 'derived'; d.options[1].costs[0].amount = missing();
    expect(calculateChoice(d).options[1].eligibility).toBe('pending');
  });
  it('does not enforce a model-suggested budget as the user requirement', () => {
    const d = gym(); d.context.budgetCents = { value: 0, source: 'model_suggestion', note: 'Proposed.' }; expect(calculateChoice(d).options.every((o) => o.eligibility === 'eligible')).toBe(true);
  });
  it('does not equate an unknown requirement with failure or grant an unconditional winner', () => {
    const d = gym(); d.factors.push(custom(d, { values: { annual: edit(true), monthly: missing() } }));
    const r = calculateChoice(d); expect(r.options.map((o) => o.eligibility)).toEqual(['eligible', 'pending']); expect(r.comparison.preferredIds).toEqual([]); expect(r.comparison.status).toBe('insufficient');
  });
  it('preserves a custom requirement and enforces its explicit application and target', () => {
    const d = gym(); d.factors.push(custom(d, { optionIds: ['annual'], values: { annual: edit(false) } }));
    const r = calculateChoice(d); expect(r.options.map((o) => o.eligibility)).toEqual(['ineligible', 'eligible']); expect(r.comparison.preferredIds).toEqual(['monthly']); expect(d.factors.at(-1)?.values.annual.value).toBe(false);
  });
  it('ignores unconfirmed and model-origin hard proposals until accepted by the user', () => {
    const d = gym(); const f = custom(d, { origin: 'model', values: { annual: edit(false), monthly: edit(false) } }); d.factors.push(f);
    expect(calculateChoice(d).comparison.status).toBe('preferred'); f.origin = 'user'; f.confirmed = false; expect(calculateChoice(d).comparison.status).toBe('preferred'); f.confirmed = true; expect(calculateChoice(d).comparison.status).toBe('no_feasible');
  });
  it('ranks only by a confirmed explicit primary preference, without weighted scores', () => {
    const d = gym(); d.primaryFactorId = null; expect(calculateChoice(d).comparison.status).toBe('unranked');
    d.primaryFactorId = 'total-cost'; d.factors[0].origin = 'model'; expect(calculateChoice(d).comparison.status).toBe('unranked');
    d.factors[0].origin = 'user'; d.factors[0].importance = 1; d.factors[2].importance = 5; expect(calculateChoice(d).comparison.preferredIds).toEqual(['monthly']);
  });
  it('does not count known-looking model suggestion numbers as facts', () => {
    const d = gym(); d.options[0].costs[0].amount = { value: 100, source: 'model_suggestion', note: 'Guess.' }; expect(costs(d)[0]).toBeNull(); expect(calculateChoice(d).comparison.status).toBe('insufficient');
  });
  it('supports exact dates, boolean desired targets, and supplied ordered categories', () => {
    const d = makeDemo('laptop'); d.primaryFactorId = 'ready-date'; expect(calculateChoice(d).comparison.preferredIds).toEqual(['replace']);
    d.primaryFactorId = 'workload'; expect(calculateChoice(d).comparison.preferredIds).toEqual(['replace']);
    d.factors.find((f) => f.id === 'workload')!.allowedValues = []; expect(calculateChoice(d).comparison.status).toBe('unranked');
    const g = gym(); g.primaryFactorId = 'exit-flexibility'; expect(calculateChoice(g).comparison.preferredIds).toEqual(['monthly']);
  });
  it('treats target ranges and deadline constraints deterministically', () => {
    const d = makeDemo('laptop'); const f = d.factors.find((f) => f.id === 'ready-date')!;
    f.purpose = 'hard'; f.origin = 'user'; f.target.max = '2026-09-22'; d.primaryFactorId = 'total-cost'; expect(calculateChoice(d).comparison.preferredIds).toEqual(['replace']);
    const g = gym(); g.factors[0].direction = 'target'; g.factors[0].target = { min: 70000, max: 100000, desired: null }; expect(calculateChoice(g).comparison.preferredIds).toEqual(['monthly']);
  });
  it('reports a tie among the best values even when additional candidates are worse', () => {
    const d = gym(); const third = structuredClone(d.options[1]); third.id = 'third'; third.name = 'Another monthly'; d.options.push(third);
    d.factors.forEach((f) => { f.optionIds.push('third'); f.values.third = missing(); }); expect(calculateChoice(d).comparison).toMatchObject({ status: 'tie', preferredIds: ['monthly', 'third'] });
  });
});
describe('Evidence isolation, deduplication, and invalid input', () => {
  it('never changes objective outputs when promotional wording or material counts change', () => {
    const d = gym(), initial = calculateChoice(d);
    d.options[0].materials = [{ id: 'ad', title: 'Ad', text: 'Hurry! Everyone chooses annual.' }, { id: 'terms', title: 'Terms', text: 'No refunds.' }];
    d.options[1].materials = [{ id: 'monthly-ad', title: 'Ad', text: 'A monthly choice.' }];
    expect(calculateChoice(d)).toEqual(initial);
    d.options[0].materials[0].text = 'Annual membership is available.'; d.options[1].materials = []; expect(calculateChoice(d)).toEqual(initial);
  });
  it('keeps exact material provenance and rejects invented quotes or cross-option evidence', () => {
    const d = gym(); d.options[0].materials = [{ id: 'quote', title: 'Quote', text: 'The annual charge is CNY 1200.' }];
    d.options[0].costs[0].amount = { value: 120000, source: 'material', note: 'User accepted quoted fee.', materialId: 'quote', quote: 'CNY 1200' };
    expect(choiceDecisionSchema.safeParse(d).success).toBe(true); expect(costs(d)[0]).toBe(120000);
    d.options[1].costs[0].amount = structuredClone(d.options[0].costs[0].amount); expect(choiceDecisionSchema.safeParse(d).success).toBe(false);
    d.options[1].costs[0].amount = edit(15000); d.options[0].costs[0].amount.quote = 'CNY 100'; expect(choiceDecisionSchema.safeParse(d).success).toBe(false);
  });
  it('appends only genuinely new proposals and never overwrites user values or semantic duplicates', () => {
    const d = gym(), original = structuredClone(d.factors); const replacement = { ...d.factors[0], name: 'Cheaper total', id: 'new-id' };
    const newFactor = custom(d, { id: 'pet-friendly', name: 'Pets allowed' });
    const otherPet = custom(d, { id: 'cats', name: 'Pet policy' });
    const r = mergeSuggestedFactors(d.factors, [replacement, newFactor, otherPet]);
    expect(r.factors).toHaveLength(d.factors.length + 1); expect(r.skipped).toEqual(['Cheaper total', 'Pet policy']); expect(d.factors).toEqual(original);
    expect(r.factors.at(-1)).toMatchObject({ origin: 'model', confirmed: false });
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid monetary amount %s rather than reusing an earlier result', (amount) => {
    const d = gym(); d.options[0].costs[0].amount = edit(amount); const r = calculateChoice(d); expect(r.issues.length).toBeGreaterThan(0); expect(r.options.every((o) => o.totalCostCents === null)).toBe(true);
  });
  it('detects safe-integer overflow during arithmetic while retaining unaffected outputs', () => {
    const d = gym(); d.options[1].costs[0].amount = edit(Number.MAX_SAFE_INTEGER); const r = calculateChoice(d); expect(r.options[1].totalCostCents).toBeNull(); expect(r.options[1].firstPaymentCents).toBe(Number.MAX_SAFE_INTEGER); expect(r.options[0].totalCostCents).toBe(120000); expect(r.comparison.status).toBe('insufficient');
  });
  it.each([0, 121, 1.2])('rejects unsupported month horizon %s', (months) => { const d = gym(); d.context.months = edit(months); expect(choiceDecisionSchema.safeParse(d).success).toBe(false); });
  it('rejects currency/unit confusion, invalid dates, duplicate IDs and arbitrary calculation code', () => {
    const d = gym(); d.factors[0].unit = 'USD'; expect(choiceDecisionSchema.safeParse(d).success).toBe(false);
    d.factors[0].unit = 'CNY'; d.options[1].id = d.options[0].id; expect(choiceDecisionSchema.safeParse(d).success).toBe(false);
    const f = makeDemo('laptop').factors[1]; f.values.repair = edit('2026-02-30'); expect(factorSchema.safeParse(f).success).toBe(false);
    expect(factorSchema.safeParse({ ...gym().factors[0], ruleId: 'eval(price * 3)' }).success).toBe(false);
  });
  it('requires an explicit hard target and never turns qualitative text into a score', () => {
    const d = gym(); const f = custom(d, { target: { min: null, max: null, desired: null } }); expect(factorSchema.safeParse(f).success).toBe(false);
    f.dataType = 'text'; f.values = { annual: edit('Quiet'), monthly: edit('Noisy') }; expect(factorSchema.safeParse(f).success).toBe(false);
  });
  it('rejects contradictory material statuses and allows explicit no-material status', () => {
    const a: MaterialAnalysis = { decisionId: 'd', decisionVersion: 1, optionId: 'annual', status: 'no_materials', findings: [], extractions: [], limitations: [] }; expect(materialAnalysisSchema.safeParse(a).success).toBe(true);
    a.findings = [{ id: 'f', optionId: 'annual', materialIds: ['m'], quotes: [{ materialId: 'm', quote: 'fee' }], labels: ['conflict'], explanation: 'Different fees.', needsVerification: true }]; expect(materialAnalysisSchema.safeParse(a).success).toBe(false);
    a.status = 'inconsistent'; expect(materialAnalysisSchema.safeParse(a).success).toBe(true);
  });
});
