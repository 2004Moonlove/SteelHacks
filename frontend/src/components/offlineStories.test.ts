import { describe, expect, it } from "vitest";
import { breakEvenDemoDecision, subscriptionDemoDecision, qualitativeDemoDecision, campusDemoDecision, simulate, buildQualitativeStoryFacts, buildBreakEvenStoryFacts, buildSubscriptionStoryFacts, buildStoryFacts, type Decision } from "../domain";
import { createOfflineStory } from "./offlineStories";

function preview(decision: Decision, enabled: string[] = []) {
  const calculation = simulate(decision, enabled);
  const facts = calculation.status === "subscription" ? buildSubscriptionStoryFacts(decision, calculation)
    : calculation.status === "break_even" ? buildBreakEvenStoryFacts(decision, calculation)
    : calculation.status === "valid" ? buildStoryFacts(decision, calculation)
    : buildQualitativeStoryFacts(decision);
  return { story: createOfflineStory(decision, enabled, 7, calculation), facts };
}

describe("offline story illustrations", () => {
  it.each([
    ["subscription", subscriptionDemoDecision],
    ["per-use", breakEvenDemoDecision],
    ["qualitative", qualitativeDemoDecision],
    ["campus", campusDemoDecision],
  ] as const)("keeps %s scenes and action advice aligned with both paths and available facts", (_name, decision) => {
    const { story, facts } = preview(decision, decision.tags.filter((tag) => tag.type === "consideration").map((tag) => tag.id));
    expect(story.simulationVersion).toBe(7);
    expect(story.advice?.map((entry) => entry.optionId)).toEqual(decision.options.map((option) => option.id));
    expect(story.moments).toHaveLength(3);
    for (const moment of story.moments) expect(moment.options.map((entry) => entry.optionId)).toEqual(decision.options.map((option) => option.id));
    const content = JSON.stringify(story);
    for (const placeholder of content.matchAll(/\{\{([^{}]+)\}\}/g)) expect(facts).toHaveProperty(placeholder[1]);
    expect(story.advice?.every((entry) => entry.text.trim().length > 20)).toBe(true);
  });

  it("turns a selected laptop priority into a scene while excluding disabled factors", () => {
    const decision = structuredClone(qualitativeDemoDecision);
    const away = decision.tags.find((tag) => tag.id === "working-away");
    if (away?.type !== "consideration") throw new Error("Missing laptop factor");
    away.importance = 5;
    const without = JSON.stringify(preview(decision).story);
    const { story } = preview(decision, ["working-away"]);
    const during = story.moments.find((moment) => moment.key === "during")!;
    expect(during.options[0].text).toContain("pack");
    expect(during.options[0].text).toContain("Essential");
    expect(during.options[0].text).not.toContain("consider this possibility");
    expect(without).not.toContain("Essential");
  });

  it("uses the selected subscription circumstance without changing calculated payment facts", () => {
    const { story, facts } = preview(subscriptionDemoDecision, ["schedule"]);
    const during = story.moments.find((moment) => moment.key === "during")!;
    expect(during.options[0].text).toContain("other commitments");
    expect(during.options[1].text).toContain("other commitments");
    expect(facts.optionA_totalCost).toBe("$600.00");
    expect(facts.optionB_totalCost).toBe("$720.00");
    expect(story.monthlyReflections).toEqual([]);
  });
});
