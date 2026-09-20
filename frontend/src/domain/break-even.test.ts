import { describe, expect, it } from "vitest";
import sharedRequest from "../../../backend/src/test/resources/story-break-even-request.json";
import { breakEvenDemoDecision, buildBreakEvenStoryFacts, costAtUses, simulateBreakEven, usesLongTermStory } from "./break-even";
import { demoDecision } from "./demo";
import { simulate } from "./simulate";
import { validateDecision } from "./schema";
import type { Decision, NumericField } from "./types";

const field = (value: number): NumericField => ({ value, source: "user_input" });
const fixture = (upfrontA = 30000, perUseA = 100, upfrontB = 0, perUseB = 600): Decision => {
  const decision = structuredClone(breakEvenDemoDecision);
  decision.options[0].usageCosts = { upfrontCents: field(upfrontA), perUseCents: field(perUseA) };
  decision.options[1].usageCosts = { upfrontCents: field(upfrontB), perUseCents: field(perUseB) };
  return decision;
};

describe("per-use cost comparison", () => {
  it("matches the backend request and calculates the sixty-cup coffee threshold", () => {
    const decision = sharedRequest.snapshot.decision as unknown as Decision;
    const result = simulate(decision, sharedRequest.snapshot.enabledTagIds);
    expect(result).toEqual(sharedRequest.snapshot.calculation);
    expect(result).toMatchObject({ status: "break_even", crossover: { numerator: 30000, denominator: 500, firstWholeUse: 60, recoveryOptionId: "machine" } });
    if (result.status !== "break_even") throw new Error("Expected per-use results");
    expect(costAtUses(result.options[0], 59)).toBeGreaterThan(costAtUses(result.options[1], 59)!);
    expect(costAtUses(result.options[0], 60)).toBe(costAtUses(result.options[1], 60));
    expect(buildBreakEvenStoryFacts(decision, result)).toEqual(sharedRequest.facts);
    expect(usesLongTermStory(decision)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/monthly|minutes|timeDelta/);
  });

  it("keeps fractional crossings exact and reports the first complete use in either option order", () => {
    const first = simulate(fixture(1000, 100, 0, 400), []);
    expect(first).toMatchObject({ crossover: { numerator: 1000, denominator: 300, firstWholeUse: 4, recoveryOptionId: "machine" } });
    const second = simulate(fixture(0, 400, 1000, 100), []);
    expect(second).toMatchObject({ crossover: { numerator: 1000, denominator: 300, firstWholeUse: 4, recoveryOptionId: "shop" } });
  });

  it.each([[0, 100, 0, 100, "equal"], [100, 100, 200, 100, "no_crossing"], [100, 200, 200, 300, "no_crossing"], [0, 200, 0, 300, "no_crossing"], [200, 0, 0, 100, "crossing"]])("handles equal, parallel, dominated and zero-cost lines (%s %s %s %s)", (a, b, c, d, kind) => {
    expect(simulate(fixture(a as number, b as number, c as number, d as number), [])).toMatchObject({ status: "break_even", crossover: { kind } });
  });

  it("keeps missing and unconfirmed costs distinct from zero", () => {
    const unknown = fixture();
    unknown.options[0].usageCosts!.upfrontCents = { source: "unknown", value: null };
    expect(simulate(unknown, [])).toMatchObject({ status: "invalid", issues: [{ code: "MISSING_VALUE" }] });
    const assumption = fixture();
    assumption.options[0].usageCosts!.upfrontCents = { source: "demo_assumption", value: 30000, confirmed: false, note: "Example" };
    expect(simulate(assumption, [])).toMatchObject({ status: "invalid", issues: [{ code: "UNCONFIRMED_ASSUMPTION" }] });
  });

  it("computes boundary ratios without overflow and refuses unsafe cumulative totals", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(simulate(fixture(max, 0, 0, 1), [])).toMatchObject({ crossover: { firstWholeUse: max } });
    expect(costAtUses({ optionId: "a", upfrontCents: max, perUseCents: 1 }, 1)).toBeNull();
    expect(costAtUses({ optionId: "a", upfrontCents: max, perUseCents: 0 }, max)).toBe(max);
    expect(costAtUses({ optionId: "a", upfrontCents: 0, perUseCents: 1 }, 1.5)).toBeNull();
  });

  it("validates mode-specific fields and disallows monthly adjustments", () => {
    const missing = fixture();
    delete missing.usageUnit;
    expect(validateDecision(missing).length).toBeGreaterThan(0);
    const mixed = fixture();
    mixed.options[0].fixedCosts = structuredClone(demoDecision.options[0].fixedCosts);
    expect(simulate(mixed, [])).toMatchObject({ status: "invalid" });
    const wrong = fixture();
    wrong.comparisonMode = "quantitative";
    expect(simulate(wrong, [])).toMatchObject({ status: "invalid" });
    expect(simulateBreakEven(demoDecision)).toMatchObject({ status: "invalid" });
    expect(simulate(fixture(), ["missing-factor"])).toMatchObject({ status: "invalid" });
  });

  it("treats importance as user context, without changing arithmetic or permitting out-of-range values", () => {
    const decision = fixture();
    const baseline = simulate(decision, []);
    if (decision.tags[0].type !== "consideration") throw new Error("Expected consideration");
    decision.tags[0].importance = 5;
    expect(simulate(decision, [decision.tags[0].id])).toEqual(baseline);
    for (const invalid of [0, 6, 1.5, NaN]) {
      decision.tags[0].importance = invalid;
      expect(validateDecision(decision).length).toBeGreaterThan(0);
    }
  });
});
