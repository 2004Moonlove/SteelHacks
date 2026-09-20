import { formatMoney } from "./format";
import { validateDecision } from "./schema";
import type { BreakEvenResult, CalculationResult, Decision, NumericField, UsageOptionResult, ValidationIssue } from "./types";

export function isBreakEvenDecision(decision: Decision): boolean {
  return decision.schemaVersion === 2 && decision.comparisonMode === "break_even";
}

export function usesLongTermStory(decision: Decision): boolean {
  return decision.schemaVersion === 2 && (decision.comparisonMode === "qualitative" || decision.comparisonMode === "break_even" || decision.comparisonMode === "subscription");
}

/** A use is the same comparable unit for both options; costs never imply time or a monthly horizon. */
export function simulateBreakEven(decision: Decision): CalculationResult {
  const issues: ValidationIssue[] = validateDecision(decision);
  if (!isBreakEvenDecision(decision)) issues.push({ code: "INVALID_REFERENCE", path: "comparisonMode", message: "Choose a per-use comparison before calculating break-even costs." });
  if (issues.length) return { status: "invalid", issues };
  const options = decision.options.map((option, index) => {
    const costs = option.usageCosts!;
    for (const key of ["upfrontCents", "perUseCents"] as const) {
      const field = costs[key];
      const path = `options.${index}.usageCosts.${key}`;
      if (field.value === null) issues.push({ code: "MISSING_VALUE", path, message: `Enter ${option.name}'s ${key === "upfrontCents" ? "upfront" : "per-use"} cost.`, optionId: option.id });
      else if (field.source === "demo_assumption" && !field.confirmed) issues.push({ code: "UNCONFIRMED_ASSUMPTION", path, message: `Confirm ${option.name}'s example cost.`, optionId: option.id });
    }
    return { optionId: option.id, upfrontCents: costs.upfrontCents.value!, perUseCents: costs.perUseCents.value! };
  }) as [UsageOptionResult, UsageOptionResult];
  if (issues.length) return { status: "invalid", issues };
  const upfrontDifference = BigInt(options[0].upfrontCents) - BigInt(options[1].upfrontCents);
  const perUseDifference = BigInt(options[0].perUseCents) - BigInt(options[1].perUseCents);
  if (upfrontDifference === 0n && perUseDifference === 0n) return { status: "break_even", options, crossover: { kind: "equal" } };
  if (upfrontDifference * perUseDifference >= 0n) return { status: "break_even", options, crossover: { kind: "no_crossing" } };
  const numerator = upfrontDifference < 0n ? -upfrontDifference : upfrontDifference;
  const denominator = perUseDifference < 0n ? -perUseDifference : perUseDifference;
  return {
    status: "break_even", options,
    crossover: { kind: "crossing", numerator: Number(numerator), denominator: Number(denominator), firstWholeUse: Number((numerator + denominator - 1n) / denominator), recoveryOptionId: options[upfrontDifference > 0n ? 0 : 1].optionId },
  };
}

/** Return null rather than an imprecise cumulative amount outside the supported integer range. */
export function costAtUses(option: UsageOptionResult, uses: number): number | null {
  if (![option.upfrontCents, option.perUseCents, uses].every((value) => Number.isSafeInteger(value) && value >= 0)) return null;
  const cost = BigInt(option.upfrontCents) + BigInt(option.perUseCents) * BigInt(uses);
  return cost <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cost) : null;
}

export function breakEvenSummary(decision: Decision, result: BreakEvenResult): string {
  const cross = result.crossover;
  if (cross.kind === "equal") return "Both options have the same modeled cost at every use count.";
  if (cross.kind === "no_crossing") return "There is no positive break-even point with these costs.";
  const option = decision.options.find((entry) => entry.id === cross.recoveryOptionId)!;
  return `${option.name} has the same or lower modeled cost from use ${cross.firstWholeUse} onward.`;
}

export function buildBreakEvenStoryFacts(decision: Decision, result: BreakEvenResult): Record<string, string> {
  return {
    optionA_name: decision.options[0].name,
    optionB_name: decision.options[1].name,
    optionA_upfrontCost: formatMoney(result.options[0].upfrontCents),
    optionB_upfrontCost: formatMoney(result.options[1].upfrontCents),
    optionA_perUseCost: formatMoney(result.options[0].perUseCents),
    optionB_perUseCost: formatMoney(result.options[1].perUseCents),
    usageUnit: decision.usageUnit!,
    breakEvenSummary: breakEvenSummary(decision, result),
  };
}

const example = (value: number): NumericField => ({ value, source: "demo_assumption", confirmed: true, note: "Illustrative coffee costs for this labeled offline demo, not current prices." });
export const breakEvenDemoDecision: Decision = {
  schemaVersion: 2, comparisonMode: "break_even", usageUnit: "cup", id: "coffee-break-even-demo",
  title: "A coffee machine or buying coffee?",
  description: "Compare cumulative spending at the same number of cups, then explore what matters to your routine. Example prices are editable.",
  originalInput: "An offline example: a $300 coffee machine with $1 per cup versus buying coffee at $6 per cup, with no upfront purchase.",
  currency: "USD",
  options: [
    { id: "machine", name: "Coffee machine", fixedCosts: [], activities: [], usageCosts: { upfrontCents: example(30000), perUseCents: example(100) } },
    { id: "shop", name: "Buying coffee", fixedCosts: [], activities: [], usageCosts: { upfrontCents: example(0), perUseCents: example(600) } },
  ],
  tags: [
    { id: "routine", type: "consideration", name: "Making coffee at home", description: "Explore how making a drink fits your routine.", targets: [{ optionId: "machine", consideration: "If making coffee becomes part of your routine, consider how preparation and cleanup fit your day." }, { optionId: "shop", consideration: "If buying coffee stays part of your routine, consider how collecting it fits your day." }] },
    { id: "variety", type: "consideration", name: "Drink variety", description: "Consider the drinks you would like to make or buy.", targets: [{ optionId: "machine", consideration: "If drink variety matters to you, check which recipes your chosen machine can make." }, { optionId: "shop", consideration: "If drink variety matters to you, check which drinks your chosen shop offers." }] },
  ],
};
