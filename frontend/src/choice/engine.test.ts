import { describe, expect, it } from "vitest";
import { compare, impact, lifeSummary, meets } from "./engine";
import { blankDecision, demoDecision, makeFactor } from "./fixtures";
import {
  decisionSchema,
  type ChoiceDecision,
  type MaterialAnalysis,
  uid,
} from "./schema";
import { mergeSuggestions, validateAnalysis } from "./api";
const gym = () => demoDecision("gym");
const value = (
  d: ChoiceDecision,
  rule: string,
  index: number,
  v: number | null,
) => {
  d.factors.find((f) => f.ruleId === rule)!.values[d.options[index].id].value =
    v;
};
describe("Clear Choice deterministic acceptance", () => {
  it.each([
    [4, 120000, 60000, 1],
    [8, 120000, 120000, -1],
    [9, 120000, 135000, 0],
    [13, 240000, 195000, 1],
  ])(
    "uses actual scheduled payments at %i months",
    (months, annual, monthly, preferred) => {
      const d = gym();
      d.context.months = months;
      const r = compare(d);
      expect(r.options.map((o) => o.totalCents)).toEqual([annual, monthly]);
      expect(r.preferredIds).toEqual(
        preferred === -1
          ? d.options.map((o) => o.id)
          : [d.options[preferred].id],
      );
    },
  );
  it("frequency only changes cost per use when both memberships are unlimited", () => {
    const d = gym(),
      before = compare(d);
    d.context.usesPerWeek = 6;
    const after = compare(d);
    expect(after.options.map((o) => o.totalCents)).toEqual(
      before.options.map((o) => o.totalCents),
    );
    expect(after.preferredIds).toEqual(before.preferredIds);
    expect(after.options[0].perUseCents).toBe(
      Math.round(before.options[0].perUseCents! / 2),
    );
    expect(impact(before, after, d.options[0].id, d.currency)[0]).toContain(
      "unchanged",
    );
  });
  it("reports ties and the first cheaper month", () => {
    const d = gym();
    d.context.months = 9;
    expect(compare(d).breakpoints.map((p) => p.month)).toEqual([8, 9]);
  });
  it("preserves unknown prices instead of displaying zero", () => {
    const d = gym();
    value(d, "recurring", 0, null);
    const r = compare(d);
    expect(r.status).toBe("insufficient");
    expect(r.options[0].totalCents).toBeNull();
  });
  it("requires a known billing interval for recurring costs", () => {
    const d = gym();
    d.factors = d.factors.filter((f) => f.ruleId !== "billing_months");
    expect(compare(d).options[0].totalCents).toBeNull();
  });
  it("does not invent cost dimensions for a general decision", () => {
    const d = blankDecision("Should I volunteer?");
    const r = compare(d);
    expect(r.status).toBe("tradeoffs");
    expect(r.options.every((o) => o.totalCents === null)).toBe(true);
  });
  it("can use a qualitative user-ordered preference with no template", () => {
    const d = demoDecision("courses");
    d.domain = "a-new-domain";
    expect(compare(d).status).toBe("preferred");
    expect(compare(d).preferredIds).toEqual([d.options[0].id]);
  });
  it("unknown hard constraints are uncertain, not failures", () => {
    const d = demoDecision("housing");
    const r = compare(d);
    expect(r.status).toBe("insufficient");
    expect(r.options[1].feasibility).toBe("uncertain");
  });
  it("checks hard conditions before the price preference", () => {
    const d = gym();
    const f = makeFactor(d, "Must allow cats", {
      dataType: "boolean",
      purpose: "hard",
      direction: "target",
      target: { equals: true },
    });
    d.factors.push(f);
    f.values[d.options[0].id] = {
      value: true,
      source: { kind: "user", note: "Entered" },
    };
    f.values[d.options[1].id] = {
      value: false,
      source: { kind: "user", note: "Entered" },
    };
    expect(compare(d).preferredIds).toEqual([d.options[0].id]);
  });
  it("shows no solution and supports zero budget", () => {
    const d = gym();
    d.context.budgetCents = 0;
    expect(compare(d).status).toBe("no_feasible");
  });
  it("distinguishes first payment from horizon budget", () => {
    const d = gym();
    d.context.budgetCents = 20000;
    d.context.budgetScope = "first_payment";
    const r = compare(d);
    expect(r.options.map((o) => o.feasibility)).toEqual([
      "blocked",
      "eligible",
    ]);
  });
  it("keeps an unconfirmed hard factor unresolved", () => {
    const d = demoDecision("housing");
    const f = d.factors.find((f) => f.purpose === "hard")!;
    f.confirmed = false;
    expect(meets(f, d.options[0].id).status).toBe("unknown");
  });
  it("uses inclusive date thresholds", () => {
    const d = demoDecision("courses"),
      f = d.factors.find((f) => f.dataType === "date")!;
    f.purpose = "hard";
    f.target.equals = "2026-10-05";
    expect(meets(f, d.options[0].id).status).toBe("pass");
    expect(meets(f, d.options[1].id).status).toBe("fail");
  });
  it("does not translate vague quietness into a threshold", () => {
    const d = gym();
    const f = makeFactor(d, "Quiet", {
      purpose: "hard",
      values: Object.fromEntries(
        d.options.map((o) => [
          o.id,
          {
            value: "Quiet",
            source: { kind: "user", note: "Personal description" },
          },
        ]),
      ),
    });
    d.factors.push(f);
    expect(compare(d).status).toBe("insufficient");
  });
  it("reference fields never change objective comparison", () => {
    const d = gym(),
      before = compare(d);
    d.factors.push(makeFactor(d, "Sales language"));
    expect(compare(d).preferredIds).toEqual(before.preferredIds);
  });
  it("calculates additional charges from shared use frequency", () => {
    const d = gym();
    value(d, "per_use", 1, 100);
    d.context.usesPerWeek = 3;
    expect(compare(d).options[1].totalCents).toBe(65200);
  });
  it("one-option price edit leaves the other option's numbers unchanged", () => {
    const d = gym();
    const before = compare(d);
    value(d, "recurring", 0, 90000);
    const after = compare(d);
    expect(after.options[1]).toEqual(before.options[1]);
    expect(after.options[0].totalCents).toBe(90000);
  });
  it("zero visits makes unit cost unavailable, not infinity", () => {
    const d = gym();
    d.context.usesPerWeek = 0;
    expect(compare(d).options[0].perUseCents).toBeNull();
    expect(compare(d).options[0].totalCents).toBe(120000);
  });
  it("summaries and curves share updated calculation results", () => {
    const d = gym();
    d.context.months = 9;
    const r = compare(d).options[1];
    expect(r.cumulative.at(-1)?.cents).toBe(r.totalCents);
    expect(lifeSummary(d, r)[2].text).toContain("1,350");
  });
  it.each(["gym", "housing", "courses"] as const)(
    "validates the %s fictional fixture",
    (kind) => {
      expect(decisionSchema.safeParse(demoDecision(kind)).success).toBe(true);
    },
  );
  it("rejects duplicate calculation rules", () => {
    const d = gym();
    d.factors.push({ ...structuredClone(d.factors[0]), id: uid() });
    expect(compare(d).status).toBe("invalid");
  });
  it.each([-1, 0.5, NaN, Infinity])(
    "rejects invalid billing periods %s",
    (v) => {
      const d = gym();
      value(d, "billing_months", 0, v);
      expect(compare(d).status).toBe("invalid");
    },
  );
  it("rejects incompatible currency and time units", () => {
    const d = gym();
    d.factors[0].unit = "USD";
    expect(compare(d).status).toBe("invalid");
  });
  it("rejects fabricated dates and dangling references", () => {
    const d = demoDecision("courses");
    const f = d.factors.find((f) => f.dataType === "date")!;
    f.values[d.options[0].id].value = "2026-02-30";
    expect(compare(d).status).toBe("invalid");
    f.optionIds = ["missing"];
    expect(compare(d).status).toBe("invalid");
  });
  it("rejects lower/higher ordering for free text", () => {
    const d = gym();
    d.factors.push(makeFactor(d, "Quietness", { direction: "lower" }));
    expect(compare(d).status).toBe("invalid");
  });
  it("does not rank a primary factor without ordering", () => {
    const d = gym();
    d.factors[0].direction = "none";
    expect(compare(d).status).toBe("tradeoffs");
  });
  it("never mutates its input while recalculating", () => {
    const d = gym(),
      before = structuredClone(d);
    compare(d);
    compare(d);
    expect(d).toEqual(before);
  });
  it("preserves confirmed/custom factors when suggestions duplicate names or rules", () => {
    const d = gym(),
      before = structuredClone(d);
    const duplicate = {
      ...structuredClone(d.factors[0]),
      id: uid(),
      name: "membership-payment",
    };
    const newFactor = makeFactor(d, "Custom pet requirement", {
      purpose: "hard",
      dataType: "boolean",
      target: { equals: true },
    });
    const merged = mergeSuggestions(d, [duplicate, newFactor]);
    expect(d).toEqual(before);
    expect(merged.duplicates).toHaveLength(1);
    expect(merged.decision.factors.slice(0, d.factors.length)).toEqual(
      d.factors,
    );
    expect(merged.added[0].confirmed).toBe(false);
  });
});
it("rejects vague or impossible hard date targets before comparing", () => {
  const d = demoDecision("courses");
  const f = d.factors.find((f) => f.dataType === "date")!;
  f.purpose = "hard";
  f.target.equals = "soon";
  expect(compare(d).status).toBe("invalid");
  f.target.equals = "2026-02-30";
  expect(compare(d).status).toBe("invalid");
});
describe("Materials are optional and isolated", () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [1, 1],
    [2, 2],
  ])("supports %i / %i materials without changing costs or ranking", (a, b) => {
    const d = gym(),
      baseline = compare(d);
    for (const [i, count] of [a, b].entries())
      for (let n = 0; n < count; n++)
        d.options[i].materials.push({
          id: uid(),
          title: `Ad ${n}`,
          text: "Only today! Join with everyone else!",
        });
    expect(compare(d)).toEqual(baseline);
    d.options.forEach((o) =>
      o.materials.forEach((m) => {
        m.text = "A calmly worded offer with the same facts.";
      }),
    );
    expect(compare(d)).toEqual(baseline);
  });
  const setup = () => {
    const d = gym();
    d.options[0].materials = [
      { id: "ad", title: "Ad", text: "Price is 1200 CNY, paid annually." },
      {
        id: "terms",
        title: "Terms",
        text: "Price is 1300 CNY, paid annually.",
      },
    ];
    const response: MaterialAnalysis = {
      decisionId: d.id,
      version: d.version,
      optionId: d.options[0].id,
      status: "inconsistent",
      findings: [
        {
          id: "conflict",
          tags: ["conflict", "unclear_price"],
          explanation: "The prices differ.",
          evidence: [
            { materialId: "ad", quote: "1200 CNY" },
            { materialId: "terms", quote: "1300 CNY" },
          ],
        },
      ],
      extracted: [
        {
          factorId: d.factors[0].id,
          value: 130000,
          unit: "CNY",
          materialId: "terms",
          quote: "1300 CNY",
          note: "Conflicts with the current price; confirm applicability.",
        },
      ],
    };
    return { d, response };
  };
  it("accepts multiple tags and quoted conflicting evidence without applying values", () => {
    const { d, response } = setup();
    validateAnalysis(response, d, d.options[0].id);
    expect(compare(d).options[0].totalCents).toBe(120000);
  });
  it("rejects quotes not present in the selected option's material", () => {
    const { d, response } = setup();
    response.findings[0].evidence[0].quote = "Fake quote";
    expect(() => validateAnalysis(response, d, d.options[0].id)).toThrow();
  });
  it("rejects old decision versions", () => {
    const { d, response } = setup();
    d.version++;
    expect(() => validateAnalysis(response, d, d.options[0].id)).toThrow(
      /version/,
    );
  });
  it("rejects cross-option analysis and unit mismatches", () => {
    const { d, response } = setup();
    expect(() => validateAnalysis(response, d, d.options[1].id)).toThrow();
    response.extracted[0].unit = "USD";
    expect(() => validateAnalysis(response, d, d.options[0].id)).toThrow();
  });
  it("rejects invalid extracted types before confirmation", () => {
    const { d, response } = setup();
    response.extracted[0].value = "1300";
    expect(() => validateAnalysis(response, d, d.options[0].id)).toThrow();
  });
});
