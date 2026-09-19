import { z } from "zod";

export const scalarSchema = z.union([
  z.number().finite().min(-1e12).max(1e12),
  z.string().max(2000),
  z.boolean(),
  z.null(),
]);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const sourceSchema = z
  .object({
    kind: z.enum([
      "user",
      "model_suggestion",
      "demo",
      "material",
      "assumption",
      "unknown",
    ]),
    note: z.string().max(2000),
    materialId: id.optional(),
    quote: z.string().max(2000).optional(),
  })
  .strict();
export const valueSchema = z
  .object({ value: scalarSchema, source: sourceSchema })
  .strict();
export const factorSchema = z
  .object({
    id,
    name: z.string().min(1).max(100),
    reason: z.string().max(1000),
    optionIds: z.array(id).min(1).max(6),
    dataType: z.enum([
      "number",
      "money",
      "duration",
      "date",
      "boolean",
      "category",
      "text",
    ]),
    unit: z.string().max(40),
    allowedValues: z.array(z.string().max(100)).max(20),
    direction: z.enum(["lower", "higher", "target", "none"]),
    purpose: z.enum(["hard", "preference", "reference"]),
    importance: z.number().int().min(1).max(5),
    target: z
      .object({
        min: z.number().finite().optional(),
        max: z.number().finite().optional(),
        equals: scalarSchema.optional(),
      })
      .strict(),
    values: z.record(id, valueSchema),
    source: sourceSchema,
    confirmed: z.boolean(),
    ruleId: z
      .enum([
        "upfront",
        "recurring",
        "billing_months",
        "per_use",
        "time_per_use",
        "time_monthly",
        "commitment_months",
      ])
      .nullable(),
  })
  .strict();
export const materialSchema = z
  .object({
    id,
    title: z.string().min(1).max(150),
    text: z.string().min(1).max(12000),
  })
  .strict();
export const decisionSchema = z
  .object({
    schemaVersion: z.literal(2),
    id,
    version: z.number().int().nonnegative(),
    title: z.string().min(1).max(200),
    description: z.string().max(8000),
    domain: z.string().min(1).max(80),
    decisionType: z.enum([
      "choose_one",
      "buy_or_not",
      "continue_or_exit",
      "now_or_later",
      "other",
    ]),
    goals: z
      .array(
        z
          .object({
            text: z.string().max(1000),
            basis: z.enum(["explicit", "suggested"]),
          })
          .strict(),
      )
      .max(12),
    currency: z.enum(["USD", "CNY", "EUR", "GBP"]),
    context: z
      .object({
        months: z.number().int().min(1).max(120).nullable(),
        usesPerWeek: z.number().min(0).max(168).nullable(),
        budgetCents: z.number().int().min(0).max(1e12).nullable(),
        budgetScope: z.enum(["total", "first_payment"]),
        source: sourceSchema,
      })
      .strict(),
    options: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(100),
            description: z.string().max(1000),
            materials: z.array(materialSchema).max(8),
          })
          .strict(),
      )
      .min(2)
      .max(6),
    factors: z.array(factorSchema).max(30),
    primaryFactorId: id.nullable(),
    questions: z.array(z.string().min(1).max(1000)).max(3),
    charts: z.array(z.enum(["cost_bar", "cumulative_cost", "time_bar"])).max(3),
    origin: z.enum(["manual", "demo", "model"]),
  })
  .strict()
  .superRefine((d, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const optionIds = new Set(d.options.map((o) => o.id));
    if (
      optionIds.size !== d.options.length ||
      new Set(d.factors.map((f) => f.id)).size !== d.factors.length
    )
      fail("IDs must be unique.");
    const materialIds = d.options.flatMap((o) => o.materials.map((m) => m.id));
    if (new Set(materialIds).size !== materialIds.length)
      fail("Material IDs must be unique.");
    const rules = new Set<string>();
    for (const f of d.factors) {
      if (
        new Set(f.optionIds).size !== f.optionIds.length ||
        f.optionIds.some((oid) => !optionIds.has(oid)) ||
        Object.keys(f.values).some((oid) => !f.optionIds.includes(oid))
      )
        fail(`${f.name}: invalid option references.`);
      if (
        ["boolean", "category", "text"].includes(f.dataType) &&
        ["lower", "higher"].includes(f.direction) &&
        f.dataType !== "category"
      )
        fail(`${f.name}: use an explicit target for this type.`);
      if (
        f.ruleId &&
        f.dataType !==
          (f.ruleId.includes("time")
            ? "duration"
            : ["billing_months", "commitment_months"].includes(f.ruleId)
              ? "number"
              : "money")
      )
        fail(`${f.name}: rule and data type do not match.`);
      if (
        f.ruleId &&
        f.unit !==
          (f.dataType === "money"
            ? d.currency
            : f.dataType === "duration"
              ? "min"
              : "months")
      )
        fail(`${f.name}: the calculation rule has incompatible units.`);
      if (
        f.target.min !== undefined &&
        f.target.max !== undefined &&
        f.target.min > f.target.max
      )
        fail(`${f.name}: minimum exceeds maximum.`);
      const targetValue = f.target.equals;
      if (targetValue !== undefined && targetValue !== null) {
        if (
          ["number", "money", "duration"].includes(f.dataType) &&
          typeof targetValue !== "number"
        )
          fail(`${f.name}: target must be numeric.`);
        if (f.dataType === "money" && !Number.isSafeInteger(targetValue))
          fail(`${f.name}: target must use integer cents.`);
        if (f.dataType === "boolean" && typeof targetValue !== "boolean")
          fail(`${f.name}: target must be yes/no.`);
        if (
          ["text", "category", "date"].includes(f.dataType) &&
          typeof targetValue !== "string"
        )
          fail(`${f.name}: target must be text.`);
        if (
          f.dataType === "date" &&
          (typeof targetValue !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(targetValue) ||
            !Number.isFinite(Date.parse(targetValue)) ||
            new Date(targetValue).toISOString().slice(0, 10) !== targetValue)
        )
          fail(`${f.name}: invalid target date.`);
      }
      if (
        (f.target.min !== undefined || f.target.max !== undefined) &&
        !["number", "money", "duration"].includes(f.dataType)
      )
        fail(`${f.name}: numeric ranges require a numeric factor.`);
      for (const oid of f.optionIds) {
        const field = f.values[oid];
        if (!field) {
          fail(`${f.name}: missing value entry.`);
          continue;
        }
        const v = field.value;
        if (v === null) continue;
        if (field.source.kind === "unknown")
          fail(`${f.name}: unknown sources cannot contain a value.`);
        if (
          ["number", "money", "duration"].includes(f.dataType) &&
          typeof v !== "number"
        )
          fail(`${f.name}: a number is required.`);
        if (f.dataType === "money" && !Number.isSafeInteger(v))
          fail(`${f.name}: use integer cents.`);
        if (f.dataType === "boolean" && typeof v !== "boolean")
          fail(`${f.name}: a yes/no value is required.`);
        if (
          ["date", "category", "text"].includes(f.dataType) &&
          typeof v !== "string"
        )
          fail(`${f.name}: a text value is required.`);
        if (
          f.dataType === "date" &&
          (typeof v !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
            !Number.isFinite(Date.parse(v)) ||
            new Date(v).toISOString().slice(0, 10) !== v)
        )
          fail(`${f.name}: invalid calendar date.`);
        if (
          f.dataType === "category" &&
          f.allowedValues.length &&
          !f.allowedValues.includes(String(v))
        )
          fail(`${f.name}: value is not in the allowed list.`);
        if (
          f.ruleId &&
          (typeof v !== "number" ||
            v < 0 ||
            (["billing_months", "commitment_months"].includes(f.ruleId) &&
              !Number.isInteger(v)) ||
            (f.ruleId === "billing_months" && v < 1))
        )
          fail(`${f.name}: invalid rule value.`);
      }
      if (f.ruleId && f.confirmed)
        for (const oid of f.optionIds) {
        const key = `${oid}:${f.ruleId}`;
        if (rules.has(key))
          fail(
            `${f.name}: duplicate calculation rule; combine or remove duplicate inputs.`,
          );
        rules.add(key);
      }
    }
    if (
      d.primaryFactorId &&
      !d.factors.some(
        (f) =>
          f.id === d.primaryFactorId &&
          f.purpose === "preference" &&
          f.confirmed,
      )
    )
      fail("Select a confirmed preference as the primary factor.");
  });

export const analysisSchema = z
  .object({
    decisionId: id,
    version: z.number().int().nonnegative(),
    optionId: id,
    status: z.enum(["no_pressure", "needs_verification", "inconsistent"]),
    findings: z
      .array(
        z
          .object({
            id,
            tags: z
              .array(
                z.enum([
                  "urgency",
                  "scarcity",
                  "social_pressure",
                  "emotional_pressure",
                  "unclear_price",
                  "unclear_terms",
                  "unsupported_claim",
                  "normal_marketing",
                  "clear_disclosure",
                  "conflict",
                ]),
              )
              .min(1)
              .max(10),
            explanation: z.string().min(1).max(2000),
            evidence: z
              .array(
                z
                  .object({
                    materialId: id,
                    quote: z.string().min(1).max(2000),
                  })
                  .strict(),
              )
              .min(1)
              .max(8),
          })
          .strict(),
      )
      .max(30),
    extracted: z
      .array(
        z
          .object({
            factorId: id,
            value: scalarSchema,
            unit: z.string().max(40),
            materialId: id,
            quote: z.string().min(1).max(2000),
            note: z.string().max(1000),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type ChoiceDecision = z.infer<typeof decisionSchema>;
export type Factor = z.infer<typeof factorSchema>;
export type FieldValue = z.infer<typeof valueSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type MaterialAnalysis = z.infer<typeof analysisSchema>;
export type Scalar = z.infer<typeof scalarSchema>;
export const uid = () => crypto.randomUUID();
export const userSource: Source = {
  kind: "user",
  note: "Entered or confirmed by you.",
};
export const unknownValue = (): FieldValue => ({
  value: null,
  source: { kind: "unknown", note: "Not provided." },
});
export const normalizeName = (name: string) =>
  name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

