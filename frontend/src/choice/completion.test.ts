import { describe, expect, it } from "vitest";
import { getCompletionNeeds } from "./completion";
import { compare } from "./engine";
import { blankDecision, makeFactor } from "./fixtures";
import {
  type ChoiceDecision,
  type Factor,
  type Scalar,
  userSource,
} from "./schema";

const addFactor = (
  d: ChoiceDecision,
  ruleId: Factor["ruleId"],
  values: Scalar[],
  overrides: Partial<Factor> = {},
) => {
  const f = makeFactor(d, ruleId ?? "Personal priority", {
    ruleId,
    dataType:
      ruleId === "billing_months" || ruleId === "commitment_months"
        ? "number"
        : ruleId?.startsWith("time_")
          ? "duration"
          : ruleId
            ? "money"
            : "text",
    unit:
      ruleId === "billing_months" || ruleId === "commitment_months"
        ? "months"
        : ruleId?.startsWith("time_")
          ? "min"
          : ruleId
            ? d.currency
            : "",
    values: Object.fromEntries(
      d.options.map((option, i) => [
        option.id,
        { value: values[i] ?? null, source: userSource },
      ]),
    ),
    ...overrides,
  });
  d.factors.push(f);
  return f;
};

const emptyNeeds = {
  factors: [],
  missingMonths: false,
  missingUsage: false,
  missingBillingOptionIds: [],
};

describe("Completion guidance", () => {
  it("asks for housing calculation inputs without requiring qualitative references", () => {
    const d = blankDecision("Live on campus or off campus");
    const rent = addFactor(d, "recurring", [null, null], { confirmed: false });
    const commute = addFactor(d, "time_per_use", [null, null], {
      confirmed: false,
    });
    addFactor(d, null, [null, null], { name: "Social opportunities" });
    addFactor(d, "commitment_months", [null, null]);

    expect(getCompletionNeeds(d)).toEqual({
      factors: [
        {
          factorId: rent.id,
          affects: ["cost"],
          missingOptionIds: d.options.map((option) => option.id),
          needsConfirmation: true,
        },
        {
          factorId: commute.id,
          affects: ["time"],
          missingOptionIds: d.options.map((option) => option.id),
          needsConfirmation: true,
        },
      ],
      missingMonths: true,
      missingUsage: true,
      missingBillingOptionIds: d.options.map((option) => option.id),
    });
  });

  it("separates missing values from confirmation and ignores out-of-scope options", () => {
    const d = blankDecision();
    const price = addFactor(d, "upfront", [0, null], { confirmed: false });
    price.optionIds = [d.options[0].id];
    expect(getCompletionNeeds(d).factors).toEqual([
      {
        factorId: price.id,
        affects: ["cost"],
        missingOptionIds: [],
        needsConfirmation: true,
      },
    ]);
    delete price.values[d.options[0].id];
    expect(getCompletionNeeds(d).factors[0].missingOptionIds).toEqual([
      d.options[0].id,
    ]);
  });

  it("includes must-haves and the selected preference, with all applicable effects", () => {
    const d = blankDecision();
    const hard = addFactor(d, null, [true, null], {
      name: "Pets allowed",
      dataType: "boolean",
      purpose: "hard",
      target: { equals: true },
    });
    const primary = addFactor(d, "recurring", [10000, null], {
      purpose: "preference",
      direction: "lower",
    });
    d.primaryFactorId = primary.id;
    addFactor(d, null, [null, null], { purpose: "preference" });
    const needs = getCompletionNeeds(d);
    expect(
      needs.factors.map((factor) => [factor.factorId, factor.affects]),
    ).toEqual([
      [hard.id, ["requirements"]],
      [primary.id, ["cost", "preference"]],
    ]);
  });

  it("requests commitment only when it is a must-have or the primary preference", () => {
    const d = blankDecision();
    const commitment = addFactor(d, "commitment_months", [null, null]);
    expect(getCompletionNeeds(d)).toEqual(emptyNeeds);
    commitment.purpose = "hard";
    expect(getCompletionNeeds(d).factors[0].affects).toEqual(["requirements"]);
    commitment.purpose = "preference";
    d.primaryFactorId = commitment.id;
    expect(getCompletionNeeds(d).factors[0].affects).toEqual(["preference"]);
  });

  it("keeps a confirmed hard factor pending until a target is specified", () => {
    const d = blankDecision();
    const f = addFactor(d, null, [true, true], {
      name: "Pets allowed",
      dataType: "boolean",
      purpose: "hard",
      confirmed: true,
    });
    expect(compare(d).options[0].feasibility).toBe("uncertain");
    expect(getCompletionNeeds(d).factors).toEqual([
      {
        factorId: f.id,
        affects: ["requirements"],
        missingOptionIds: [],
        needsConfirmation: false,
      },
    ]);
    f.target.equals = true;
    expect(getCompletionNeeds(d).factors).toEqual([]);
  });

  it("does not require a horizon for time-only or qualitative decisions", () => {
    const d = blankDecision();
    addFactor(d, "time_monthly", [20, 60]);
    addFactor(d, null, [null, null]);
    expect(getCompletionNeeds(d)).toEqual(emptyNeeds);
    addFactor(d, "upfront", [0, 0]);
    expect(getCompletionNeeds(d).missingMonths).toBe(true);
    d.context.months = 1;
    expect(getCompletionNeeds(d).missingMonths).toBe(false);
  });

  it.each(["per_use", "time_per_use"] as const)(
    "requires frequency for nonzero, unknown, or unconfirmed %s inputs",
    (rule) => {
      const d = blankDecision();
      const f = addFactor(d, rule, [0, 0]);
      expect(getCompletionNeeds(d).missingUsage).toBe(false);
      f.values[d.options[1].id].value = 10;
      expect(getCompletionNeeds(d).missingUsage).toBe(true);
      f.values[d.options[1].id].value = null;
      expect(getCompletionNeeds(d).missingUsage).toBe(true);
      f.values[d.options[1].id].value = 0;
      f.confirmed = false;
      expect(getCompletionNeeds(d).missingUsage).toBe(true);
      d.context.usesPerWeek = 0;
      expect(getCompletionNeeds(d).missingUsage).toBe(false);
      expect(getCompletionNeeds(d).factors[0].needsConfirmation).toBe(true);
    },
  );

  it("does not require usage solely to show an average cost per use", () => {
    const d = blankDecision();
    d.context.months = 6;
    addFactor(d, "upfront", [0, 1000]);
    addFactor(d, "recurring", [50000, 60000]);
    addFactor(d, "billing_months", [1, 1]);
    expect(getCompletionNeeds(d)).toEqual(emptyNeeds);
    expect(compare(d).options.map((option) => option.totalCents)).toEqual([
      300000, 361000,
    ]);
    expect(
      compare(d).options.every((option) => option.perUseCents === null),
    ).toBe(true);
  });

  it("requests missing billing rules for only recurring options that need them", () => {
    const d = blankDecision();
    const rent = addFactor(d, "recurring", [0, 10000]);
    expect(getCompletionNeeds(d).missingBillingOptionIds).toEqual([
      d.options[1].id,
    ]);
    rent.confirmed = false;
    expect(getCompletionNeeds(d).missingBillingOptionIds).toEqual(
      d.options.map((option) => option.id),
    );
    const billing = addFactor(d, "billing_months", [null, null], {
      optionIds: [d.options[1].id],
    });
    const needs = getCompletionNeeds(d);
    expect(needs.missingBillingOptionIds).toEqual([d.options[0].id]);
    expect(
      needs.factors.find((factor) => factor.factorId === billing.id),
    ).toEqual({
      factorId: billing.id,
      affects: ["cost"],
      missingOptionIds: [d.options[1].id],
      needsConfirmation: false,
    });
  });

  it("does not report dependencies for factors outside the decision's options", () => {
    const d = blankDecision();
    addFactor(d, "recurring", [null, null], { optionIds: ["removed"] });
    addFactor(d, "time_per_use", [null, null], { optionIds: ["removed"] });
    expect(getCompletionNeeds(d)).toEqual(emptyNeeds);
  });

  it("leaves qualitative references unknown while completed housing inputs calculate", () => {
    const d = blankDecision("Live on campus or off campus");
    d.context.months = 9;
    d.context.usesPerWeek = 5;
    addFactor(d, "recurring", [90000, 70000]);
    addFactor(d, "billing_months", [1, 1]);
    addFactor(d, "time_per_use", [10, 40]);
    addFactor(d, null, [null, null], {
      name: "Social opportunities",
      confirmed: false,
    });
    const before = structuredClone(d);
    expect(getCompletionNeeds(d)).toEqual(emptyNeeds);
    const result = compare(d);
    expect(result.options.map((option) => option.totalCents)).toEqual([
      810000, 630000,
    ]);
    expect(result.options.map((option) => option.monthlyMinutes)).toEqual([
      217, 867,
    ]);
    expect(d).toEqual(before);
  });
});
