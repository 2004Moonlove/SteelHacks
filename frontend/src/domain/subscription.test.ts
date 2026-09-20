import { describe, expect, it } from "vitest";
import shared from "../../../backend/src/test/resources/story-subscription-request.json";
import { simulate } from "./simulate";
import { buildSubscriptionStoryFacts, simulateSubscription, subscriptionDemoDecision } from "./subscription";
import { campusDemoDecision } from "./campus-demo";
import { demoDecision } from "./demo";
import { validateDecision } from "./schema";
import type { Decision } from "./types";

const fixture = (months?: number) => {
  const d = structuredClone(subscriptionDemoDecision);
  if (months !== undefined) d.comparisonMonths = months;
  return d;
};
describe("whole-period subscription payments", () => {
  it("matches independently checked story facts across an annual renewal", () => {
    const decision = shared.snapshot.decision as unknown as Decision;
    const result = simulate(decision, shared.snapshot.enabledTagIds);
    expect(result).toEqual(shared.snapshot.calculation);
    if (result.status !== "subscription") throw new Error("Expected subscription result");
    expect(buildSubscriptionStoryFacts(decision, result)).toEqual(shared.facts);
    expect(result.options[0]).toMatchObject({ totalCostCents: 120000, paymentCount: 2, coverageMonths: 24 });
    expect(result.timeline[12]).toMatchObject({ optionACostCents: 60000 });
    expect(result.timeline[13]).toMatchObject({ optionACostCents: 120000 });
  });
  it.each([[1,60000,6000],[6,60000,36000],[12,60000,72000],[13,120000,78000],[24,120000,144000]])("charges whole periods for a %s-month window", (months, annual, monthly) => {
    const result = simulate(fixture(months), []);
    expect(result).toMatchObject({ status: "subscription", comparisonMonths: months, options: [{ totalCostCents: annual }, { totalCostCents: monthly }], comparison: { costDeltaCents: monthly - annual } });
    if (result.status !== "subscription") throw new Error("Expected subscription result");
    expect(result.timeline).toHaveLength(months + 1);
    expect(result.timeline[0]).toEqual({ month: 0, optionACostCents: 0, optionBCostCents: 0 });
  });
  it("uses an explicit UI comparison preset of twelve months without inventing attendance", () => {
    expect(simulate(fixture(), [])).toEqual(simulate(fixture(12), []));
    expect(JSON.stringify(simulate(fixture(), []))).not.toMatch(/events|Time|minutes/);
  });
  it("supports a billing period crossing the maximum comparison window", () => {
    const d = fixture(120);d.options[0].subscriptionCosts!.periodMonths = 119;
    expect(simulate(d, [])).toMatchObject({ options: [{ coverageMonths: 238, paymentCount: 2 }, {}] });
  });
  it("rejects unknown, unconfirmed and overflowing costs instead of treating them as zero", () => {
    const unknown = fixture();unknown.options[0].subscriptionCosts!.paymentCents = { source: "unknown", value: null };
    expect(simulate(unknown, [])).toMatchObject({ status: "invalid", issues: [{ code: "MISSING_VALUE" }] });
    const unconfirmed = fixture();unconfirmed.options[0].subscriptionCosts!.paymentCents = { source: "demo_assumption", value: 60000, confirmed: false, note: "Example" };
    expect(simulate(unconfirmed, [])).toMatchObject({ status: "invalid", issues: [{ code: "UNCONFIRMED_ASSUMPTION" }] });
    const huge = fixture(13);huge.options[0].subscriptionCosts!.paymentCents = { source: "user_edit", value: Number.MAX_SAFE_INTEGER };
    expect(simulate(huge, [])).toMatchObject({ status: "invalid", issues: [{ code: "INVALID_NUMBER" }] });
    huge.comparisonMonths = 12;
    expect(simulate(huge, [])).toMatchObject({ status: "subscription", options: [{ totalCostCents: Number.MAX_SAFE_INTEGER }, {}] });
  });
  it("accepts known zero and keeps all personal priorities independent of payments", () => {
    const d = fixture();d.options[0].subscriptionCosts!.paymentCents = { source: "user_edit", value: 0 };
    const before = simulate(d, []);
    if (d.tags[0].type !== "consideration") throw new Error("Expected consideration");
    d.tags[0].importance = 5;
    expect(simulate(d, [d.tags[0].id])).toEqual(before);
    expect(before).toMatchObject({ status: "subscription", options: [{ totalCostCents: 0 }, {}] });
  });
  it.each([0,121,1.5,NaN])("rejects unsupported period or window %s", (value) => {
    const d = fixture(value);expect(validateDecision(d).length).toBeGreaterThan(0);
    const badPeriod = fixture();badPeriod.options[0].subscriptionCosts!.periodMonths = value;
    expect(validateDecision(badPeriod).length).toBeGreaterThan(0);
  });
  it("rejects mixed pricing modes, monthly tags and invalid factor references", () => {
    const d = fixture();d.options[0].usageCosts = { upfrontCents: { source: "user_input", value: 0 }, perUseCents: { source: "user_input", value: 100 } };
    expect(simulate(d, [])).toMatchObject({ status: "invalid" });
    const numeric = fixture();numeric.tags.push(structuredClone(demoDecision.tags[0]));
    expect(simulate(numeric, [])).toMatchObject({ status: "invalid" });
    expect(simulate(fixture(), ["missing"])).toMatchObject({ status: "invalid" });
    expect(simulateSubscription(demoDecision)).toMatchObject({ status: "invalid" });
  });
});

describe("current campus demo", () => {
  it("offers nine mixed factors while retaining the legacy baseline", () => {
    expect(validateDecision(campusDemoDecision)).toEqual([]);
    expect(campusDemoDecision.tags).toHaveLength(9);
    expect(campusDemoDecision.tags.filter((tag) => tag.type === "consideration")).toHaveLength(3);
    expect(simulate(campusDemoDecision, [])).toEqual(simulate(demoDecision, []));
    const base = simulate(campusDemoDecision, []);
    expect(simulate(campusDemoDecision, ["social-connection", "privacy", "independence"])).toEqual(base);
    expect(simulate(campusDemoDecision, ["utilities"])).not.toEqual(base);
    expect(simulate(campusDemoDecision, ["household-care"])).toMatchObject({ status: "valid", options: [{ totalTimeMinutes: 400 }, { totalTimeMinutes: 1720 }] });
  });
});
