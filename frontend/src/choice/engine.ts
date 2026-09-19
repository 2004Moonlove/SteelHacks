import { choiceDecisionSchema } from './schema';
import type { ChoiceCalculation, ChoiceDecision, ChoiceOption, Currency, Factor, OptionCalculation, Value } from './types';

const unknown = (note = 'Not supplied.'): Value => ({ value: null, source: 'unknown', note });
const acceptedNumber = (field: Value): number | null => typeof field.value === 'number' && field.source !== 'model_suggestion' ? field.value : null;
const acceptedValue = (field?: Value): Value => !field || field.source === 'model_suggestion' ? unknown(field?.source === 'model_suggestion' ? 'Model suggestion; confirm before comparison.' : 'Not supplied.') : field;
const safe = (value: number): number | null => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
const add = (values: (number | null)[]): number | null => values.some((n) => n === null) ? null : values.reduce<number | null>((a, b) => a === null || b === null ? null : safe(a + b), 0);
const multiply = (a: number | null, b: number | null): number | null => a === 0 || b === 0 ? 0 : a === null || b === null ? null : safe(a * b);
const roundMoney = (n: number | null): number | null => n === null ? null : safe(Math.round(n));
const displayNumber = (n: number): string => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

export function formatMoney(cents: number | null, currency: Currency): string {
  if (cents === null || !Number.isFinite(cents)) return 'Unknown';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'symbol', maximumFractionDigits: 2 }).format(cents / 100);
}
export function formatValue(factor: Factor, value: Value | number | string | boolean | null, currency: Currency): string {
  const raw = value !== null && typeof value === 'object' ? value.value : value;
  if (raw === null || raw === undefined) return 'Unknown';
  if (factor.dataType === 'money' && typeof raw === 'number') return formatMoney(raw, currency);
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  return typeof raw === 'number' ? `${displayNumber(raw)}${factor.unit ? ` ${factor.unit}` : ''}` : raw;
}

/** Explicit monthly expected per-use charges are rounded to minor units once per month. */
function costAt(option: ChoiceOption, months: number | null, uses: number | null, kind: 'total' | 'first' | 'monthly'): number | null {
  if (!option.costsComplete || option.costs.length === 0 || kind === 'total' && months === null) return null;
  const costs = option.costs.map((cost) => {
    const amount = acceptedNumber(cost.amount);
    if (cost.cadence === 'one_time') return kind === 'monthly' ? 0 : amount;
    if (cost.cadence === 'annual') return kind === 'monthly' ? 0 : multiply(amount, kind === 'first' ? 1 : Math.ceil(months! / 12));
    const monthly = cost.cadence === 'per_use' ? roundMoney(multiply(amount, uses)) : amount;
    return multiply(monthly, kind === 'total' ? months : 1);
  });
  return add(costs);
}
function emptyOption(optionId: string, issue: string): OptionCalculation {
  return { optionId, totalCostCents: null, firstPaymentCents: null, monthlyPaymentCents: null, costPerUseCents: null, totalMinutes: null, monthlyMinutes: null, cumulativeCosts: [], factorValues: {}, eligibility: 'pending', failed: [], unknown: [issue], issues: [issue], summary: { start: 'Correct the invalid inputs to calculate initial payment.', routine: 'Current results are unavailable.', horizon: 'Current results are unavailable.', reconsider: issue } };
}
function confirmedRequirement(f: Factor, d: ChoiceDecision): boolean {
  return f.confirmed && (f.origin === 'user' || f.origin === 'demo' && d.mode === 'demo');
}
function hasTarget(f: Factor): boolean { return Object.values(f.target).some((v) => v !== null); }
function meetsTarget(f: Factor, value: number | string | boolean): boolean {
  const { min, max, desired } = f.target;
  if (desired !== null && value !== desired) return false;
  if (min !== null && (typeof value !== typeof min || value < min)) return false;
  if (max !== null && (typeof value !== typeof max || value > max)) return false;
  return true;
}
/** Returns an ordering only for an explicit primary preference; this is not a weighted score. */
function orderValue(f: Factor, value: number | string | boolean): number | null {
  if (f.direction === 'none' || f.dataType === 'text') return null;
  if (f.direction === 'target') {
    if (!hasTarget(f)) return null;
    if (f.target.desired !== null) {
      if (typeof value === 'number' && typeof f.target.desired === 'number') return safe(Math.abs(value - f.target.desired));
      if (f.dataType === 'date' && typeof value === 'string' && typeof f.target.desired === 'string') return Math.abs(Date.parse(value) - Date.parse(f.target.desired));
      return value === f.target.desired ? 0 : 1;
    }
    const numeric = f.dataType === 'date' ? Date.parse(String(value)) : typeof value === 'number' ? value : null;
    if (numeric === null) return null;
    const minimum = f.target.min === null ? null : f.dataType === 'date' ? Date.parse(String(f.target.min)) : Number(f.target.min);
    const maximum = f.target.max === null ? null : f.dataType === 'date' ? Date.parse(String(f.target.max)) : Number(f.target.max);
    return safe(minimum !== null && numeric < minimum ? minimum - numeric : maximum !== null && numeric > maximum ? numeric - maximum : 0);
  }
  let numeric: number | null = typeof value === 'number' ? value : f.dataType === 'date' ? Date.parse(String(value)) : null;
  if (f.dataType === 'category' && f.allowedValues.length) {
    const index = f.allowedValues.indexOf(String(value)); numeric = index === -1 ? null : index;
  }
  if (numeric === null) return null;
  return safe(f.direction === 'maximize' ? -numeric : numeric);
}
function factorValue(f: Factor, result: OptionCalculation, optionId: string): Value {
  if (!f.optionIds.includes(optionId)) return unknown('Not applicable to this option.');
  if (!f.ruleId) return acceptedValue(f.values[optionId]);
  const values = { total_cost: result.totalCostCents, first_payment: result.firstPaymentCents, monthly_payment: result.monthlyPaymentCents, cost_per_use: result.costPerUseCents, total_time: result.totalMinutes, monthly_time: result.monthlyMinutes };
  const v = values[f.ruleId];
  return v === null ? unknown('Calculation depends on missing, unconfirmed, or invalid inputs.') : { value: v, source: 'derived', note: `Calculated with the verified ${f.ruleId} rule.` };
}
function compare(decision: ChoiceDecision, options: OptionCalculation[]): ChoiceCalculation['comparison'] {
  const possible = options.filter((o) => o.eligibility !== 'ineligible');
  if (!possible.length) return { status: 'no_feasible', preferredIds: [], message: 'No option meets every confirmed requirement. Review failed conditions or consider another option.' };
  if (possible.some((o) => o.eligibility === 'pending')) return { status: 'insufficient', preferredIds: [], message: 'Key requirements are still unknown. Confirm them before choosing a preferred option.' };
  if (possible.length === 1) return { status: 'preferred', preferredIds: [possible[0].optionId], message: 'Only this option currently meets every confirmed requirement.' };
  const primary = decision.factors.find((f) => f.id === decision.primaryFactorId && f.purpose === 'preference');
  if (!primary || !confirmedRequirement(primary, decision)) return { status: 'unranked', preferredIds: [], message: 'Review the tradeoffs, then choose and confirm one primary preference if you want a ranking.' };
  const ordered = possible.map((o) => ({ id: o.optionId, value: o.factorValues[primary.id]?.value }));
  if (ordered.some((o) => o.value === null || o.value === undefined)) return { status: 'insufficient', preferredIds: [], message: `${primary.name} is unknown or not applicable for a candidate. Complete the comparable information first.` };
  const ranks = ordered.map((o) => ({ id: o.id, rank: orderValue(primary, o.value!) }));
  if (ranks.some((r) => r.rank === null)) return { status: 'unranked', preferredIds: [], message: `${primary.name} has no explicit comparable order or target. Review its values as a tradeoff.` };
  const minimum = Math.min(...ranks.map((r) => r.rank!));
  const preferredIds = ranks.filter((r) => r.rank === minimum).map((r) => r.id);
  return { status: preferredIds.length > 1 ? 'tie' : 'preferred', preferredIds, message: preferredIds.length > 1 ? `These options tie on your primary preference: ${primary.name}. Other tradeoffs may differ.` : `This option best matches your primary preference: ${primary.name}, after confirmed requirements.` };
}
function breakEven(decision: ChoiceDecision, uses: number | null): ChoiceCalculation['breakEven'] {
  const [a, b] = decision.options;
  const result: ChoiceCalculation['breakEven'] = [];
  let previous: number | null = null;
  for (let month = 1; month <= 120; month++) {
    const ac = costAt(a, month, uses, 'total'), bc = costAt(b, month, uses, 'total');
    if (ac === null || bc === null) return [];
    const sign = ac === bc ? 0 : ac < bc ? -1 : 1;
    if (sign === 0 && previous !== 0) result.push({ month, kind: 'tie', message: `${a.name} and ${b.name} have equal total cost at month ${month}. Search covers whole months 1–120, the first two options, and current usage; other requirements are not included.` });
    if (previous !== null && sign !== 0 && sign !== previous) result.push({ month, kind: 'switch', message: `${sign < 0 ? a.name : b.name} has lower total cost from month ${month} until the next change. Annual renewals can change this again. Search covers whole months 1–120 and the first two options at current usage.` });
    previous = sign;
  }
  return result;
}

export function calculateChoice(input: ChoiceDecision): ChoiceCalculation {
  const parsed = choiceDecisionSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return { options: Array.isArray(input.options) ? input.options.map((o) => emptyOption(o.id, issues[0])) : [], comparison: { status: 'insufficient', preferredIds: [], message: 'Correct invalid inputs before comparing; no previous totals are reused.' }, breakEven: [], issues };
  }
  const decision: ChoiceDecision = parsed.data;
  const months = acceptedNumber(decision.context.months), uses = acceptedNumber(decision.context.usesPerMonth);
  const budget = ['user_input', 'user_edit', 'derived'].includes(decision.context.budgetCents.source) || decision.mode === 'demo' && decision.context.budgetCents.source === 'demo' ? acceptedNumber(decision.context.budgetCents) : null;
  const options = decision.options.map((option): OptionCalculation => {
    const result = emptyOption(option.id, ''); result.unknown = []; result.issues = []; result.eligibility = 'eligible';
    result.totalCostCents = costAt(option, months, uses, 'total');
    result.firstPaymentCents = costAt(option, months, uses, 'first');
    result.monthlyPaymentCents = costAt(option, months, uses, 'monthly');
    const totalUses = multiply(uses, months);
    result.costPerUseCents = result.totalCostCents !== null && totalUses !== null && totalUses > 0 ? safe(result.totalCostCents / totalUses) : null;
    result.monthlyMinutes = add([acceptedNumber(option.minutesPerMonth), multiply(acceptedNumber(option.minutesPerUse), uses)]);
    result.totalMinutes = multiply(result.monthlyMinutes, months);
    result.cumulativeCosts = months === null ? [] : Array.from({ length: months }, (_, i) => ({ month: i + 1, costCents: costAt(option, i + 1, uses, 'total') }));
    if (!option.costsComplete || !option.costs.length) result.issues.push('Cost list is not confirmed complete; a missing charge is not zero.');
    if (months === null) result.issues.push('Confirm the planning horizon.');
    if (result.totalCostCents === null) result.issues.push('Total cost is unavailable: confirm costs, required usage, horizon, and safe arithmetic range.');
    if (result.totalMinutes === null) result.issues.push('Time is unknown or exceeds safe arithmetic range.');
    if (uses === null || uses === 0) result.issues.push(uses === 0 ? 'No uses are planned, so cost per use is undefined.' : 'Usage is unknown; cost per use is unavailable.');
    if (uses !== null && !Number.isInteger(uses) && option.costs.some((c) => c.cadence === 'per_use')) result.issues.push('Estimated monthly per-use charges are rounded to the nearest minor currency unit before extending the horizon.');
    decision.factors.forEach((factor) => {
      const value = factorValue(factor, result, option.id); result.factorValues[factor.id] = value;
      if (factor.purpose !== 'hard' || !confirmedRequirement(factor, decision) || !factor.optionIds.includes(option.id)) return;
      if (value.value === null) result.unknown.push(`${factor.name}: confirm the missing value.`);
      else if (!meetsTarget(factor, value.value)) result.failed.push(`${factor.name}: the confirmed target is not met.`);
    });
    if (budget !== null) {
      if (result.totalCostCents === null) result.unknown.push('Total budget: total cost must be known to check the budget.');
      else if (result.totalCostCents > budget) result.failed.push(`Total budget: ${formatMoney(result.totalCostCents, decision.currency)} exceeds ${formatMoney(budget, decision.currency)}.`);
    }
    result.eligibility = result.failed.length ? 'ineligible' : result.unknown.length ? 'pending' : 'eligible';
    const perUseIncluded = option.costs.some((c) => c.cadence === 'per_use');
    result.summary.start = result.firstPaymentCents === null ? 'Initial payment is unknown. Confirm charges and their timing before committing.' : `Initial payment is ${formatMoney(result.firstPaymentCents, decision.currency)}${perUseIncluded ? ', including the first month’s expected per-use charges' : ', including one-time and first recurring charges'}.`;
    const knownUsageMinutes = multiply(acceptedNumber(option.minutesPerUse), uses);
    const routineTime = result.monthlyMinutes !== null
      ? `The configured routine uses ${displayNumber(result.monthlyMinutes)} minutes per month.`
      : knownUsageMinutes !== null && uses !== null && acceptedNumber(option.minutesPerUse) !== null && acceptedNumber(option.minutesPerMonth) === null
        ? `Known usage takes ${displayNumber(knownUsageMinutes / 60)} hr per month; additional monthly time remains unknown.`
        : 'Routine time is still unknown.';
    result.summary.routine = `Recurring monthly charges are ${formatMoney(result.monthlyPaymentCents, decision.currency)} (annual renewals excluded). ${routineTime}${uses !== null ? ` Planned usage: ${displayNumber(uses)} per month.` : ''}`;
    result.summary.horizon = months === null ? 'Set a planning horizon to see cumulative cost and time.' : `Over ${months} month${months === 1 ? '' : 's'}, total cost is ${formatMoney(result.totalCostCents, decision.currency)}${result.totalMinutes === null ? '; total time is unknown' : ` and tracked time is ${displayNumber(result.totalMinutes)} minutes`}.${option.costs.some((c) => c.cadence === 'annual') ? ' Annual charges are paid for each started year.' : ''}${result.costPerUseCents !== null ? ` Cost per use: ${formatMoney(result.costPerUseCents, decision.currency)}.` : ''}`;
    const flexibility = decision.factors.filter((f) => /cancel|exit|flexib|commitment|refund/i.test(f.name) && f.optionIds.includes(option.id)).map((f) => `${f.name}: ${formatValue(f, result.factorValues[f.id], decision.currency)}`);
    result.summary.reconsider = result.failed.length ? `Reconsider now: ${result.failed.join(' ')}` : result.unknown.length ? `Before deciding: ${result.unknown.join(' ')}` : `Reconsider if prices, duration, usage, or your requirements change.${flexibility.length ? ` ${flexibility.join('; ')}.` : ''} Other qualitative effects remain possibilities, not calculated outcomes.`;
    return result;
  });
  return { options, comparison: compare(decision, options), breakEven: breakEven(decision, uses), issues: [...new Set(options.flatMap((o) => o.issues))] };
}

function normalizedName(value: string): string {
  return value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
}
function semanticKey(f: Factor): string {
  if (f.ruleId) return `rule:${f.ruleId}`;
  const name = normalizedName(f.name);
  const synonyms = [ ['commute', 'commutetime', 'traveltime', '通勤', '通勤时间'], ['pets', 'petfriendly', 'petsallowed', 'catsallowed', 'petpolicy', '宠物', '能带猫'], ['cancellation', 'cancellationflexibility', 'flexibility', 'exitflexibility', '退出灵活性'] ];
  return synonyms.find((group) => group.includes(name))?.[0] ?? name;
}
export function mergeSuggestedFactors(existing: Factor[], suggestions: Factor[]): { factors: Factor[]; skipped: string[] } {
  const factors = [...existing], skipped: string[] = [];
  for (const proposal of suggestions) {
    const duplicate = factors.some((f) => f.id === proposal.id || normalizedName(f.name) === normalizedName(proposal.name) || semanticKey(f) === semanticKey(proposal));
    if (duplicate) { skipped.push(proposal.name); continue; }
    factors.push({ ...proposal, origin: 'model', confirmed: false, optionIds: [...proposal.optionIds], allowedValues: [...proposal.allowedValues], values: Object.fromEntries(Object.entries(proposal.values).map(([id, value]) => [id, { ...value }])), target: { ...proposal.target } });
  }
  return { factors, skipped };
}
