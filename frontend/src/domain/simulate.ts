import { simulateSubscription } from "./subscription";
import { simulateBreakEven } from "./break-even";
import { validateDecision } from "./schema";
import type { Activity, BreakdownItem, CalculationResult, Decision, NumericField, OptionResult, Tag, ValidationIssue } from "./types";

const MAX = BigInt(Number.MAX_SAFE_INTEGER);

function complete(field: NumericField, path: string, issues: ValidationIssue[], optionId?: string, activityId?: string, tagId?: string): void {
  if (field.source === "unknown") {
    issues.push({ code: "MISSING_VALUE", path, message: "Enter a value to calculate this scenario.", optionId, activityId, tagIds: tagId ? [tagId] : undefined });
  } else if (field.source === "demo_assumption" && !field.confirmed) {
    issues.push({ code: "UNCONFIRMED_ASSUMPTION", path, message: "Confirm this example assumption before calculating.", optionId, activityId, tagIds: tagId ? [tagId] : undefined });
  }
}

function checkRequiredFields(decision: Decision, enabled: Set<string>, issues: ValidationIssue[]): void {
  decision.options.forEach((option, optionIndex) => {
    option.fixedCosts.forEach((cost, index) => complete(cost.amountCentsMonthly, `options.${optionIndex}.fixedCosts.${index}.amountCentsMonthly`, issues, option.id));
    option.activities.forEach((activity, index) => {
      const path = `options.${optionIndex}.activities.${index}`;
      complete(activity.eventsPerMonth, `${path}.eventsPerMonth`, issues, option.id, activity.id);
      complete(activity.costCentsPerEvent, `${path}.costCentsPerEvent`, issues, option.id, activity.id);
      complete(activity.minutesPerEvent, `${path}.minutesPerEvent`, issues, option.id, activity.id);
    });
  });
  decision.tags.forEach((tag, tagIndex) => {
    if (!enabled.has(tag.id)) return;
    tag.targets.forEach((target, index) => {
      const path = `tags.${tagIndex}.targets.${index}`;
      const optionId = target.optionId;
      const activityId = "activityId" in target ? target.activityId : undefined;
      if (tag.type === "fixed" && "costCentsMonthly" in target && "minutesMonthly" in target) {
        complete(target.costCentsMonthly, `${path}.costCentsMonthly`, issues, optionId, undefined, tag.id);
        complete(target.minutesMonthly, `${path}.minutesMonthly`, issues, optionId, undefined, tag.id);
      } else {
        if ("eventsPerMonth" in target) complete(target.eventsPerMonth, `${path}.eventsPerMonth`, issues, optionId, activityId, tag.id);
        if ("costCentsPerEvent" in target) complete(target.costCentsPerEvent, `${path}.costCentsPerEvent`, issues, optionId, activityId, tag.id);
        if ("minutesPerEvent" in target) complete(target.minutesPerEvent, `${path}.minutesPerEvent`, issues, optionId, activityId, tag.id);
      }
    });
  });
}

function asBigInt(field: NumericField): bigint {
  return BigInt(field.value ?? 0);
}

function checked(value: bigint, path: string, issues: ValidationIssue[], optionId?: string, activityId?: string): number {
  if (value > MAX || value < -MAX) {
    issues.push({ code: "INVALID_NUMBER", path, message: "The calculated value exceeds the safe integer range.", optionId, activityId });
    return 0;
  }
  return Number(value);
}

type ActivityChange = { tag: Extract<Tag, { type: "replace_activity" }>; target: Extract<Tag, { type: "replace_activity" }>["targets"][number] };

function activityTags(tags: Tag[], optionId: string, activityId: string) {
  const matching = tags.flatMap((tag) => tag.targets.filter((target) => "activityId" in target && target.optionId === optionId && target.activityId === activityId).map((target) => ({ tag, target })));
  return {
    additions: matching.filter((entry) => entry.tag.type === "add_activity"),
    reductions: matching.filter((entry) => entry.tag.type === "reduce_activity"),
    replacements: matching.filter((entry): entry is ActivityChange => entry.tag.type === "replace_activity" && "replacementName" in entry.target) as ActivityChange[],
  };
}

function calculateActivity(activity: Activity, optionId: string, tags: Tag[], issues: ValidationIssue[]): BreakdownItem[] {
  const { additions, reductions, replacements } = activityTags(tags, optionId, activity.id);
  const available = asBigInt(activity.eventsPerMonth)
    + additions.reduce((sum, entry) => sum + asBigInt((entry.target as { eventsPerMonth: NumericField }).eventsPerMonth), 0n)
    - reductions.reduce((sum, entry) => sum + asBigInt((entry.target as { eventsPerMonth: NumericField }).eventsPerMonth), 0n);
  const replacementCount = replacements.reduce((sum, entry) => sum + asBigInt(entry.target.eventsPerMonth), 0n);
  if (available < 0n) {
    issues.push({ code: "NEGATIVE_ACTIVITY_COUNT", path: `options.${optionId}.activities.${activity.id}`, message: `${activity.name} has fewer than zero available events.`, optionId, activityId: activity.id, tagIds: reductions.map((entry) => entry.tag.id) });
    return [];
  }
  if (replacementCount > available) {
    issues.push({ code: "REPLACEMENT_OVERFLOW", path: `options.${optionId}.activities.${activity.id}`, message: `Replacement events exceed the available ${activity.name} events.`, optionId, activityId: activity.id, tagIds: replacements.map((entry) => entry.tag.id) });
    return [];
  }
  checked(available, `options.${optionId}.activities.${activity.id}.available`, issues, optionId, activity.id);
  checked(replacementCount, `options.${optionId}.activities.${activity.id}.replacementCount`, issues, optionId, activity.id);
  const originalCount = available - replacementCount;
  const originalCost = originalCount * asBigInt(activity.costCentsPerEvent);
  const originalTime = originalCount * asBigInt(activity.minutesPerEvent);
  const items: BreakdownItem[] = [{
    id: `${optionId}:${activity.id}:original`, kind: "original_activity", label: activity.name, activityId: activity.id,
    eventsPerMonth: checked(originalCount, `${optionId}.${activity.id}.originalCount`, issues, optionId, activity.id),
    costCentsPerEvent: activity.costCentsPerEvent.value!, minutesPerEvent: activity.minutesPerEvent.value!,
    totalCostCents: checked(originalCost, `${optionId}.${activity.id}.originalCost`, issues, optionId, activity.id),
    totalTimeMinutes: checked(originalTime, `${optionId}.${activity.id}.originalTime`, issues, optionId, activity.id),
  }];
  for (const { tag, target } of replacements) {
    const count = asBigInt(target.eventsPerMonth);
    items.push({
      id: `${optionId}:${activity.id}:${tag.id}:replacement`, kind: "replacement_activity", label: target.replacementName,
      activityId: activity.id, tagId: tag.id,
      eventsPerMonth: target.eventsPerMonth.value!, costCentsPerEvent: target.costCentsPerEvent.value!, minutesPerEvent: target.minutesPerEvent.value!,
      totalCostCents: checked(count * asBigInt(target.costCentsPerEvent), `${tag.id}.cost`, issues, optionId, activity.id),
      totalTimeMinutes: checked(count * asBigInt(target.minutesPerEvent), `${tag.id}.time`, issues, optionId, activity.id),
    });
  }
  return items;
}

export function simulate(decision: Decision, enabledTagIds: string[]): CalculationResult {
  const issues = validateDecision(decision);
  const tagIds = new Set(decision.tags?.map((tag) => tag.id) ?? []);
  const enabled = new Set(enabledTagIds);
  enabledTagIds.forEach((id, index) => {
    if (!tagIds.has(id) || enabledTagIds.indexOf(id) !== index) issues.push({ code: "INVALID_REFERENCE", path: `enabledTagIds.${index}`, message: !tagIds.has(id) ? `Tag ${id} does not exist.` : `Tag ${id} is enabled more than once.`, tagIds: [id] });
  });
  if (issues.length) return { status: "invalid", issues };
  if (decision.comparisonMode === "qualitative") return { status: "qualitative" };
  if (decision.comparisonMode === "break_even") return simulateBreakEven(decision);
  if (decision.comparisonMode === "subscription") return simulateSubscription(decision);
  checkRequiredFields(decision, enabled, issues);
  if (issues.length) return { status: "invalid", issues };

  const activeTags = decision.tags.filter((tag) => enabled.has(tag.id)).sort((left, right) => left.id.localeCompare(right.id));
  const results = decision.options.map((option): OptionResult => {
    const breakdown: BreakdownItem[] = [];
    for (const fixed of option.fixedCosts) {
      breakdown.push({ id: `${option.id}:${fixed.id}:fixed`, kind: "baseline_fixed", label: fixed.name, totalCostCents: fixed.amountCentsMonthly.value!, totalTimeMinutes: 0 });
    }
    for (const activity of option.activities) breakdown.push(...calculateActivity(activity, option.id, activeTags, issues));
    for (const tag of activeTags) {
      if (tag.type !== "fixed") continue;
      for (const target of tag.targets) {
        if (target.optionId !== option.id) continue;
        breakdown.push({ id: `${option.id}:${tag.id}:fixed`, kind: "tag_fixed", label: tag.name, tagId: tag.id, totalCostCents: target.costCentsMonthly.value!, totalTimeMinutes: target.minutesMonthly.value! });
      }
    }
    const cost = breakdown.reduce((sum, item) => sum + BigInt(item.totalCostCents), 0n);
    const time = breakdown.reduce((sum, item) => sum + BigInt(item.totalTimeMinutes), 0n);
    return { optionId: option.id, totalCostCents: checked(cost, `${option.id}.totalCostCents`, issues, option.id), totalTimeMinutes: checked(time, `${option.id}.totalTimeMinutes`, issues, option.id), breakdown };
  }) as [OptionResult, OptionResult];
  if (issues.length) return { status: "invalid", issues };
  const costDeltaCents = checked(BigInt(results[1].totalCostCents) - BigInt(results[0].totalCostCents), "comparison.costDeltaCents", issues);
  const timeDeltaMinutes = checked(BigInt(results[1].totalTimeMinutes) - BigInt(results[0].totalTimeMinutes), "comparison.timeDeltaMinutes", issues);
  if (issues.length) return { status: "invalid", issues };
  return { status: "valid", options: results, comparison: { costDeltaCents, timeDeltaMinutes } };
}
