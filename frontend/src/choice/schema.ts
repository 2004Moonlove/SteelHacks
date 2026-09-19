import { z } from 'zod';

const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'IDs use letters, digits, underscores or hyphens');
const name = z.string().trim().min(1).max(150);
const text = z.string().max(30000);
const safe = z.number().finite().refine((n) => Math.abs(n) <= Number.MAX_SAFE_INTEGER, 'Number exceeds safe arithmetic range');
const nonnegative = safe.nonnegative();
const money = z.number().int().nonnegative().refine(Number.isSafeInteger, 'Money must be safe integer minor units');
const valuePrimitive = z.union([safe, z.string().max(4000), z.boolean(), z.null()]);
export const valueSchema = z.object({
  value: valuePrimitive,
  source: z.enum(['user_input', 'user_edit', 'model_suggestion', 'demo', 'material', 'unknown', 'derived']),
  note: z.string().max(2000),
  materialId: id.optional(), quote: z.string().min(1).max(4000).optional(),
}).strict().superRefine((v, ctx) => {
  if ((v.value === null) !== (v.source === 'unknown')) ctx.addIssue({ code: 'custom', message: 'Unknown values must be null with source unknown', path: ['source'] });
  if (v.source === 'material' && (!v.materialId || !v.quote)) ctx.addIssue({ code: 'custom', message: 'Material values require a material ID and exact quote' });
});
const numericValue = (kind: 'money' | 'number' | 'months') => valueSchema.superRefine((v, ctx) => {
  if (v.value === null) return;
  const check = kind === 'money' ? money.safeParse(v.value) : kind === 'months'
    ? z.number().int().min(1).max(120).safeParse(v.value) : nonnegative.safeParse(v.value);
  if (!check.success) ctx.addIssue({ code: 'custom', path: ['value'], message: kind === 'money' ? 'Expected nonnegative integer minor units' : kind === 'months' ? 'Months must be whole numbers from 1 to 120' : 'Expected a finite nonnegative number' });
});
export const materialSchema = z.object({ id, title: z.string().min(1).max(200), text: z.string().max(12000) }).strict();
export const costItemSchema = z.object({ id, name, cadence: z.enum(['one_time', 'monthly', 'annual', 'per_use']), amount: numericValue('money') }).strict();
export const choiceOptionSchema = z.object({
  id, name, description: z.string().max(3000), costs: z.array(costItemSchema).max(30), costsComplete: z.boolean(),
  minutesPerUse: numericValue('number'), minutesPerMonth: numericValue('number'), materials: z.array(materialSchema).max(10),
}).strict();

function validDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function factorPrimitiveMatches(type: string, value: unknown): boolean {
  if (value === null) return true;
  if (['number', 'money', 'duration'].includes(type)) return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER && (type === 'number' || value >= 0) && (type !== 'money' || Number.isSafeInteger(value));
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'date') return validDate(value);
  return typeof value === 'string';
}
export const factorSchema = z.object({
  id, name, reason: z.string().max(2000), optionIds: z.array(id).min(1).max(6),
  dataType: z.enum(['number', 'money', 'duration', 'date', 'boolean', 'category', 'text']),
  unit: z.string().max(80), allowedValues: z.array(z.string().min(1).max(150)).max(30),
  direction: z.enum(['minimize', 'maximize', 'target', 'none']), purpose: z.enum(['hard', 'preference', 'reference']),
  importance: z.number().int().min(1).max(5),
  target: z.object({ min: z.union([safe, z.string(), z.null()]), max: z.union([safe, z.string(), z.null()]), desired: valuePrimitive }).strict(),
  values: z.record(id, valueSchema), origin: z.enum(['user', 'model', 'demo']), confirmed: z.boolean(), userQuote: text.optional(),
  ruleId: z.enum(['total_cost', 'first_payment', 'monthly_payment', 'cost_per_use', 'total_time', 'monthly_time']).optional(),
}).strict().superRefine((f, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
  if (new Set(f.optionIds).size !== f.optionIds.length) issue('Duplicate applicable option');
  if (new Set(f.allowedValues).size !== f.allowedValues.length) issue('Duplicate allowed category');
  if (f.dataType === 'duration' && f.unit !== 'minutes') issue('Duration factors use minutes', ['unit']);
  if (f.optionIds.some((oid) => !Object.hasOwn(f.values, oid))) issue('Supply a value or explicit unknown for every applicable option', ['values']);
  if (f.dataType === 'text' && (f.purpose !== 'reference' || f.direction !== 'none')) issue('Text descriptions are reference information, not numeric rankings or requirements');
  for (const [optionId, v] of Object.entries(f.values)) {
    if (!f.optionIds.includes(optionId)) issue('Value supplied for an inapplicable option', ['values', optionId]);
    if (!factorPrimitiveMatches(f.dataType, v.value)) issue('Value does not match factor type', ['values', optionId, 'value']);
    if (f.dataType === 'category' && f.allowedValues.length && v.value !== null && !f.allowedValues.includes(String(v.value))) issue('Category is not an allowed value', ['values', optionId, 'value']);
  }
  for (const [key, v] of Object.entries(f.target)) {
    if (!factorPrimitiveMatches(f.dataType, v)) issue('Target does not match factor type', ['target', key]);
  }
  if (f.target.min !== null && f.target.max !== null && f.target.min > f.target.max) issue('Minimum cannot exceed maximum', ['target']);
  if (['boolean', 'category', 'text'].includes(f.dataType) && (f.target.min !== null || f.target.max !== null)) issue('This factor type needs an explicit desired value, not a range');
  if (f.dataType === 'category' && f.target.desired !== null && f.allowedValues.length && !f.allowedValues.includes(String(f.target.desired))) issue('Desired category is not an allowed value');
  if (f.purpose === 'hard' && f.confirmed && f.origin !== 'model' && Object.values(f.target).every((v) => v === null)) issue('A confirmed requirement needs an explicit target');
  if (f.ruleId) {
    const expected = f.ruleId.includes('time') ? 'duration' : 'money';
    if (f.dataType !== expected) issue('Calculation rule does not match factor type', ['ruleId']);
    if (expected === 'duration' && f.unit !== 'minutes') issue('Calculated duration uses minutes', ['unit']);
  }
});

export const choiceDecisionSchema = z.object({
  schemaVersion: z.literal(2), id, version: z.number().int().nonnegative().refine(Number.isSafeInteger),
  title: z.string().trim().min(1).max(250), description: z.string().max(4000), originalInput: z.string().max(8000), domain: z.string().min(1).max(250), decisionType: z.string().min(1).max(250),
  template: z.enum(['general', 'subscription', 'housing', 'purchase']), currency: z.enum(['USD', 'CNY', 'EUR', 'GBP', 'CAD']),
  goals: z.array(z.object({ text: z.string().min(1).max(2000), source: z.enum(['user_input', 'model_suggestion']), quote: z.string().max(4000) }).strict()).max(20),
  context: z.object({ months: numericValue('months'), usesPerMonth: numericValue('number'), budgetCents: numericValue('money') }).strict(),
  options: z.array(choiceOptionSchema).min(2).max(6), factors: z.array(factorSchema).max(40), primaryFactorId: id.nullable(),
  questions: z.array(z.string().min(1).max(1000)).max(10), assumptions: z.array(z.string().max(1000)).max(20), mode: z.enum(['live', 'demo', 'manual']),
}).strict().superRefine((d, ctx) => {
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });
  const unique = (ids: string[], path: (string | number)[]) => { if (new Set(ids).size !== ids.length) issue('Duplicate IDs are not allowed', path); };
  unique(d.options.map((o) => o.id), ['options']); unique(d.factors.map((f) => f.id), ['factors']);
  unique(d.options.flatMap((o) => o.materials.map((m) => m.id)), ['options']);
  if (d.options.flatMap((o) => o.materials).reduce((sum, m) => sum + m.text.length, 0) > 60000) issue('Combined material text exceeds 60,000 characters', ['options']);
  const optionIds = new Set(d.options.map((o) => o.id));
  const checkMaterial = (v: z.infer<typeof valueSchema>, optionId: string | null, path: (string | number)[]) => {
    if (v.source !== 'material') return;
    const materials = d.options.filter((o) => optionId === null || o.id === optionId).flatMap((o) => o.materials);
    const material = materials.find((m) => m.id === v.materialId);
    if (!material || !v.quote || !material.text.includes(v.quote)) issue('Material source must quote a supplied material belonging to this option', path);
  };
  d.options.forEach((o, oi) => {
    unique(o.costs.map((c) => c.id), ['options', oi, 'costs']);
    o.costs.forEach((c, ci) => checkMaterial(c.amount, o.id, ['options', oi, 'costs', ci, 'amount']));
    checkMaterial(o.minutesPerUse, o.id, ['options', oi, 'minutesPerUse']); checkMaterial(o.minutesPerMonth, o.id, ['options', oi, 'minutesPerMonth']);
  });
  Object.entries(d.context).forEach(([key, v]) => checkMaterial(v, null, ['context', key]));
  d.factors.forEach((f, fi) => {
    f.optionIds.forEach((oid) => { if (!optionIds.has(oid)) issue('Factor references a missing option', ['factors', fi, 'optionIds']); });
    if (f.dataType === 'money' && f.unit !== d.currency) issue('Money factor currency must match decision currency', ['factors', fi, 'unit']);
    Object.entries(f.values).forEach(([oid, v]) => checkMaterial(v, oid, ['factors', fi, 'values', oid]));
  });
  if (d.primaryFactorId !== null && !d.factors.some((f) => f.id === d.primaryFactorId && f.purpose === 'preference')) issue('Primary preference must reference a preference factor', ['primaryFactorId']);
});

export const materialAnalysisSchema = z.object({
  decisionId: id, decisionVersion: z.number().int().nonnegative(), optionId: id,
  status: z.enum(['no_materials', 'no_pressure_found', 'needs_verification', 'inconsistent']),
  findings: z.array(z.object({
    id, optionId: id, materialIds: z.array(id).min(1), quotes: z.array(z.object({ materialId: id, quote: z.string().min(1) }).strict()).min(1),
    labels: z.array(z.enum(['urgency', 'scarcity', 'social_pressure', 'emotional_pressure', 'unclear_price', 'unclear_terms', 'unsupported_claim', 'normal_marketing', 'disclosed', 'conflict'])).min(1),
    explanation: text, needsVerification: z.boolean(),
  }).strict()).max(40),
  extractions: z.array(z.object({ id, optionId: id, materialId: id, quote: z.string().min(1), label: z.string().min(1).max(200), value: z.union([safe, z.string(), z.boolean()]), unit: z.string(), costId: id.nullable(), factorId: id.nullable() }).strict()).max(40),
  limitations: z.array(z.string().max(1500)).max(12),
}).strict().superRefine((a, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (new Set(a.findings.map((f) => f.id)).size !== a.findings.length || new Set(a.extractions.map((e) => e.id)).size !== a.extractions.length) issue('Analysis IDs must be unique');
  if (a.findings.some((f) => f.optionId !== a.optionId) || a.extractions.some((e) => e.optionId !== a.optionId)) issue('Analysis must belong to one option');
  if (a.findings.some((f) => f.quotes.some((q) => !f.materialIds.includes(q.materialId)))) issue('Quote references a material outside its finding');
  if (a.status === 'no_materials' && (a.findings.length || a.extractions.length)) issue('No-material status cannot include findings or extracted values');
  const conflicts = a.findings.some((f) => f.labels.includes('conflict'));
  const verification = a.findings.some((f) => f.needsVerification);
  if (a.status === 'inconsistent' && !conflicts) issue('Inconsistent status needs a quoted conflict');
  if (conflicts && a.status !== 'inconsistent') issue('A conflict must be shown as inconsistent');
  if (verification && a.status === 'no_pressure_found') issue('Verification findings require needs-verification status');
});
