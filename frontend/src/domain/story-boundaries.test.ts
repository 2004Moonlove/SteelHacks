import { describe, expect, it } from "vitest";
import request from "../../../backend/src/test/resources/story-boundaries-request.json";
import { decisionSchema } from "./schema";
import { simulate } from "./simulate";
import { buildStoryFacts } from "./story";

describe("shared story request boundaries", () => {
  it("preserves every cent and long comparison label in the request accepted by Java", () => {
    const decision = decisionSchema.parse(request.snapshot.decision);
    const calculation = simulate(decision, request.snapshot.enabledTagIds);
    expect(calculation).toEqual(request.snapshot.calculation);
    if (calculation.status !== "valid") throw new Error("Expected a valid boundary fixture.");
    expect(buildStoryFacts(decision, calculation)).toEqual(request.facts);
    expect(request.facts.monthlyCostComparison.length).toBeGreaterThan(200);
    expect(request.facts.optionA_monthlyCost).toBe("$90,071,992,547,409.91");
  });
});
