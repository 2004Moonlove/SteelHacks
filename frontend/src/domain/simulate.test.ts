import { describe, expect, it } from "vitest";
import { demoDecision } from "./demo";
import { validateDecision } from "./schema";
import { simulate } from "./simulate";
import { buildCampusDaySchedule, buildStoryFacts, listTravelChoices } from "./story";
import type { Decision, ReplaceActivityTag } from "./types";

const fixture = () => structuredClone(demoDecision);
const user = (value: number) => ({ value, source: "user_edit" as const });

function totals(decision: Decision, enabled: string[]) {
  const result = simulate(decision, enabled);
  expect(result.status).toBe("valid");
  if (result.status !== "valid") throw new Error(JSON.stringify(result));
  return result;
}

describe("monthly simulation", () => {
  it.each([
    [[], [150000, 400], [110000, 1600]],
    [["uber"], [150000, 400], [125000, 1480]],
    [["remote-days", "uber"], [150000, 320], [125000, 1160]],
    [["extra-campus", "uber"], [150000, 500], [125000, 1880]],
  ] as const)("matches the housing acceptance case with %j", (enabled, near, far) => {
    const result = totals(fixture(), [...enabled]);
    expect([result.options[0].totalCostCents, result.options[0].totalTimeMinutes]).toEqual(near);
    expect([result.options[1].totalCostCents, result.options[1].totalTimeMinutes]).toEqual(far);
  });

  it("uses the current Tag value and restores baseline after toggling off", () => {
    const decision = fixture();
    const uber = decision.tags.find((tag) => tag.id === "uber") as ReplaceActivityTag;
    uber.targets[0].eventsPerMonth = user(10);
    const enabled = totals(decision, ["uber"]);
    expect([enabled.options[1].totalCostCents, enabled.options[1].totalTimeMinutes]).toEqual([135000, 1400]);
    expect(enabled.comparison).toEqual({ costDeltaCents: -15000, timeDeltaMinutes: 1000 });
    const disabled = totals(decision, []);
    expect(disabled.options[1].totalCostCents).toBe(110000);
  });

  it("subtracts the original activity cost for replacement events and keeps fixed fees", () => {
    const decision = fixture();
    decision.options[1].activities[0].costCentsPerEvent = user(500);
    const result = totals(decision, ["uber", "transit-pass"]);
    expect(result.options[1].totalCostCents).toBe(110000 + 34 * 500 + 6 * 2500 + 9750);
    expect(result.options[1].totalTimeMinutes).toBe(1480);
    expect(result.options[1].breakdown.reduce((sum, item) => sum + item.totalCostCents, 0)).toBe(result.options[1].totalCostCents);
    expect(result.options[1].breakdown.reduce((sum, item) => sum + item.totalTimeMinutes, 0)).toBe(result.options[1].totalTimeMinutes);
  });

  it("is independent of Tag order and ignores zero-count replacements", () => {
    const decision = fixture();
    const expected = totals(decision, ["extra-campus", "remote-days", "uber", "drive"]);
    decision.tags.reverse();
    const actual = totals(decision, ["drive", "uber", "remote-days", "extra-campus"]);
    expect(actual).toEqual(expected);
    const uber = decision.tags.find((tag) => tag.id === "uber") as ReplaceActivityTag;
    uber.targets[0].eventsPerMonth = user(0);
    expect(totals(decision, ["uber"]).options[1].totalCostCents).toBe(110000);
  });

  it("rejects negative available events and replacement overflow", () => {
    const decision = fixture();
    const reduced = decision.tags.find((tag) => tag.id === "remote-days");
    if (!reduced || reduced.type !== "reduce_activity") throw new Error("Missing fixture Tag");
    reduced.targets[1].eventsPerMonth = user(41);
    const negative = simulate(decision, ["remote-days"]);
    expect(negative.status).toBe("invalid");
    if (negative.status === "invalid") expect(negative.issues.some((issue) => issue.code === "NEGATIVE_ACTIVITY_COUNT")).toBe(true);

    reduced.targets[1].eventsPerMonth = user(8);
    const uber = decision.tags.find((tag) => tag.id === "uber") as ReplaceActivityTag;
    uber.targets[0].eventsPerMonth = user(20);
    const overflow = simulate(decision, ["remote-days", "uber", "drive"]);
    expect(overflow.status).toBe("invalid");
    if (overflow.status === "invalid") expect(overflow.issues.some((issue) => issue.code === "REPLACEMENT_OVERFLOW")).toBe(true);
  });

  it("requires baseline and enabled Tag values while allowing incomplete disabled Tags", () => {
    const decision = fixture();
    const uber = decision.tags.find((tag) => tag.id === "uber") as ReplaceActivityTag;
    uber.targets[0].costCentsPerEvent = { value: null, source: "unknown" };
    expect(totals(decision, []).status).toBe("valid");
    const missingTag = simulate(decision, ["uber"]);
    if (missingTag.status === "invalid") expect(missingTag.issues[0].code).toBe("MISSING_VALUE");
    else throw new Error("Expected missing Tag value");

    decision.options[0].fixedCosts[0].amountCentsMonthly = { value: 150000, source: "demo_assumption", confirmed: false, note: "Needs confirmation" };
    const assumption = simulate(decision, []);
    if (assumption.status === "invalid") expect(assumption.issues[0].code).toBe("UNCONFIRMED_ASSUMPTION");
    else throw new Error("Expected unconfirmed assumption");
  });

  it("rejects malformed references, unsafe arithmetic, and unsafe inputs", () => {
    const decision = fixture();
    const uber = decision.tags.find((tag) => tag.id === "uber") as ReplaceActivityTag;
    uber.targets[0].activityId = "missing";
    expect(validateDecision(decision).some((issue) => issue.code === "INVALID_REFERENCE")).toBe(true);
    uber.targets[0].activityId = "commute";
    decision.options[0].fixedCosts[0].amountCentsMonthly = user(Number.MAX_SAFE_INTEGER);
    decision.options[0].activities[0].costCentsPerEvent = user(1);
    const overflow = simulate(decision, []);
    if (overflow.status === "invalid") expect(overflow.issues.some((issue) => issue.code === "INVALID_NUMBER")).toBe(true);
    else throw new Error("Expected arithmetic overflow");
    decision.options[0].fixedCosts[0].amountCentsMonthly = user(-1);
    expect(validateDecision(decision).some((issue) => issue.code === "INVALID_NUMBER")).toBe(true);
  });

  it("rejects duplicate Tag targets and enabled IDs", () => {
    const decision = fixture();
    const uber = decision.tags.find((tag) => tag.id === "uber") as ReplaceActivityTag;
    uber.targets.push(structuredClone(uber.targets[0]));
    expect(validateDecision(decision).some((issue) => issue.message.includes("repeats target"))).toBe(true);
    uber.targets.pop();
    const result = simulate(decision, ["uber", "uber"]);
    if (result.status === "invalid") expect(result.issues.some((issue) => issue.path === "enabledTagIds.1")).toBe(true);
    else throw new Error("Expected duplicate enabled Tag ID");
  });

  it.each([
    [100000, 5, -50000, -200],
    [160000, 5, 10000, -200],
    [150000, 10, 0, 0],
  ])("keeps signed comparison differences for both options", (farRent, farMinutesPerEvent, costDelta, timeDelta) => {
    const decision = fixture();
    decision.options[1].fixedCosts[0].amountCentsMonthly = user(farRent);
    decision.options[1].activities[0].minutesPerEvent = user(farMinutesPerEvent);
    expect(totals(decision, []).comparison).toEqual({ costDeltaCents: costDelta, timeDeltaMinutes: timeDelta });
  });
});

describe("illustrative campus day", () => {
  it("uses only available travel modes and deterministic shared anchors", () => {
    const decision = fixture();
    const result = totals(decision, ["uber"]);
    const nearChoices = listTravelChoices(decision, result, "near", "commute");
    const farChoices = listTravelChoices(decision, result, "far", "commute");
    expect(farChoices.map((choice) => [choice.kind, choice.eventsPerMonth])).toEqual([["original", 34], ["replacement", 6]]);
    const schedule = buildCampusDaySchedule("09:00", "21:00", [
      { optionId: "near", activityId: "commute", outboundChoiceId: nearChoices[0].id, inboundChoiceId: nearChoices[0].id },
      { optionId: "far", activityId: "commute", outboundChoiceId: farChoices[0].id, inboundChoiceId: farChoices[1].id },
    ], [nearChoices, farChoices]);
    expect(schedule?.options[0].leaveHome).toBe("8:50 AM");
    expect(schedule?.options[1].leaveHome).toBe("8:20 AM");
    expect(schedule?.options[1].arriveHome).toBe("9:20 PM");
    expect(schedule?.options[1].dayCostCents).toBe(2500);
    expect(buildStoryFacts(decision, result, schedule ?? undefined).optionB_monthlyCost).toBe("$1,250.00");
  });

  it("rejects a same-mode pair when its monthly count is one", () => {
    const decision = fixture();
    const result = totals(decision, []);
    const near = listTravelChoices(decision, result, "near", "commute");
    const far = listTravelChoices(decision, result, "far", "commute");
    near[0].eventsPerMonth = 1;
    expect(buildCampusDaySchedule("09:00", "21:00", [
      { optionId: "near", activityId: "commute", outboundChoiceId: near[0].id, inboundChoiceId: near[0].id },
      { optionId: "far", activityId: "commute", outboundChoiceId: far[0].id, inboundChoiceId: far[0].id },
    ], [near, far])).toBeNull();
  });
});
