import { describe, expect, it } from "vitest";
import { parseCanonicalNumber } from "./units";

describe("parseCanonicalNumber", () => {
  it("converts common decimal dollar amounts to exact cents", () => {
    expect(parseCanonicalNumber("0.29", 100)).toBe(29);
    expect(parseCanonicalNumber("2.55", 100)).toBe(255);
    expect(parseCanonicalNumber("1500.00", 100)).toBe(150000);
  });

  it("only accepts frequencies that map to whole events", () => {
    expect(parseCanonicalNumber("0.5", 2)).toBe(1);
    expect(parseCanonicalNumber("0.25", 2)).toBeNull();
    expect(parseCanonicalNumber("1.5", 1)).toBeNull();
  });

  it("rejects malformed, negative, overprecise, and unsafe values", () => {
    expect(parseCanonicalNumber("-1", 100)).toBeNull();
    expect(parseCanonicalNumber("2.555", 100)).toBeNull();
    expect(parseCanonicalNumber("1e3", 100)).toBeNull();
    expect(parseCanonicalNumber("9007199254740992", 1)).toBeNull();
  });
});
