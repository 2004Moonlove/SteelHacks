import { beforeEach, describe, expect, it } from "vitest";
import { breakEvenDemoDecision, qualitativeDemoDecision, subscriptionDemoDecision, simulate } from "./domain";
import { useAppStore } from "./store";

beforeEach(() => {
  useAppStore.getState().setDecision(structuredClone(breakEvenDemoDecision));
});

describe("factor importance state", () => {
  it("records a user priority immutably, increments the snapshot version and leaves costs unchanged", () => {
    const before = useAppStore.getState();
    const original = structuredClone(before.decision);
    const calculation = simulate(before.decision!, []);
    before.setImportance("routine", 5);
    const after = useAppStore.getState();
    expect(after.simulationVersion).toBe(1);
    expect(after.decision?.tags[0]).toMatchObject({ id: "routine", importance: 5 });
    expect(after.enabledTagIds).toEqual([]);
    expect(before.decision).toEqual(original);
    expect(simulate(after.decision!, [])).toEqual(calculation);
  });

  it("does not mutate state for a repeated priority, unknown tag or out-of-range value", () => {
    const initial = useAppStore.getState();
    initial.setImportance("missing", 3);
    initial.setImportance("routine", 0);
    initial.setImportance("routine", 6);
    initial.setImportance("routine", 1.5);
    initial.setImportance("routine", Number.NaN);
    initial.setImportance("routine", undefined);
    expect(useAppStore.getState()).toBe(initial);
    initial.setImportance("routine", 3);
    const assigned = useAppStore.getState();
    assigned.setImportance("routine", 3);
    expect(useAppStore.getState()).toBe(assigned);
  });

  it("preserves importance when a factor is disabled and enabled again", () => {
    useAppStore.getState().setEnabled("routine", true);
    useAppStore.getState().setImportance("routine", 4);
    useAppStore.getState().setEnabled("routine", false);
    expect(useAppStore.getState().decision?.tags[0]).toMatchObject({ importance: 4 });
    expect(useAppStore.getState().enabledTagIds).toEqual([]);
    useAppStore.getState().setEnabled("routine", true);
    expect(useAppStore.getState().decision?.tags[0]).toMatchObject({ importance: 4 });
    expect(useAppStore.getState().enabledTagIds).toEqual(["routine"]);
    expect(useAppStore.getState().simulationVersion).toBe(4);
  });

  it("clears a priority back to unset and advances the snapshot version once", () => {
    useAppStore.getState().setImportance("routine", 2);
    useAppStore.getState().setImportance("routine", undefined);
    expect(useAppStore.getState().decision?.tags[0]).not.toHaveProperty("importance");
    expect(useAppStore.getState().simulationVersion).toBe(2);
    const cleared = useAppStore.getState();
    cleared.setImportance("routine", undefined);
    expect(useAppStore.getState()).toBe(cleared);
  });

  it("does not carry a previous decision's priorities or enabled factors into a new decision", () => {
    useAppStore.getState().setEnabled("routine", true);
    useAppStore.getState().setImportance("routine", 5);
    useAppStore.getState().setDecision(structuredClone(qualitativeDemoDecision));
    const next = useAppStore.getState();
    expect(next.decision).toEqual(qualitativeDemoDecision);
    expect(next.enabledTagIds).toEqual([]);
    expect(next.simulationVersion).toBe(0);
    expect(next.decision?.tags.every((tag) => !("importance" in tag))).toBe(true);
  });
});


describe("subscription comparison window state", () => {
  beforeEach(() => useAppStore.getState().setDecision(structuredClone(subscriptionDemoDecision)));

  it("uses a twelve-month default without treating it as a supplied duration", () => {
    expect(useAppStore.getState().decision).not.toHaveProperty("comparisonMonths");
    expect(simulate(useAppStore.getState().decision!, [])).toMatchObject({ status: "subscription", comparisonMonths: 12 });
    useAppStore.getState().setComparisonMonths(12);
    expect(useAppStore.getState().decision?.comparisonMonths).toBe(12);
    expect(useAppStore.getState().simulationVersion).toBe(1);
  });

  it("changes the window immutably, recomputes whole payments and preserves selected priorities", () => {
    useAppStore.getState().setEnabled("schedule", true);
    useAppStore.getState().setImportance("schedule", 5);
    const before = useAppStore.getState();
    before.setComparisonMonths(6);
    const after = useAppStore.getState();
    expect(before.decision).not.toHaveProperty("comparisonMonths");
    expect(after.simulationVersion).toBe(before.simulationVersion + 1);
    expect(after.enabledTagIds).toEqual(["schedule"]);
    expect(after.decision?.tags.find((tag) => tag.id === "schedule")).toMatchObject({ importance: 5 });
    expect(simulate(after.decision!, after.enabledTagIds)).toMatchObject({
      status: "subscription", comparisonMonths: 6,
      options: [{ totalCostCents: 60000, paymentCount: 1, coverageMonths: 12 }, { totalCostCents: 36000, paymentCount: 6, coverageMonths: 6 }],
    });
  });

  it("ignores invalid and repeated window edits", () => {
    const initial = useAppStore.getState();
    for (const value of [0, 121, -1, 3.5, Number.NaN, Number.POSITIVE_INFINITY]) initial.setComparisonMonths(value);
    expect(useAppStore.getState()).toBe(initial);
    initial.setComparisonMonths(1);
    expect(useAppStore.getState().decision?.comparisonMonths).toBe(1);
    const oneMonth = useAppStore.getState();
    oneMonth.setComparisonMonths(1);
    expect(useAppStore.getState()).toBe(oneMonth);
    oneMonth.setComparisonMonths(120);
    expect(useAppStore.getState().decision?.comparisonMonths).toBe(120);
  });

  it("resets the window with a new decision and ignores edits for other comparison modes", () => {
    useAppStore.getState().setComparisonMonths(6);
    useAppStore.getState().setDecision(structuredClone(subscriptionDemoDecision));
    expect(useAppStore.getState().decision).not.toHaveProperty("comparisonMonths");
    expect(useAppStore.getState().simulationVersion).toBe(0);
    useAppStore.getState().setDecision(structuredClone(qualitativeDemoDecision));
    const qualitative = useAppStore.getState();
    qualitative.setComparisonMonths(24);
    expect(useAppStore.getState()).toBe(qualitative);
  });
});
