import {
  decisionSchema,
  type ChoiceDecision,
  type Factor,
  type Scalar,
} from "./schema";

export type Constraint = {
  factorId: string;
  name: string;
  status: "pass" | "fail" | "unknown";
  detail: string;
};
export type OptionResult = {
  optionId: string;
  totalCents: number | null;
  firstPaymentCents: number | null;
  recurringCents: number | null;
  billingMonths: number | null;
  perUseCents: number | null;
  monthlyMinutes: number | null;
  commitmentMonths: number | null;
  cumulative: Array<{ month: number; cents: number | null }>;
  constraints: Constraint[];
  feasibility: "eligible" | "blocked" | "uncertain";
  unknowns: string[];
};
export type Comparison = {
  status:
    | "invalid"
    | "no_feasible"
    | "insufficient"
    | "tradeoffs"
    | "tie"
    | "preferred";
  message: string;
  preferredIds: string[];
  options: OptionResult[];
  issues: string[];
  breakpoints: Array<{ month: number; text: string }>;
};
export function money(cents: number | null, currency: string) {
  return cents === null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(cents / 100);
}
const numeric = (v: Scalar | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const safe = (n: number | null) =>
  n !== null && Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER
    ? n
    : null;

export function meets(f: Factor, optionId: string): Constraint {
  const value = f.values[optionId]?.value;
  const result = (
    status: Constraint["status"],
    detail: string,
  ): Constraint => ({ factorId: f.id, name: f.name, status, detail });
  if (!f.confirmed || value === null || value === undefined)
    return result("unknown", "Needs a confirmed value.");
  if (f.target.equals !== undefined && f.target.equals !== null) {
    const target = f.target.equals;
    const ok =
      f.dataType === "date" &&
      typeof value === "string" &&
      typeof target === "string"
        ? f.direction === "lower"
          ? value <= target
          : f.direction === "higher"
            ? value >= target
            : value === target
        : value === target;
    return result(
      ok ? "pass" : "fail",
      `Required: ${f.dataType === "date" ? (f.direction === "lower" ? "on or before " : f.direction === "higher" ? "on or after " : "") : ""}${String(target)}`,
    );
  }
  if (
    typeof value === "number" &&
    (f.target.min !== undefined || f.target.max !== undefined)
  ) {
    const ok =
      (f.target.min === undefined || value >= f.target.min) &&
      (f.target.max === undefined || value <= f.target.max);
    return result(
      ok ? "pass" : "fail",
      `Required range: ${f.target.min ?? "any"} to ${f.target.max ?? "any"} ${f.unit}${f.dataType === "money" ? " cents" : ""}`,
    );
  }
  return result(
    "unknown",
    "Set an explicit target; a vague preference is not a threshold.",
  );
}
function preferenceValue(f: Factor, id: string): number | string | null {
  const v = f.values[id]?.value;
  if (v === null || v === undefined) return null;
  if (f.direction === "target")
    return meets(f, id).status === "unknown"
      ? null
      : meets(f, id).status === "pass"
        ? 0
        : 1;
  if (f.direction === "none") return null;
  if (f.dataType === "category")
    return f.allowedValues.includes(String(v))
      ? f.allowedValues.indexOf(String(v))
      : null;
  return typeof v === "number" || f.dataType === "date"
    ? (v as number | string)
    : null;
}
export function compare(d: ChoiceDecision): Comparison {
  const parsed = decisionSchema.safeParse(d);
  const base: Comparison = {
    status: "tradeoffs",
    message:
      "Compare the tradeoffs. Select one primary preference when you are ready.",
    preferredIds: [],
    options: [],
    issues: [],
    breakpoints: [],
  };
  if (!parsed.success)
    return {
      ...base,
      status: "invalid",
      message: "Some inputs need correction. Current results are unavailable.",
      issues: parsed.error.issues.map((i) => i.message),
    };
  const months = d.context.months;
  // One year is 52 weeks; usage is an explicit average, not a predicted attendance rate.
  const usesMonthly =
    d.context.usesPerWeek === null ? null : (d.context.usesPerWeek * 52) / 12;
  const options = d.options.map((o) => {
    const fs = d.factors.filter((f) => f.optionIds.includes(o.id));
    const rules = fs.filter((f) => f.ruleId !== null);
    const read = (rule: Factor["ruleId"], absent: number | null = 0) => {
      const f = rules.find((f) => f.ruleId === rule);
      return f ? (f.confirmed ? numeric(f.values[o.id]?.value) : null) : absent;
    };
    const upfront = read("upfront"),
      recurring = read("recurring"),
      billing = read("billing_months", recurring === 0 ? 1 : null),
      perUse = read("per_use");
    const hasCost = rules.some((f) =>
      ["upfront", "recurring", "per_use"].includes(f.ruleId!),
    );
    const usageCost =
      perUse === 0
        ? 0
        : perUse === null || usesMonthly === null
          ? null
          : perUse * usesMonthly;
    const totalAt = (m: number) =>
      !hasCost ||
      upfront === null ||
      recurring === null ||
      billing === null ||
      usageCost === null
        ? null
        : safe(
            Math.round(
              upfront + Math.ceil(m / billing) * recurring + m * usageCost,
            ),
          );
    const total = months === null ? null : totalAt(months);
    const timePerUse = read("time_per_use"),
      timeFixed = read("time_monthly");
    const hasTime = rules.some((f) =>
      ["time_per_use", "time_monthly"].includes(f.ruleId!),
    );
    const monthlyMinutes =
      !hasTime ||
      timePerUse === null ||
      timeFixed === null ||
      (timePerUse !== 0 && usesMonthly === null)
        ? null
        : safe(Math.round(timeFixed + timePerUse * (usesMonthly ?? 0)));
    const constraints = fs
      .filter((f) => f.purpose === "hard")
      .map((f) => meets(f, o.id));
    if (d.context.budgetCents !== null) {
      const actual = d.context.budgetScope === "total" ? total : totalAt(1);
      constraints.push({
        factorId: "budget",
        name: `${d.context.budgetScope === "total" ? "Total" : "First-payment"} budget`,
        status:
          actual === null
            ? "unknown"
            : actual <= d.context.budgetCents
              ? "pass"
              : "fail",
        detail: `${money(actual, d.currency)} / ${money(d.context.budgetCents, d.currency)}`,
      });
    }
    const unknowns = fs
      .filter((f) => !f.confirmed || f.values[o.id]?.value == null)
      .map((f) => f.name);
    if (months === null) unknowns.push("Comparison horizon");
    if (hasCost && recurring !== 0 && billing === null)
      unknowns.push("Billing period");
    if (hasCost && total === null && unknowns.length === 0)
      unknowns.push("Cost dependencies or safe arithmetic range");
    return {
      optionId: o.id,
      totalCents: total,
      firstPaymentCents: totalAt(1),
      recurringCents: hasCost ? recurring : null,
      billingMonths: billing,
      perUseCents:
        total === null || !usesMonthly || months === null
          ? null
          : safe(Math.round(total / (usesMonthly * months))),
      monthlyMinutes,
      commitmentMonths: read("commitment_months", null),
      cumulative: Array.from({ length: months ?? 0 }, (_, i) => ({
        month: i + 1,
        cents: totalAt(i + 1),
      })),
      constraints,
      feasibility: constraints.some((c) => c.status === "fail")
        ? ("blocked" as const)
        : constraints.some((c) => c.status === "unknown")
          ? ("uncertain" as const)
          : ("eligible" as const),
      unknowns,
    };
  });
  const result = { ...base, options };
  const viable = options.filter((o) => o.feasibility !== "blocked");
  if (!viable.length)
    return {
      ...result,
      status: "no_feasible",
      message:
        "No option meets your current must-haves. Review the failed conditions or change the options.",
    };
  const primary = d.factors.find((f) => f.id === d.primaryFactorId);
  if (viable.some((o) => o.feasibility === "uncertain"))
    return {
      ...result,
      status: "insufficient",
      message:
        "Key conditions are still unknown. Confirm them before identifying a preferred option.",
    };
  if (primary && primary.direction !== "none") {
    const ranked = viable.map((o) => ({
      id: o.optionId,
      value:
        primary.direction !== "target" &&
        primary.ruleId &&
        ["upfront", "recurring", "per_use"].includes(primary.ruleId)
          ? o.totalCents
          : preferenceValue(primary, o.optionId),
    }));
    if (
      ranked.some((o) => o.value === null || !primary.optionIds.includes(o.id))
    ) {
      result.status = "insufficient";
      result.message =
        "The primary preference is missing comparable data for an eligible option.";
    } else {
      const sign = primary.direction === "higher" ? -1 : 1;
      ranked.sort(
        (a, b) =>
          (a.value! < b.value! ? -1 : a.value! > b.value! ? 1 : 0) * sign,
      );
      result.preferredIds = ranked
        .filter((o) => o.value === ranked[0].value)
        .map((o) => o.id);
      result.status = result.preferredIds.length > 1 ? "tie" : "preferred";
      result.message =
        result.status === "tie"
          ? `A tie on your primary preference: ${primary.name}. Review the other tradeoffs.`
          : `${d.options.find((o) => o.id === result.preferredIds[0])!.name} fits your confirmed conditions and primary preference (${primary.name}${primary.direction !== "target" && primary.ruleId && ["upfront", "recurring", "per_use"].includes(primary.ruleId) ? "; compared by total horizon cost" : ""}).`;
    }
  }
  if (options.length === 2) {
    const a = options[0],
      b = options[1];
    let previousSign: number | null = null;
    for (let m = 1; m <= (months ?? 0); m++) {
      const av = a.cumulative[m - 1].cents,
        bv = b.cumulative[m - 1].cents;
      if (av === null || bv === null) break;
      const sign = Math.sign(av - bv);
      if (
        (sign === 0 && previousSign !== 0) ||
        (previousSign !== null && sign !== 0 && sign !== previousSign)
      )
        result.breakpoints.push({
          month: m,
          text:
            sign === 0
              ? `Month ${m}: equal total cost (${money(av, d.currency)} each).`
              : `Month ${m}: ${d.options[sign < 0 ? 0 : 1].name} has lower total cost.`,
        });
      previousSign = sign;
    }
  }
  return result;
}

export function lifeSummary(
  d: ChoiceDecision,
  r: OptionResult,
): Array<{ label: string; text: string }> {
  const descriptive = d.factors.filter(
    (f) =>
      f.optionIds.includes(r.optionId) &&
      f.confirmed &&
      !f.ruleId &&
      f.values[r.optionId]?.value !== null,
  );
  return [
    {
      label: "At the start · calculated",
      text:
        r.firstPaymentCents === null
          ? "Confirm prices and billing terms to understand the initial cash needed."
          : `Plan for ${money(r.firstPaymentCents, d.currency)} in the first month, including scheduled charges and modeled use.`,
    },
    {
      label: "In your routine · calculated",
      text:
        r.monthlyMinutes === null
          ? "Routine time is not known yet. Add a time factor if it matters to you."
          : `Allow about ${r.monthlyMinutes} minutes per month (${(r.monthlyMinutes / 60).toFixed(1)} hours) for the activities you entered.`,
    },
    {
      label: "Over time · calculated",
      text: `${d.context.months === null ? "Choose a time horizon." : `Across ${d.context.months} months, modeled spending is ${money(r.totalCents, d.currency)}.`} ${r.commitmentMonths === null ? "Exit and refund commitments still need confirmation." : `The stated commitment is ${r.commitmentMonths} months. No refund is assumed.`}`,
    },
    {
      label: "Your other priorities · recorded inputs",
      text: descriptive.length
        ? descriptive
            .slice(0, 4)
            .map(
              (f) =>
                `${f.name}: ${f.dataType === "money" ? money(Number(f.values[r.optionId].value), d.currency) : String(f.values[r.optionId].value)} (${f.values[r.optionId].source.kind})`,
            )
            .join(". ") + "."
        : "Add your other plans, flexibility needs, or qualitative preferences to include them here.",
    },
    {
      label: "Reconsider when · conditional",
      text: r.constraints.some((c) => c.status === "fail")
        ? `This option currently fails: ${r.constraints
            .filter((c) => c.status === "fail")
            .map((c) => c.name)
            .join(", ")}.`
        : `Recheck if the price, use horizon, or your must-haves change.${r.unknowns.length ? ` Still to confirm: ${r.unknowns.join(", ")}.` : " Qualitative outcomes are not predicted."}`,
    },
  ];
}

export function impact(
  previous: Comparison,
  current: Comparison,
  optionId: string,
  currency: string,
): string[] {
  const a = previous.options.find((o) => o.optionId === optionId),
    b = current.options.find((o) => o.optionId === optionId);
  if (!a || !b)
    return [
      "Current results are unavailable until invalid inputs are corrected.",
    ];
  const lines: string[] = [];
  for (const [key, label] of [
    ["totalCents", "Total spending"],
    ["firstPaymentCents", "First payment"],
    ["perUseCents", "Cost per use"],
    ["monthlyMinutes", "Monthly time"],
  ] as const) {
    const fmt = (v: number | null) =>
      key === "monthlyMinutes"
        ? v === null
          ? "Unknown"
          : `${v} min`
        : money(v, currency);
    lines.push(
      `${label}: ${a[key] === b[key] ? `unchanged (${fmt(b[key])})` : `${fmt(a[key])} → ${fmt(b[key])}`}.`,
    );
  }
  lines.push(
    `Comparison: ${previous.message === current.message ? "unchanged" : "updated"}.`,
  );
  return lines;
}
