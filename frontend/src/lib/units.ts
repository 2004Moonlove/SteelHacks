import { z } from "zod";

const safeCount = z.number().int().nonnegative().refine(Number.isSafeInteger);

export function parseCanonicalNumber(raw: string, scale: number): number | null {
  if (!Number.isSafeInteger(scale) || scale < 1) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw.trim());
  if (!match || (scale === 100 && (match[2]?.length ?? 0) > 2)) return null;
  const fractional = match[2] ?? "";
  const denominator = 10n ** BigInt(fractional.length);
  const numerator = BigInt(match[1]) * denominator + BigInt(fractional || "0");
  const canonical = numerator * BigInt(scale);
  if (canonical % denominator !== 0n) return null;
  const number = Number(canonical / denominator);
  return safeCount.safeParse(number).success ? number : null;
}
