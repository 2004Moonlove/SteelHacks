import { describe, expect, it } from "vitest";
import generatedContract from "../../../backend/src/main/resources/decision-generation.schema.json";
import { buildGenerationContract } from "./generation-contract";

describe("model generation contract", () => {
  it("keeps the backend prompt schema in sync with the frontend validator", () => {
    expect(buildGenerationContract()).toEqual(generatedContract);
  });

  it("permits only model-owned numeric sources and adaptive Tag bounds and explicit v2 mode", () => {
    const schema = buildGenerationContract();
    const encoded = JSON.stringify(schema);
    expect(encoded).not.toContain('"const":"user_edit"');
    expect(encoded).not.toContain('"importance"');
    expect(encoded).not.toContain('"const":"demo_assumption"');
    expect(encoded).toContain('"const":"unknown"');
    expect(encoded).toContain('"const":"derived"');
    expect(schema.properties?.tags).toMatchObject({ minItems: 0, maxItems: 30 });
    expect(schema.properties?.schemaVersion).toMatchObject({ const: 2 });
    expect(schema.required).toContain("comparisonMode");
  });
});
