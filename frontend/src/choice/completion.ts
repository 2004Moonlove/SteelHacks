import { type ChoiceDecision, type Factor } from "./schema";

export type CompletionNeed = {
  factorId: string;
  affects: Array<"cost" | "time" | "requirements" | "preference">;
  missingOptionIds: string[];
  needsConfirmation: boolean;
};

export type CompletionNeeds = {
  factors: CompletionNeed[];
  missingMonths: boolean;
  missingUsage: boolean;
  missingBillingOptionIds: string[];
};

const costRules: Factor["ruleId"][] = ["upfront", "recurring", "per_use"];
const timeRules: Factor["ruleId"][] = ["time_per_use", "time_monthly"];

export function needsRequirementTarget(factor: Factor): boolean {
  return (
    factor.purpose === "hard" &&
    factor.target.equals == null &&
    factor.target.min === undefined &&
    factor.target.max === undefined
  );
}

/** Find inputs needed to calculate or compare, without supplying any values. */
export function getCompletionNeeds(d: ChoiceDecision): CompletionNeeds {
  const optionIds = new Set(d.options.map((option) => option.id));
  const applicableIds = (factor: Factor) =>
    factor.optionIds.filter((id) => optionIds.has(id));
  const applicableFactors = d.factors.filter(
    (factor) => applicableIds(factor).length > 0,
  );
  const factors: CompletionNeed[] = [];

  for (const factor of applicableFactors) {
    const affects: CompletionNeed["affects"] = [];
    if (costRules.includes(factor.ruleId) || factor.ruleId === "billing_months")
      affects.push("cost");
    if (timeRules.includes(factor.ruleId)) affects.push("time");
    if (factor.purpose === "hard") affects.push("requirements");
    if (factor.id === d.primaryFactorId) affects.push("preference");
    // Qualitative reference factors can remain unknown without blocking totals.
    if (affects.length === 0) continue;

    const missingOptionIds = applicableIds(factor).filter(
      (id) => factor.values[id]?.value == null,
    );
    if (
      missingOptionIds.length > 0 ||
      !factor.confirmed ||
      needsRequirementTarget(factor)
    )
      factors.push({
        factorId: factor.id,
        affects,
        missingOptionIds,
        needsConfirmation: !factor.confirmed,
      });
  }

  return {
    factors,
    missingMonths:
      d.context.months === null &&
      applicableFactors.some((factor) => costRules.includes(factor.ruleId)),
    missingUsage:
      d.context.usesPerWeek === null &&
      applicableFactors.some(
        (factor) =>
          (factor.ruleId === "per_use" || factor.ruleId === "time_per_use") &&
          applicableIds(factor).some(
            (id) => !factor.confirmed || factor.values[id]?.value !== 0,
          ),
      ),
    missingBillingOptionIds: d.options
      .filter((option) => {
        const factors = applicableFactors.filter((factor) =>
          factor.optionIds.includes(option.id),
        );
        return (
          factors.some(
            (factor) =>
              factor.ruleId === "recurring" &&
              (!factor.confirmed || factor.values[option.id]?.value !== 0),
          ) && !factors.some((factor) => factor.ruleId === "billing_months")
        );
      })
      .map((option) => option.id),
  };
}
