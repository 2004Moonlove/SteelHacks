import { describe, expect, it } from "vitest";
import request from "../../../backend/src/test/resources/story-qualitative-request.json";
import { demoDecision } from "./demo";
import { buildQualitativeStoryFacts, isQualitativeDecision, qualitativeDemoDecision } from "./qualitative";
import { validateDecision } from "./schema";
import { simulate } from "./simulate";
import type { ConsiderationTag, Decision } from "./types";

const fixture = () => structuredClone(qualitativeDemoDecision);

function mixedFixture(): Decision {
  const decision = structuredClone(demoDecision);
  decision.schemaVersion = 2;
  decision.comparisonMode = "quantitative";
  decision.tags.push({
    id: "personal-space", type: "consideration", name: "Personal space", description: "Consider how each arrangement fits your preferred boundaries.",
    targets: [{ optionId: "near", consideration: "Consider the space you would want around your routine." }],
  });
  return decision;
}

describe("qualitative decisions", () => {
  it("builds the shared backend story snapshot without fabricated totals or monthly facts", () => {
    const decision = fixture();
    expect(validateDecision(decision)).toEqual([]);
    expect(decision).toEqual(request.snapshot.decision);
    expect(simulate(decision, request.snapshot.enabledTagIds)).toEqual(request.snapshot.calculation);
    expect(buildQualitativeStoryFacts(decision)).toEqual(request.facts);
    expect(Object.keys(request.facts).sort()).toEqual(["optionA_name", "optionB_name"]);
    expect(isQualitativeDecision(decision)).toBe(true);
  });

  it("works without selecting any factors and without any suggested factors", () => {
    const decision = fixture();
    expect(simulate(decision, [])).toEqual({ status: "qualitative" });
    decision.tags = [];
    expect(simulate(decision, [])).toEqual({ status: "qualitative" });
  });

  it.each([2, 3, 20, 30])("accepts %s distinct, relevant factors instead of a mandatory five to ten", (count) => {
    const decision = fixture();
    decision.tags = Array.from({ length: count }, (_, index) => ({ ...decision.tags[index % 3], id: `factor-${index}` }));
    expect(validateDecision(decision)).toEqual([]);
    expect(simulate(decision, decision.tags.map((tag) => tag.id))).toEqual({ status: "qualitative" });
  });

  it("rejects excessive factors, invalid references and duplicate selections", () => {
    const decision = fixture();
    decision.tags = Array.from({ length: 31 }, (_, index) => ({ ...decision.tags[0], id: `factor-${index}` }));
    expect(validateDecision(decision)).not.toEqual([]);
    const badReference = fixture();
    badReference.tags[0].targets[0].optionId = "nonexistent";
    expect(simulate(badReference, [])).toMatchObject({ status: "invalid" });
    expect(simulate(fixture(), ["nonexistent"])).toMatchObject({ status: "invalid" });
    expect(simulate(fixture(), ["gaming-time", "gaming-time"])).toMatchObject({ status: "invalid" });
  });

  it("rejects quantitative rows and adjustments rather than silently discarding them", () => {
    const decision = fixture();
    decision.options[0].fixedCosts = structuredClone(demoDecision.options[0].fixedCosts);
    expect(simulate(decision, [])).toMatchObject({ status: "invalid" });
    const activity = fixture();
    activity.options[0].activities = structuredClone(demoDecision.options[0].activities);
    expect(simulate(activity, [])).toMatchObject({ status: "invalid" });
    const numericTag = fixture();
    numericTag.tags.push({ id: "fee", name: "Fee", type: "fixed", description: "A fee.", targets: [{ optionId: "gaming", costCentsMonthly: { value: 1, source: "user_input" }, minutesMonthly: { value: 0, source: "user_input" } }] });
    expect(simulate(numericTag, [])).toMatchObject({ status: "invalid" });
  });

  it("rejects missing version-two mode, version-one qualitative mode, and untyped numerical consideration fields", () => {
    const missingMode = fixture();
    delete missingMode.comparisonMode;
    expect(validateDecision(missingMode)).not.toEqual([]);
    const legacy = fixture();
    legacy.schemaVersion = 1;
    expect(validateDecision(legacy)).not.toEqual([]);
    const groupedLegacy = structuredClone(demoDecision);
    groupedLegacy.tags[0].group = "Travel";
    expect(validateDecision(groupedLegacy)).not.toEqual([]);
    const extra = fixture();
    Object.assign(extra.tags[0].targets[0], { costCentsMonthly: { value: 5, source: "user_input" } });
    expect(validateDecision(extra)).not.toEqual([]);
    const repeated = fixture();
    const tag = repeated.tags[0] as ConsiderationTag;
    tag.targets = [tag.targets[0], structuredClone(tag.targets[0])];
    expect(validateDecision(repeated)).not.toEqual([]);
  });
});

describe("mixed numerical and qualitative factors", () => {
  it("keeps every numerical total and breakdown unchanged when a consideration is selected", () => {
    const decision = mixedFixture();
    expect(validateDecision(decision)).toEqual([]);
    const before = simulate(decision, ["uber"]);
    expect(before.status).toBe("valid");
    expect(simulate(decision, ["uber", "personal-space"])).toEqual(before);
    expect(before).toEqual(simulate(demoDecision, ["uber"]));
  });

  it("does not change missing or erroneous numbers into a qualitative success", () => {
    const decision = mixedFixture();
    decision.options[0].fixedCosts[0].amountCentsMonthly = { value: null, source: "unknown" };
    expect(isQualitativeDecision(decision)).toBe(false);
    expect(simulate(decision, ["personal-space"])).toMatchObject({ status: "invalid", issues: [expect.objectContaining({ code: "MISSING_VALUE" })] });
    decision.options[0].fixedCosts[0].amountCentsMonthly = { value: -1, source: "user_edit" };
    expect(simulate(decision, ["personal-space"])).toMatchObject({ status: "invalid" });
  });
});
