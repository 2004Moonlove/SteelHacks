import { formatMoney } from "./format";
import { validateDecision } from "./schema";
import type { CalculationResult, Decision, NumericField, SubscriptionResult, ValidationIssue } from "./types";

export const DEFAULT_COMPARISON_MONTHS = 12;
export function isSubscriptionDecision(decision: Decision): boolean {
  return decision.schemaVersion === 2 && decision.comparisonMode === "subscription";
}

/** Compare whole prepaid billing periods, renewing only when the selected window needs it. */
export function simulateSubscription(decision: Decision): CalculationResult {
  const issues: ValidationIssue[] = validateDecision(decision);
  if (!isSubscriptionDecision(decision)) issues.push({ code: "INVALID_REFERENCE", path: "comparisonMode", message: "Choose a subscription comparison before calculating billing periods." });
  if (issues.length) return { status: "invalid", issues };
  const comparisonMonths = decision.comparisonMonths ?? DEFAULT_COMPARISON_MONTHS;
  decision.options.forEach((option, index) => {
    const field = option.subscriptionCosts!.paymentCents;
    if (field.value === null) issues.push({ code: "MISSING_VALUE", path: `options.${index}.subscriptionCosts.paymentCents`, message: `Enter the price per billing period for ${option.name}.`, optionId: option.id });
    else if (field.source === "demo_assumption" && !field.confirmed) issues.push({ code: "UNCONFIRMED_ASSUMPTION", path: `options.${index}.subscriptionCosts.paymentCents`, message: `Confirm the example price for ${option.name}.`, optionId: option.id });
  });
  if (issues.length) return { status: "invalid", issues };
  const cost = (optionIndex: number, month: number): number => {
    const costs = decision.options[optionIndex].subscriptionCosts!;
    const paymentCount = Math.ceil(month / costs.periodMonths);
    const total = BigInt(paymentCount) * BigInt(costs.paymentCents.value!);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      issues.push({ code: "INVALID_NUMBER", path: `options.${optionIndex}.subscriptionCosts.paymentCents`, message: "The payment total exceeds the supported integer range.", optionId: decision.options[optionIndex].id });
      return 0;
    }
    return Number(total);
  };
  const options = decision.options.map((option, index) => ({
    optionId: option.id,
    totalCostCents: cost(index, comparisonMonths),
    paymentCount: Math.ceil(comparisonMonths / option.subscriptionCosts!.periodMonths),
    coverageMonths: Math.ceil(comparisonMonths / option.subscriptionCosts!.periodMonths) * option.subscriptionCosts!.periodMonths,
  })) as SubscriptionResult["options"];
  if (issues.length) return { status: "invalid", issues };
  const timeline = Array.from({ length: comparisonMonths + 1 }, (_, month) => ({ month, optionACostCents: cost(0, month), optionBCostCents: cost(1, month) }));
  if (issues.length) return { status: "invalid", issues };
  return { status: "subscription", comparisonMonths, options, timeline, comparison: { costDeltaCents: options[1].totalCostCents - options[0].totalCostCents } };
}

export function buildSubscriptionStoryFacts(decision: Decision, result: SubscriptionResult): Record<string, string> {
  const facts: Record<string, string> = { comparisonMonths: String(result.comparisonMonths) };
  decision.options.forEach((option, index) => {
    const prefix = index === 0 ? "optionA" : "optionB";
    facts[`${prefix}_name`] = option.name;
    facts[`${prefix}_payment`] = formatMoney(option.subscriptionCosts!.paymentCents.value!);
    facts[`${prefix}_periodMonths`] = String(option.subscriptionCosts!.periodMonths);
    facts[`${prefix}_totalCost`] = formatMoney(result.options[index].totalCostCents);
    facts[`${prefix}_paymentCount`] = String(result.options[index].paymentCount);
    facts[`${prefix}_coverageMonths`] = String(result.options[index].coverageMonths);
  });
  facts.subscriptionCostComparison = `${decision.options[0].name} costs ${formatMoney(result.options[0].totalCostCents)} and ${decision.options[1].name} costs ${formatMoney(result.options[1].totalCostCents)} over ${result.comparisonMonths} ${result.comparisonMonths === 1 ? "month" : "months"}.`;
  return facts;
}

const example = (value: number): NumericField => ({ value, source: "demo_assumption", confirmed: true, note: "Illustrative membership price for this offline example, not a current offer." });
export const subscriptionDemoDecision: Decision = {
  schemaVersion: 2, comparisonMode: "subscription", id: "annual-monthly-demo",
  title: "A year card or a month card?",
  description: "Compare whole membership payments over an editable window, then explore how each arrangement could fit your life.",
  originalInput: "An offline example: a year card costs $600 per year and a month card costs $60 per month.",
  currency: "USD",
  options: [
    { id: "annual", name: "Year card", fixedCosts: [], activities: [], subscriptionCosts: { paymentCents: example(60000), periodMonths: 12 } },
    { id: "monthly", name: "Month card", fixedCosts: [], activities: [], subscriptionCosts: { paymentCents: example(6000), periodMonths: 1 } },
  ],
  tags: [
    { id: "routine", type: "consideration", name: "Building a steady routine", group: "Everyday use", description: "Explore how a recurring membership could settle into your routine.", targets: [{ optionId: "annual", consideration: "If you keep returning regularly, a prepaid period could become part of a steady routine without a fresh purchase each month." }, { optionId: "monthly", consideration: "If you keep returning regularly, each renewal could become a recurring point to continue or change your routine." }] },
    { id: "schedule", type: "consideration", name: "A changing schedule", group: "Everyday use", description: "Imagine a period when competing commitments interrupt your usual use.", targets: [{ optionId: "annual", consideration: "If other commitments interrupt your use, prepaid access could remain available while you are away; any pause or refund terms need verification." }, { optionId: "monthly", consideration: "If other commitments interrupt your use, you could revisit the next purchase subject to the actual renewal terms." }] },
    { id: "upfront-budget", type: "consideration", name: "Room in your current budget", group: "Commitment", description: "Explore paying for a longer period at once or funding shorter periods as they arrive.", targets: [{ optionId: "annual", consideration: "If the larger initial payment competes with other needs, you may have less uncommitted cash at the start." }, { optionId: "monthly", consideration: "If smaller payments fit your cash flow, you may spread the outlay across successive renewals." }] },
    { id: "changing-needs", type: "consideration", name: "Trying it before committing", group: "Commitment", description: "Explore finding out whether this membership remains useful after getting started.", targets: [{ optionId: "annual", consideration: "If the experience turns out to fit differently than expected, unused access may remain within the prepaid period." }, { optionId: "monthly", consideration: "If the experience turns out to fit differently than expected, a coming renewal may offer an earlier point to reassess under the actual terms." }] },
    { id: "relocation", type: "consideration", name: "Changing where you live", group: "Future changes", description: "Imagine moving away from the place or service this membership supports.", targets: [{ optionId: "annual", consideration: "If your location changes, the usefulness of remaining access depends on portability and transfer terms." }, { optionId: "monthly", consideration: "If your location changes, the next renewal could be a point to change arrangements, subject to notice requirements." }] },
    { id: "renewal", type: "consideration", name: "Managing renewals", group: "Future changes", description: "Explore how renewal decisions fit into your ongoing responsibilities.", targets: [{ optionId: "annual", consideration: "If renewals happen less often, a renewal date could be easier to overlook unless you keep a reminder." }, { optionId: "monthly", consideration: "If renewal decisions recur more often, they may become a regular administrative task or an automatic payment depending on the terms." }] },
  ],
};
