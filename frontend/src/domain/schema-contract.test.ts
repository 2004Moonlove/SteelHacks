import { describe, expect, it } from "vitest";
import { demoDecision } from "./demo";
import { formatMoney } from "./format";
import { decisionSchema, numericFieldSchema, validateDecision } from "./schema";

const fixture = () => structuredClone(demoDecision);

describe("frontend/backend decision boundaries", () => {
  it.each(["id with spaces", "id:part", "id/part", "id\n", "x".repeat(81)])("rejects unsupported ID %j before simulation", (id) => {
    const decision = fixture();
    decision.id = id;
    expect(validateDecision(decision)).not.toEqual([]);
  });

  it.each(["", " \t\n", "x".repeat(5001)])("rejects invalid text in optional and required fields", (text) => {
    const decision = fixture();
    decision.description = text;
    expect(decisionSchema.safeParse(decision).success).toBe(false);
    expect(numericFieldSchema.safeParse({ value: 0, source: "user_edit", note: text }).success).toBe(false);
    decision.description = "A valid description.";
    decision.tags[0].icon = text;
    expect(decisionSchema.safeParse(decision).success).toBe(false);
  });

  it("preserves accepted text and long option names instead of trimming or truncating", () => {
    const decision = fixture();
    decision.options[0].name = "A".repeat(5000);
    decision.options[0].fixedCosts[0].amountCentsMonthly = { value: 1, source: "demo_assumption", confirmed: true, note: "  Keep the original note.  " };
    expect(decisionSchema.parse(decision)).toEqual(decision);
  });

  it("rejects extra fields at every object boundary instead of silently discarding them", () => {
    const targets = [
      (decision: ReturnType<typeof fixture>) => decision,
      (decision: ReturnType<typeof fixture>) => decision.options[0],
      (decision: ReturnType<typeof fixture>) => decision.options[0].fixedCosts[0],
      (decision: ReturnType<typeof fixture>) => decision.options[0].fixedCosts[0].amountCentsMonthly,
      (decision: ReturnType<typeof fixture>) => decision.options[0].activities[0],
      (decision: ReturnType<typeof fixture>) => decision.options[0].activities[0].frequencyInput!,
      (decision: ReturnType<typeof fixture>) => decision.tags[0],
      (decision: ReturnType<typeof fixture>) => decision.tags[0].targets[0],
    ];
    for (const target of targets) {
      const decision = fixture();
      Object.assign(target(decision), { inventedField: "unexpected" });
      expect(decisionSchema.safeParse(decision).success).toBe(false);
    }
    expect(numericFieldSchema.safeParse({ value: 1, source: "user_edit", confirmed: true }).success).toBe(false);
  });

  it("rejects oversized collections accepted by the old frontend schema", () => {
    const decision = fixture();
    decision.options[0].fixedCosts = Array.from({ length: 101 }, (_, index) => ({ ...decision.options[0].fixedCosts[0], id: `cost-${index}` }));
    expect(decisionSchema.safeParse(decision).success).toBe(false);
    const activities = fixture();
    activities.options[0].activities = Array.from({ length: 101 }, (_, index) => ({ ...activities.options[0].activities[0], id: `activity-${index}` }));
    expect(decisionSchema.safeParse(activities).success).toBe(false);
    const tags = fixture();
    tags.tags = Array.from({ length: 101 }, (_, index) => ({ ...tags.tags[0], id: `tag-${index}` }));
    expect(decisionSchema.safeParse(tags).success).toBe(false);
    const targets = fixture();
    const replacement = targets.tags[0];
    if (replacement.type !== "replace_activity") throw new Error("Expected the demo replacement Tag.");
    replacement.targets = Array.from({ length: 101 }, () => replacement.targets[0]);
    expect(decisionSchema.safeParse(targets).success).toBe(false);
  });
});

describe("canonical USD formatting", () => {
  it.each([
    [0, "$0.00"], [1, "$0.01"], [125075, "$1,250.75"], [-1, "-$0.01"],
    [Number.MAX_SAFE_INTEGER, "$90,071,992,547,409.91"],
    [-Number.MAX_SAFE_INTEGER, "-$90,071,992,547,409.91"],
  ])("formats %s cents exactly", (cents, expected) => {
    expect(formatMoney(cents)).toBe(expected);
  });
});
