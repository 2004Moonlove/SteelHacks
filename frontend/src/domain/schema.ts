import { z } from "zod";
import type { Decision, ValidationIssue } from "./types";

const whole = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveWhole = whole.positive();
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}(?![\s\S])/, "Use 1 to 80 letters, numbers, underscores, or hyphens");
// Match Java String.isBlank without trimming or changing user-provided text.
const text = z.string().min(1).max(5000).regex(/[^\u0009-\u000D\u001C-\u0020\u1680\u2000-\u2006\u2008-\u200A\u2028\u2029\u205F\u3000]/, "Cannot be blank");

export const numericFieldSchema = z.discriminatedUnion("source", [
  z.strictObject({ value: whole, source: z.literal("user_input"), note: text.optional() }),
  z.strictObject({ value: whole, source: z.literal("user_edit"), note: text.optional() }),
  z.strictObject({ value: whole, source: z.literal("derived"), note: text.optional() }),
  z.strictObject({ value: whole, source: z.literal("demo_assumption"), confirmed: z.boolean(), note: text }),
  z.strictObject({ value: z.null(), source: z.literal("unknown"), note: text.optional() }),
]);

const fixedCostSchema = z.strictObject({ id, name: text, amountCentsMonthly: numericFieldSchema });
const activitySchema = z.strictObject({
  id,
  name: text,
  eventUnit: z.enum(["one_way_trip", "meal", "session", "event"]),
  frequencyInput: z.strictObject({ label: text, eventsPerUnit: positiveWhole }).optional(),
  eventsPerMonth: numericFieldSchema,
  costCentsPerEvent: numericFieldSchema,
  minutesPerEvent: numericFieldSchema,
});
const optionSchema = z.strictObject({ id, name: text, fixedCosts: z.array(fixedCostSchema).max(100), activities: z.array(activitySchema).max(100) });
const tagBase = { id, name: text, icon: text.optional(), description: text };
const targetOption = { optionId: id };
const targetActivity = { ...targetOption, activityId: id };
const tagSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...tagBase, type: z.literal("fixed"), targets: z.array(z.strictObject({ ...targetOption, costCentsMonthly: numericFieldSchema, minutesMonthly: numericFieldSchema })).min(1).max(100) }),
  z.strictObject({ ...tagBase, type: z.literal("add_activity"), targets: z.array(z.strictObject({ ...targetActivity, eventsPerMonth: numericFieldSchema })).min(1).max(100) }),
  z.strictObject({ ...tagBase, type: z.literal("reduce_activity"), targets: z.array(z.strictObject({ ...targetActivity, eventsPerMonth: numericFieldSchema })).min(1).max(100) }),
  z.strictObject({ ...tagBase, type: z.literal("replace_activity"), targets: z.array(z.strictObject({ ...targetActivity, replacementName: text, eventsPerMonth: numericFieldSchema, costCentsPerEvent: numericFieldSchema, minutesPerEvent: numericFieldSchema })).min(1).max(100) }),
]);

export const decisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  title: text,
  description: text,
  originalInput: text,
  currency: z.literal("USD"),
  options: z.tuple([optionSchema, optionSchema]),
  tags: z.array(tagSchema).max(100),
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
