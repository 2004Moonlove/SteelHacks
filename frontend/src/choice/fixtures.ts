import {
  type ChoiceDecision,
  type Factor,
  type Scalar,
  type Source,
  uid,
  unknownValue,
  userSource,
} from "./schema";

export function makeFactor(
  d: ChoiceDecision,
  name = "New factor",
  overrides: Partial<Factor> = {},
): Factor {
  return {
    id: uid(),
    name,
    reason: "A factor you chose to compare.",
    optionIds: d.options.map((o) => o.id),
    dataType: "text",
    unit: "",
    allowedValues: [],
    direction: "none",
    purpose: "reference",
    importance: 3,
    target: {},
    values: Object.fromEntries(d.options.map((o) => [o.id, unknownValue()])),
    source: userSource,
    confirmed: true,
    ruleId: null,
    ...overrides,
  };
}
export function blankDecision(description = ""): ChoiceDecision {
  return {
    schemaVersion: 2,
    id: uid(),
    version: 0,
    title: "Your next choice",
    description,
    domain: "general",
    decisionType: "choose_one",
    goals: [],
    currency: "USD",
    context: {
      months: null,
      usesPerWeek: null,
      budgetCents: null,
      budgetScope: "total",
      source: userSource,
    },
    options: ["Option A", "Option B"].map((name) => ({
      id: uid(),
      name,
      description: "",
      materials: [],
    })),
    factors: [],
    primaryFactorId: null,
    questions: [],
    charts: ["cost_bar", "cumulative_cost", "time_bar"],
    origin: "manual",
  };
}
const demoSource: Source = {
  kind: "demo",
  note: "Fictional acceptance fixture. Replace with your own data.",
};
export function demoDecision(
  kind: "gym" | "housing" | "courses",
): ChoiceDecision {
  const d = blankDecision();
  d.origin = "demo";
  d.context = {
    months: 4,
    usesPerWeek: 3,
    budgetCents: null,
    budgetScope: "total",
    source: demoSource,
  };
  const add = (
    name: string,
    dataType: Factor["dataType"],
    values: Scalar[],
    overrides: Partial<Factor> = {},
  ) => {
    const f = makeFactor(d, name, {
      dataType,
      source: demoSource,
      ...overrides,
      values: Object.fromEntries(
        d.options.map((o, i) => [
          o.id,
          { value: values[i], source: demoSource },
        ]),
      ),
    });
    d.factors.push(f);
    return f;
  };
  if (kind === "gym") {
    d.title = "A membership that fits your year";
    d.domain = "fitness";
    d.currency = "CNY";
    d.description =
      "Fictional comparison: identical service, unlimited visits, no other fees. Annual membership is paid in full and renewed every 12 months; monthly membership renews monthly. No refunds are assumed.";
    d.options[0].name = "Annual membership";
    d.options[1].name = "Monthly membership";
    const cost = add("Membership payment", "money", [120000, 15000], {
      unit: "CNY",
      ruleId: "recurring",
      direction: "lower",
      purpose: "preference",
      reason:
        "Compare actual spending over your use horizon, including full annual payments.",
    });
    d.primaryFactorId = cost.id;
    add("Billing interval", "number", [12, 1], {
      unit: "months",
      ruleId: "billing_months",
    });
    add("Initial joining fee", "money", [0, 0], {
      unit: "CNY",
      ruleId: "upfront",
    });
    add("Visit charge", "money", [0, 0], { unit: "CNY", ruleId: "per_use" });
    add("Time per visit", "duration", [60, 60], {
      unit: "min",
      ruleId: "time_per_use",
    });
    add("Commitment", "number", [12, 1], {
      unit: "months",
      ruleId: "commitment_months",
      direction: "lower",
      purpose: "preference",
      reason: "A shorter commitment may suit changing plans.",
    });
  } else if (kind === "housing") {
    d.title = "Room for you, and your cat";
    d.domain = "housing";
    d.context.months = 6;
    d.context.usesPerWeek = 5;
    d.options[0].name = "Near-campus studio";
    d.options[1].name = "Riverside apartment";
    d.description =
      "Fictional housing fixture. Rent and deposit are modeled; transportation costs and pet policies need checking. A round-trip commute is one use.";
    const cost = add("Rent", "money", [150000, 110000], {
      unit: "USD",
      ruleId: "recurring",
      direction: "lower",
      purpose: "preference",
    });
    d.primaryFactorId = cost.id;
    add("Billing interval", "number", [1, 1], {
      unit: "months",
      ruleId: "billing_months",
    });
    add("Deposit / initial fees", "money", [150000, 110000], {
      unit: "USD",
      ruleId: "upfront",
    });
    add("Travel cost per round trip", "money", [0, null], {
      unit: "USD",
      ruleId: "per_use",
    });
    add("Round-trip commute", "duration", [20, 80], {
      unit: "min",
      ruleId: "time_per_use",
      purpose: "preference",
      direction: "lower",
    });
    add("Cats allowed", "boolean", [true, null], {
      purpose: "hard",
      direction: "target",
      target: { equals: true },
      importance: 5,
      reason: "You need a home that accepts your cat.",
    });
  } else {
    d.title = "Make space for learning";
    d.domain = "learning";
    d.context.months = 3;
    d.context.usesPerWeek = 1;
    d.options[0].name = "Evening design studio";
    d.options[1].name = "Weekend coding course";
    d.description =
      "Fictional general comparison. Subjective fit is your stated assessment, not a predicted success score.";
    add("Course fee", "money", [24000, 36000], {
      unit: "USD",
      ruleId: "upfront",
      direction: "lower",
      purpose: "preference",
    });
    add("Class and practice", "duration", [180, 240], {
      unit: "min",
      ruleId: "time_per_use",
    });
    const fit = add("Interest fit", "category", ["High", "Medium"], {
      allowedValues: ["Low", "Medium", "High"],
      purpose: "preference",
      direction: "higher",
      reason: "An order you supplied for your own interests.",
    });
    d.primaryFactorId = fit.id;
    add("Schedule", "text", ["Tuesday evenings", "Saturday mornings"]);
    add("Start date", "date", ["2026-10-01", "2026-10-15"], {
      direction: "lower",
      purpose: "preference",
    });
  }
  return d;
}
