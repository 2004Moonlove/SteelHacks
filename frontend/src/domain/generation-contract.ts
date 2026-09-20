import { z } from "zod";
import { decisionSchema, numericFieldSchema } from "./schema";

export function buildGenerationContract() {
  const schema = z.toJSONSchema(decisionSchema, {
    target: "draft-07",
    reused: "ref",
    override: ({ zodSchema, jsonSchema }) => {
      if (jsonSchema.properties?.importance) {
        delete jsonSchema.properties.importance;
        jsonSchema.required = jsonSchema.required?.filter((key) => key !== "importance");
      }
      if (zodSchema === numericFieldSchema && jsonSchema.oneOf) {
        jsonSchema.oneOf = jsonSchema.oneOf.filter((variant) => {
          const sourceSchema = variant.properties?.source;
          const source = typeof sourceSchema === "object" ? sourceSchema.const : undefined;
          return source === "user_input" || source === "derived" || source === "unknown";
        });
      }
    },
  });
  const tags = schema.properties?.tags;
  if (!tags || typeof tags !== "object") throw new Error("The generation contract must define Tags.");
  tags.minItems = 0;
  tags.maxItems = 30;
  if (schema.properties) schema.properties.schemaVersion = { const: 2, type: "number" };
  schema.required = [...new Set([...(schema.required ?? []), "comparisonMode"])];
  return schema;
}
