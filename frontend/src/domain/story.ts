import type { Decision, ValidCalculationResult } from "./types";
import { formatMoney as money } from "./format";

export type TravelChoice = {
  id: string;
  kind: "original" | "replacement";
  optionId: string;
  activityId: string;
  label: string;
  eventsPerMonth: number;
  minutesPerEvent: number;
  costCentsPerEvent: number;
};

export type CampusTravelSelection = {
  optionId: string;
  activityId: string;
  outboundChoiceId: string;
  inboundChoiceId: string;
};

export type CampusOptionSchedule = {
  optionId: string;
  activityId: string;
  leaveHome: string;
  arriveCampus: string;
  leaveCampus: string;
  arriveHome: string;
  outboundChoice: TravelChoice;
  inboundChoice: TravelChoice;
  dayCostCents: number;
  travelMinutes: number;
};

export type CampusDaySchedule = {
  arrivalTime: string;
  departureTime: string;
  options: [CampusOptionSchedule, CampusOptionSchedule];
};

export function listTravelChoices(decision: Decision, result: ValidCalculationResult, optionId: string, activityId: string): TravelChoice[] {
  const activity = decision.options.find((option) => option.id === optionId)?.activities.find((item) => item.id === activityId);
  const optionResult = result.options.find((option) => option.optionId === optionId);
  if (!activity || activity.eventUnit !== "one_way_trip" || !optionResult) return [];
  return optionResult.breakdown
    .filter((item) => item.activityId === activityId && (item.kind === "original_activity" || item.kind === "replacement_activity") && (item.eventsPerMonth ?? 0) > 0)
    .map((item): TravelChoice => ({
      id: item.kind === "original_activity" ? `original:${activityId}` : `replacement:${item.tagId}:${activityId}`,
      kind: item.kind === "original_activity" ? "original" : "replacement",
      optionId,
      activityId,
      label: item.label,
      eventsPerMonth: item.eventsPerMonth!,
      minutesPerEvent: item.minutesPerEvent!,
      costCentsPerEvent: item.costCentsPerEvent!,
    }));
}

function timeToMinutes(time: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function clockTime(minutes: number): string {
  const dayOffset = Math.floor(minutes / 1440);
  const withinDay = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(withinDay / 60);
  const hour12 = hour24 % 12 || 12;
  const clock = `${hour12}:${String(withinDay % 60).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
  return dayOffset === 0 ? clock : `${clock} (${dayOffset > 0 ? "next day" : "previous day"})`;
}

export function buildCampusDaySchedule(
  arrivalTime: string,
  departureTime: string,
  selections: [CampusTravelSelection, CampusTravelSelection],
  choices: [TravelChoice[], TravelChoice[]],
): CampusDaySchedule | null {
  const arrival = timeToMinutes(arrivalTime);
  const departure = timeToMinutes(departureTime);
  if (arrival === null || departure === null || departure <= arrival || selections[0].optionId === selections[1].optionId) return null;
  const schedules: CampusOptionSchedule[] = [];
  for (let index = 0; index < 2; index++) {
    const selection = selections[index];
    const outbound = choices[index].find((choice) => choice.id === selection.outboundChoiceId && choice.optionId === selection.optionId && choice.activityId === selection.activityId);
    const inbound = choices[index].find((choice) => choice.id === selection.inboundChoiceId && choice.optionId === selection.optionId && choice.activityId === selection.activityId);
    if (!outbound || !inbound) return null;
    if (outbound.id === inbound.id && outbound.eventsPerMonth < 2) return null;
    if (outbound.id !== inbound.id && (outbound.eventsPerMonth < 1 || inbound.eventsPerMonth < 1)) return null;
    const cost = outbound.costCentsPerEvent + inbound.costCentsPerEvent;
    const travelMinutes = outbound.minutesPerEvent + inbound.minutesPerEvent;
    if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(travelMinutes)) return null;
    schedules.push({
      optionId: selection.optionId,
      activityId: selection.activityId,
      leaveHome: clockTime(arrival - outbound.minutesPerEvent),
      arriveCampus: clockTime(arrival),
      leaveCampus: clockTime(departure),
      arriveHome: clockTime(departure + inbound.minutesPerEvent),
      outboundChoice: outbound,
      inboundChoice: inbound,
      dayCostCents: cost,
      travelMinutes,
    });
  }
  return { arrivalTime, departureTime, options: schedules as [CampusOptionSchedule, CampusOptionSchedule] };
}

const duration = (minutes: number) => `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;

export function buildStoryFacts(decision: Decision, result: ValidCalculationResult, schedule?: CampusDaySchedule): Record<string, string> {
  const optionA = decision.options[0].name;
  const optionB = decision.options[1].name;
  const costDirection = result.comparison.costDeltaCents === 0
    ? `${optionA} and ${optionB} have equal monthly cost.`
    : result.comparison.costDeltaCents > 0
      ? `${optionB} costs ${money(result.comparison.costDeltaCents)} more per month than ${optionA}.`
      : `${optionA} costs ${money(-result.comparison.costDeltaCents)} more per month than ${optionB}.`;
  const timeDirection = result.comparison.timeDeltaMinutes === 0
    ? `${optionA} and ${optionB} use equal monthly time.`
    : result.comparison.timeDeltaMinutes > 0
      ? `${optionB} uses ${duration(result.comparison.timeDeltaMinutes)} more per month than ${optionA}.`
      : `${optionA} uses ${duration(-result.comparison.timeDeltaMinutes)} more per month than ${optionB}.`;
  const facts: Record<string, string> = {
    monthlyCostDifference: money(Math.abs(result.comparison.costDeltaCents)),
    monthlyTimeDifference: duration(Math.abs(result.comparison.timeDeltaMinutes)),
    monthlyCostComparison: costDirection,
    monthlyTimeComparison: timeDirection,
  };
  result.options.forEach((option, index) => {
    const prefix = index === 0 ? "optionA" : "optionB";
    facts[`${prefix}_name`] = decision.options[index].name;
    facts[`${prefix}_monthlyCost`] = money(option.totalCostCents);
    facts[`${prefix}_monthlyTime`] = duration(option.totalTimeMinutes);
    if (schedule) {
      const day = schedule.options.find((item) => item.optionId === option.optionId);
      if (day) {
        facts[`${prefix}_leaveHome`] = day.leaveHome;
        facts[`${prefix}_arriveCampus`] = day.arriveCampus;
        facts[`${prefix}_leaveCampus`] = day.leaveCampus;
        facts[`${prefix}_arriveHome`] = day.arriveHome;
        facts[`${prefix}_outboundMode`] = day.outboundChoice.label;
        facts[`${prefix}_inboundMode`] = day.inboundChoice.label;
        facts[`${prefix}_dayTravelCost`] = money(day.dayCostCents);
        facts[`${prefix}_dayTravelTime`] = duration(day.travelMinutes);
      }
    }
  });
  return facts;
}
