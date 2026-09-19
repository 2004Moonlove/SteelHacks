import { z } from "zod";
import type { Decision, ValidationIssue } from "./types";

const whole = z.number().int().nonnegative().refine(Number.isSafeInteger, "Must be a safe integer");
const positiveWhole = whole.positive();
const id = z.string().min(1).refine((value) => value.trim().length > 0, "Cannot be blank");

export const numericFieldSchema = z.discriminatedUnion("source", [
  z.object({ value: whole, source: z.literal("user_input"), note: z.string().optional() }),
  z.object({ value: whole, source: z.literal("user_edit"), note: z.string().optional() }),
  z.object({ value: whole, source: z.literal("derived"), note: z.string().optional() }),
  z.object({ value: whole, source: z.literal("demo_assumption"), confirmed: z.boolean(), note: z.string().trim().min(1) }),
  z.object({ value: z.null(), source: z.literal("unknown"), note: z.string().optional() }),
]);

const fixedCostSchema = z.object({ id, name: id, amountCentsMonthly: numericFieldSchema });
const activitySchema = z.object({
  id,
  name: id,
  eventUnit: z.enum(["one_way_trip", "meal", "session", "event"]),
  frequencyInput: z.object({ label: id, eventsPerUnit: positiveWhole }).optional(),
  eventsPerMonth: numericFieldSchema,
  costCentsPerEvent: numericFieldSchema,
  minutesPerEvent: numericFieldSchema,
});
const optionSchema = z.object({ id, name: id, fixedCosts: z.array(fixedCostSchema), activities: z.array(activitySchema) });
const tagBase = { id, name: id, icon: z.string().optional(), description: z.string() };
const targetOption = { optionId: id };
const targetActivity = { ...targetOption, activityId: id };
const tagSchema = z.discriminatedUnion("type", [
  z.object({ ...tagBase, type: z.literal("fixed"), targets: z.array(z.object({ ...targetOption, costCentsMonthly: numericFieldSchema, minutesMonthly: numericFieldSchema })).min(1) }),
  z.object({ ...tagBase, type: z.literal("add_activity"), targets: z.array(z.object({ ...targetActivity, eventsPerMonth: numericFieldSchema })).min(1) }),
  z.object({ ...tagBase, type: z.literal("reduce_activity"), targets: z.array(z.object({ ...targetActivity, eventsPerMonth: numericFieldSchema })).min(1) }),
  z.object({ ...tagBase, type: z.literal("replace_activity"), targets: z.array(z.object({ ...targetActivity, replacementName: id, eventsPerMonth: numericFieldSchema, costCentsPerEvent: numericFieldSchema, minutesPerEvent: numericFieldSchema })).min(1) }),
]);

export const decisionSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  title: id,
  description: z.string(),
  originalInput: z.string(),
  currency: z.literal("USD"),
  options: z.tuple([optionSchema, optionSchema]),
  tags: z.array(tagSchema),
});

function duplicateIds(ids: string[], path: string, issues: ValidationIssue[]): void {
  const seen = new Set<string>();
  ids.forEach((value, index) => {
    if (seen.has(value)) issues.push({ code: "INVALID_REFERENCE", path: `${path}.${index}.id`, message: `Duplicate ID: ${value}.` });
    seen.add(value);
  });
}

export function validateDecision(value: unknown): ValidationIssue[] {
  const parsed = decisionSchema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      code: issue.path.includes("value") || issue.path.includes("eventsPerUnit") ? "INVALID_NUMBER" : "INVALID_REFERENCE",
      path: issue.path.join("."),
      message: issue.message,
    }));
  }

  const decision = parsed.data as Decision;
  const issues: ValidationIssue[] = [];
  duplicateIds(decision.options.map((option) => option.id), "options", issues);
  duplicateIds(decision.tags.map((tag) => tag.id), "tags", issues);
  const optionById = new Map(decision.options.map((option) => [option.id, option]));
  decision.options.forEach((option, optionIndex) => {
    duplicateIds(option.fixedCosts.map((cost) => cost.id), `options.${optionIndex}.fixedCosts`, issues);
    duplicateIds(option.activities.map((activity) => activity.id), `options.${optionIndex}.activities`, issues);
  });
  decision.tags.forEach((tag, tagIndex) => {
    const targets = new Set<string>();
    tag.targets.forEach((target, targetIndex) => {
      const path = `tags.${tagIndex}.targets.${targetIndex}`;
      const option = optionById.get(target.optionId);
      if (!option) issues.push({ code: "INVALID_REFERENCE", path: `${path}.optionId`, message: `Option ${target.optionId} does not exist.`, tagIds: [tag.id] });
      if ("activityId" in target && option && !option.activities.some((activity) => activity.id === target.activityId)) {
        issues.push({ code: "INVALID_REFERENCE", path: `${path}.activityId`, message: `Activity ${target.activityId} does not exist in option ${target.optionId}.`, optionId: target.optionId, tagIds: [tag.id] });
      }
      const key = "activityId" in target ? `${target.optionId}:${target.activityId}` : target.optionId;
      if (targets.has(key)) issues.push({ code: "INVALID_REFERENCE", path, message: `Tag ${tag.id} repeats target ${key}.`, tagIds: [tag.id] });
      targets.add(key);
    });
  });
  return issues;
}
