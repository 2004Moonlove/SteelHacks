import { describe, expect, it } from "vitest";
import generalRequest from "../../../backend/src/test/resources/story-general-request.json";
import campusRequest from "../../../backend/src/test/resources/story-campus-request.json";
import { decisionSchema } from "./schema";
import { simulate } from "./simulate";
import { buildCampusDaySchedule, buildStoryFacts, listTravelChoices, type CampusTravelSelection } from "./story";

function rebuildSnapshot(snapshot: typeof generalRequest.snapshot) {
  const decision = decisionSchema.parse(snapshot.decision);
  const calculation = simulate(decision, snapshot.enabledTagIds);
  expect(calculation).toEqual(snapshot.calculation);
  if (calculation.status !== "valid") throw new Error("The shared story fixture must be valid.");
  return { decision, calculation };
}

describe("shared frontend/backend story request contract", () => {
  it("builds the General day facts accepted by the backend", () => {
    const { decision, calculation } = rebuildSnapshot(generalRequest.snapshot);
    expect(buildStoryFacts(decision, calculation)).toEqual(generalRequest.facts);
  });

  it("builds the Campus day facts accepted by the backend", () => {
    const { decision, calculation } = rebuildSnapshot(campusRequest.snapshot);
    const { arrivalTime, departureTime } = campusRequest.context;
    const selections = campusRequest.context.selections as [CampusTravelSelection, CampusTravelSelection];
    const schedule = buildCampusDaySchedule(arrivalTime, departureTime, selections, [
      listTravelChoices(decision, calculation, selections[0].optionId, selections[0].activityId),
      listTravelChoices(decision, calculation, selections[1].optionId, selections[1].activityId),
    ]);
    expect(schedule).not.toBeNull();
    expect(buildStoryFacts(decision, calculation, schedule ?? undefined)).toEqual(campusRequest.facts);
  });
});
