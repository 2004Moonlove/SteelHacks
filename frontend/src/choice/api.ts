import { z } from "zod";
import { choiceDecisionSchema, factorSchema, materialAnalysisSchema } from "./schema";
import type { ChoiceDecision, Factor, MaterialAnalysis } from "./types";

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), 150_000);
  const abort = () => timeout.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`/api/choices/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: timeout.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = z.object({ message: z.string() }).safeParse(payload);
      throw new Error(error.success ? error.data.message : `Request failed (${response.status}). Please try again.`);
    }
    return payload;
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Request canceled", "AbortError");
    if (timeout.signal.aborted) throw new Error("The model took too long. Your inputs are saved on this screen; retry or continue manually.");
    if (error instanceof TypeError) throw new Error("The local service is unavailable. Start the backend and retry, or continue manually.");
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function generateChoice(description: string, signal?: AbortSignal): Promise<ChoiceDecision> {
  const parsed = choiceDecisionSchema.safeParse(await post("generate", { description }, signal));
  if (!parsed.success) throw new Error("The model returned an invalid decision. Your description is preserved. Please retry or build a manual comparison.");
  return parsed.data as ChoiceDecision;
}

export async function suggestFactors(decision: ChoiceDecision, instruction: string, signal?: AbortSignal) {
  const schema = z.object({ decisionId: z.string(), decisionVersion: z.number().int(), factors: z.array(factorSchema), questions: z.array(z.string()) });
  const parsed = schema.safeParse(await post("factors", { decision, instruction }, signal));
  if (!parsed.success) throw new Error("The factor suggestions could not be validated. Your existing factors have been kept.");
  return parsed.data as { decisionId: string; decisionVersion: number; factors: Factor[]; questions: string[] };
}

export async function analyzeMaterials(decision: ChoiceDecision, optionId: string, signal?: AbortSignal): Promise<MaterialAnalysis> {
  const parsed = materialAnalysisSchema.safeParse(await post("materials", { decision, optionId }, signal));
  if (!parsed.success) throw new Error("The material analysis could not be validated. No values have been changed.");
  const result = parsed.data as MaterialAnalysis;
  const option = decision.options.find(item => item.id === optionId);
  if (result.decisionId !== decision.id || result.decisionVersion !== decision.version || result.optionId !== optionId || !option) throw new Error("The analysis belongs to a different decision version. Please retry.");
  for (const finding of result.findings) {
    if (finding.optionId !== optionId || finding.quotes.some(evidence => !option.materials.some(material => material.id === evidence.materialId && material.text.includes(evidence.quote)))) throw new Error("A material citation could not be verified against the supplied text. No values have been changed.");
  }
  for (const extraction of result.extractions) {
    if (extraction.optionId !== optionId || !option.materials.some(material => material.id === extraction.materialId && material.text.includes(extraction.quote))) throw new Error("An extracted value has no matching source quotation. No values have been changed.");
  }
  return result;
}
