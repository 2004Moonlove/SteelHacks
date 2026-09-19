import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  decisionSchema,
  factorSchema,
  analysisSchema,
} from "../src/choice/schema.ts";
const suggestions = z
  .object({
    decisionId: z.string(),
    version: z.number().int(),
    factors: z.array(factorSchema).max(10),
    questions: z.array(z.string()).max(3),
  })
  .strict();
for (const [name, schema] of Object.entries({
  decision: decisionSchema,
  factors: suggestions,
  analysis: analysisSchema,
})) {
  const path = fileURLToPath(
    new URL(
      `../../backend/src/main/resources/choice-${name}.schema.json`,
      import.meta.url,
    ),
  );
  const content = JSON.stringify(z.toJSONSchema(schema), null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== content)
      throw new Error(`Schema out of date: ${name}`);
  } else writeFileSync(path, content);
}
