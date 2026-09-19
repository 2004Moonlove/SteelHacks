import {
  analysisSchema,
  decisionSchema,
  factorSchema,
  type ChoiceDecision,
  type Factor,
  type MaterialAnalysis,
  normalizeName,
} from "./schema";
import { z } from "zod";

async function post(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/choices/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(135000)])
        : AbortSignal.timeout(135000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      "The model request timed out or the local service is unavailable. Your decision is preserved; retry when the backend is ready.",
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data && typeof data === "object" && "message" in data
        ? String(data.message)
        : "The service could not complete the request.",
    );
  return data;
}
export async function understand(description: string, signal?: AbortSignal) {
  const parsed = decisionSchema.safeParse(
    await post("understand", { description }, signal),
  );
  if (!parsed.success)
    throw new Error(
      "The model result failed validation. Your input is preserved; please retry.",
    );
  return parsed.data;
}
const suggestionsSchema = z
  .object({
    decisionId: z.string(),
    version: z.number().int(),
    factors: z.array(factorSchema).max(10),
    questions: z.array(z.string()).max(3),
  })
  .strict();
export async function suggest(decision: ChoiceDecision, instruction: string) {
  const parsed = suggestionsSchema.safeParse(
    await post("factors", { decision, instruction }),
  );
  if (!parsed.success)
    throw new Error("The proposed factors failed validation.");
  if (
    parsed.data.decisionId !== decision.id ||
    parsed.data.version !== decision.version
  )
    throw new Error("The response belongs to a different decision version.");
  return parsed.data;
}
export function mergeSuggestions(d: ChoiceDecision, factors: Factor[]) {
  const names = new Set(d.factors.map((f) => normalizeName(f.name)));
  const added: Factor[] = [],
    duplicates: string[] = [];
  for (const f of factors) {
    if (
      names.has(normalizeName(f.name)) ||
      d.factors.some(
        (old) =>
          old.id === f.id ||
          (old.ruleId !== null &&
            old.ruleId === f.ruleId &&
            old.optionIds.some((id) => f.optionIds.includes(id))),
      )
    ) {
      duplicates.push(f.name);
      continue;
    }
    names.add(normalizeName(f.name));
    added.push({ ...f, confirmed: false });
  }
  const next = { ...d, factors: [...d.factors, ...added] };
  if (!decisionSchema.safeParse(next).success)
    throw new Error(
      "The proposed factors contain invalid references or incompatible units.",
    );
  return { decision: next, added, duplicates };
}
export function validateAnalysis(
  analysis: MaterialAnalysis,
  d: ChoiceDecision,
  optionId: string,
) {
  if (
    analysis.decisionId !== d.id ||
    analysis.version !== d.version ||
    analysis.optionId !== optionId
  )
    throw new Error("The material response belongs to a different version.");
  const materials = d.options.find((o) => o.id === optionId)!.materials;
  for (const evidence of [
    ...analysis.findings.flatMap((f) => f.evidence),
    ...analysis.extracted,
  ]) {
    if (
      !materials
        .find((m) => m.id === evidence.materialId)
        ?.text.includes(evidence.quote)
    )
      throw new Error(
        "The analysis quoted text that is not in this option's materials.",
      );
  }
  for (const e of analysis.extracted) {
    const f = d.factors.find(
      (f) => f.id === e.factorId && f.optionIds.includes(optionId),
    );
    if (!f || e.unit !== f.unit)
      throw new Error(
        "An extracted value has an invalid factor or mismatched unit.",
      );
    const next = structuredClone(d);
    next.factors.find((f) => f.id === e.factorId)!.values[optionId] = {
      value: e.value,
      source: {
        kind: "material",
        note: e.note,
        materialId: e.materialId,
        quote: e.quote,
      },
    };
    if (!decisionSchema.safeParse(next).success)
      throw new Error("An extracted value has an invalid data type.");
  }
  return analysis;
}
export async function analyze(d: ChoiceDecision, optionId: string) {
  const parsed = analysisSchema.safeParse(
    await post("materials", { decision: d, optionId }),
  );
  if (!parsed.success)
    throw new Error("The material analysis failed validation.");
  return validateAnalysis(parsed.data, d, optionId);
}
