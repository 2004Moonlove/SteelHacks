import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeDecision,
  buildStoryRequest,
  calculationStatus,
  loadDomain,
  main,
  validateStory,
} from "./verify-scenarios.mjs";

const domain = await loadDomain();
const known = (value) => ({ value, source: "user_input" });

function qualitativeDecision(tagCount = 3) {
  return {
    schemaVersion: 2,
    comparisonMode: "qualitative",
    id: "career-choice",
    title: "Change careers or stay?",
    description: "Explore both approaches without predicting outcomes.",
    originalInput: "Should I change careers or stay?",
    currency: "USD",
    options: [
      { id: "change", name: "Change careers", fixedCosts: [], activities: [] },
      { id: "stay", name: "Stay in the current career", fixedCosts: [], activities: [] },
    ],
    tags: Array.from({ length: tagCount }, (_, index) => ({
      id: `factor-${index}`, type: "consideration", name: `Consideration ${index}`,
      description: "Explore this condition without assuming it holds.",
      targets: [
        { optionId: "change", consideration: "If support is available, consider how it could shape this transition." },
        { optionId: "stay", consideration: "If support is available, consider how it could shape the existing arrangement." },
      ],
    })),
  };
}

function quantitativeDecision(version = 1, tagCount = 5) {
  const decision = qualitativeDecision(0);
  decision.schemaVersion = version;
  if (version === 1) delete decision.comparisonMode;
  else decision.comparisonMode = "quantitative";
  decision.options.forEach((option, index) => {
    option.fixedCosts = [{ id: "fee", name: "Monthly fee", amountCentsMonthly: known((index + 1) * 1000) }];
  });
  decision.tags = Array.from({ length: tagCount }, (_, index) => ({
    id: `extra-${index}`, type: "fixed", name: `Optional service ${index}`,
    description: "An optional recurring service.",
    targets: [{ optionId: "change", costCentsMonthly: known(100), minutesMonthly: known(0) }],
  }));
  return decision;
}

function breakEvenDecision() {
  const decision = qualitativeDecision();
  decision.comparisonMode = "break_even";
  decision.id = "coffee-choice";
  decision.usageUnit = "cup";
  decision.title = "Coffee machine or Starbucks?";
  decision.originalInput = "Compare USD 300 upfront plus USD 1 per cup with USD 0 upfront plus USD 6 per cup.";
  decision.options[0].name = "Coffee machine";
  decision.options[0].usageCosts = { upfrontCents: known(30000), perUseCents: known(100) };
  decision.options[1].name = "Buying coffee at Starbucks";
  decision.options[1].usageCosts = { upfrontCents: known(0), perUseCents: known(600) };
  return decision;
}

const coffeeExpectation = {
  expectedComparisonMode: "break_even",
  expectedBaseline: "break_even",
  expectedUsageCosts: [{ upfrontCents: 30000, perUseCents: 100 }, { upfrontCents: 0, perUseCents: 600 }],
  expectedCrossover: {
    kind: "crossing", numerator: 30000, denominator: 500, firstWholeUse: 60,
    recoveryUpfrontCents: 30000, recoveryPerUseCents: 100,
  },
};

function subscriptionDecision(comparisonMonths) {
  const decision = qualitativeDecision();
  decision.comparisonMode = "subscription";
  decision.id = "gym-plans";
  decision.title = "Year card or month card?";
  decision.originalInput = "Compare a USD 600 annual card and a USD 60 monthly card.";
  if (comparisonMonths !== undefined) decision.comparisonMonths = comparisonMonths;
  decision.options[0].name = "Year card";
  decision.options[0].subscriptionCosts = { paymentCents: known(60000), periodMonths: 12 };
  decision.options[1].name = "Month card";
  decision.options[1].subscriptionCosts = { paymentCents: known(6000), periodMonths: 1 };
  return decision;
}

function storyFor(request) {
  const qualitative = request.context.mode === "qualitative";
  const paired = () => request.snapshot.decision.options.map((option, index) => ({
    optionId: option.id, text: `Explore {{option${index ? "B" : "A"}_name}} under the selected conditions.`,
  }));
  return {
    decisionId: request.snapshot.decision.id,
    simulationVersion: request.snapshot.simulationVersion,
    ...(qualitative ? { mode: "qualitative" } : {}),
    sharedScenario: { title: "Comparable paths", description: "The same conditions apply to each path." },
    moments: (qualitative ? ["beginning", "during", "later"] : ["morning", "daytime", "evening"])
      .map((key) => ({ key, options: paired() })),
    monthlyReflections: qualitative ? [] : paired(),
  };
}

test("v2 qualitative baselines accept zero, simple and upper-bound Tag counts", () => {
  for (const count of [0, 3, 30]) {
    const analysis = analyzeDecision(qualitativeDecision(count), { expectedBaseline: "qualitative" }, domain);
    assert.equal(analysis.status, "qualitative");
    assert.deepEqual(analysis.failures, []);
    assert.deepEqual(analysis.unknownBaseline, []);
    assert.ok(analysis.tags.every((tag) => tag.status === "qualitative" && !tag.baselineBlocksCalculation));
  }
  const oversized = analyzeDecision(qualitativeDecision(31), { expectedBaseline: "qualitative" }, domain);
  assert.equal(oversized.status, "invalid");
});

test("Tag checks use only the technical cap without a fixed suggested count", () => {
  for (const version of [1, 2]) {
    for (const count of [0, 3, 12, 30]) {
      assert.deepEqual(analyzeDecision(quantitativeDecision(version, count), { expectedBaseline: "valid" }, domain).failures, []);
    }
    assert.ok(analyzeDecision(quantitativeDecision(version, 31), { expectedBaseline: "valid" }, domain).failures.some((issue) => issue.includes("30")));
  }
});

test("qualitative story request simulates the first two selected considerations and uses only name facts", () => {
  const decision = qualitativeDecision();
  const calls = [];
  const request = buildStoryRequest(decision, {
    ...domain,
    simulate: (snapshotDecision, ids) => {
      calls.push([...ids]);
      return domain.simulate(snapshotDecision, ids);
    },
  });
  assert.deepEqual(calls, [["factor-0", "factor-1"]]);
  assert.deepEqual(request.snapshot.enabledTagIds, ["factor-0", "factor-1"]);
  assert.deepEqual(request.snapshot.calculation, { status: "qualitative" });
  assert.deepEqual(request.context, { mode: "qualitative" });
  assert.deepEqual(request.facts, {
    optionA_name: "Change careers", optionB_name: "Stay in the current career",
  });
});

test("qualitative story request works without Tags and quantitative requests preserve their General day path", () => {
  assert.deepEqual(buildStoryRequest(qualitativeDecision(0), domain).snapshot.enabledTagIds, []);
  const request = buildStoryRequest(quantitativeDecision(), domain);
  assert.deepEqual(request.snapshot.enabledTagIds, []);
  assert.deepEqual(request.context, { mode: "general" });
  assert.equal(request.snapshot.calculation.status, "valid");
  assert.equal(request.facts.optionA_monthlyCost, "$10.00");
});

test("missing and invalid quantitative values never become qualitative success", () => {
  const decision = quantitativeDecision();
  decision.options[0].fixedCosts[0].amountCentsMonthly = { value: null, source: "unknown" };
  assert.equal(calculationStatus(domain.simulate(decision, [])), "needs_review");
  assert.deepEqual(analyzeDecision(decision, { expectedBaseline: "needs_review" }, domain).failures, []);
  assert.throws(() => buildStoryRequest(decision, domain), /require a valid/);
  decision.options[0].fixedCosts[0].amountCentsMonthly = known(-1);
  assert.equal(calculationStatus(domain.simulate(decision, [])), "invalid");
  assert.throws(() => buildStoryRequest(decision, domain), /require a valid/);
});

test("story validation accepts qualitative, monthly, break-even, and subscription contracts", () => {
  for (const decision of [qualitativeDecision(), quantitativeDecision(), breakEvenDecision(), subscriptionDecision()]) {
    const request = buildStoryRequest(decision, domain);
    assert.deepEqual(validateStory(storyFor(request), request), []);
  }
});

test("qualitative story validation rejects mismatched mode, daily moments and monthly reflections", () => {
  const request = buildStoryRequest(qualitativeDecision(), domain);
  for (const mutate of [
    (story) => { delete story.mode; },
    (story) => { story.mode = "general"; },
    (story) => { story.moments[0].key = "morning"; },
    (story) => { story.monthlyReflections = story.moments[0].options; },
  ]) {
    const story = storyFor(request);
    mutate(story);
    assert.ok(validateStory(story, request).length > 0);
  }
});

test("story validation rejects stale identities, reordered moments/options and unavailable facts", () => {
  const request = buildStoryRequest(qualitativeDecision(), domain);
  for (const mutate of [
    (story) => { story.simulationVersion++; },
    (story) => { story.moments.reverse(); },
    (story) => { story.moments[0].options.reverse(); },
    (story) => { story.moments[0].options[0].text = "The outcome is {{optionA_monthlyCost}}."; },
  ]) {
    const story = storyFor(request);
    mutate(story);
    assert.ok(validateStory(story, request).length > 0);
  }
});


test("supplied coffee costs produce the expected break-even result regardless of option order", () => {
  const decision = breakEvenDecision();
  for (const options of [decision.options, [...decision.options].reverse()]) {
    const analysis = analyzeDecision({ ...decision, options }, coffeeExpectation, domain);
    assert.deepEqual(analysis.failures, []);
    assert.equal(analysis.status, "break_even");
    assert.equal(analysis.comparisonMode, "break_even");
    assert.equal(analysis.calculation.crossover.firstWholeUse, 60);
    assert.ok(analysis.tags.every((tag) => tag.status === "break_even" && !tag.baselineBlocksCalculation));
  }
});

test("break-even acceptance catches altered prices, thresholds and recovery options", () => {
  const decision = breakEvenDecision();
  for (const expectation of [
    { ...coffeeExpectation, expectedUsageCosts: [{ upfrontCents: 30100, perUseCents: 100 }, { upfrontCents: 0, perUseCents: 600 }] },
    { ...coffeeExpectation, expectedCrossover: { ...coffeeExpectation.expectedCrossover, numerator: 30100 } },
    { ...coffeeExpectation, expectedCrossover: { ...coffeeExpectation.expectedCrossover, recoveryUpfrontCents: 0, recoveryPerUseCents: 600 } },
  ]) {
    assert.ok(analyzeDecision(decision, expectation, domain).failures.length > 0);
  }
});

test("unknown break-even prices retain review state and the intended comparison mode", () => {
  const decision = breakEvenDecision();
  decision.options[0].usageCosts.upfrontCents = { value: null, source: "unknown" };
  const expected = { expectedComparisonMode: "break_even", expectedBaseline: "needs_review" };
  const analysis = analyzeDecision(decision, expected, domain);
  assert.deepEqual(analysis.failures, []);
  assert.equal(analysis.comparisonMode, "break_even");
  assert.equal(analysis.status, "needs_review");
  assert.ok(analysis.unknownBaseline.some((field) => field.path.endsWith("usageCosts.upfrontCents")));
  assert.throws(() => buildStoryRequest(decision, domain), /require a valid/);
  const wrongMode = quantitativeDecision();
  wrongMode.options[0].fixedCosts[0].amountCentsMonthly = { value: null, source: "unknown" };
  assert.ok(analyzeDecision(wrongMode, expected, domain).failures.some((issue) => issue.includes("comparison mode")));
});

test("break-even stories use long-term moments, selected considerations and canonical break-even facts", () => {
  const decision = breakEvenDecision();
  decision.tags[0].importance = 5;
  decision.tags[1].importance = 1;
  const request = buildStoryRequest(decision, domain);
  assert.deepEqual(request.context, { mode: "qualitative" });
  assert.deepEqual(request.snapshot.enabledTagIds, ["factor-0", "factor-1"]);
  assert.equal(request.snapshot.calculation.status, "break_even");
  assert.deepEqual(request.snapshot.calculation, domain.simulate(decision, []));
  assert.deepEqual(request.snapshot.calculation, domain.simulate(breakEvenDecision(), []));
  assert.deepEqual(request.facts, domain.buildBreakEvenStoryFacts(decision, request.snapshot.calculation));
  assert.ok(Object.keys(request.facts).some((key) => key !== "optionA_name" && key !== "optionB_name"));
  assert.ok(Object.keys(request.facts).every((key) => !key.toLowerCase().includes("monthly")));
  assert.equal(request.snapshot.decision.tags[0].importance, 5);
  assert.deepEqual(validateStory(storyFor(request), request), []);
});

test("invalid consideration importance cannot enter a story snapshot", () => {
  for (const importance of [0, 6, 1.5]) {
    const decision = breakEvenDecision();
    decision.tags[0].importance = importance;
    assert.equal(calculationStatus(domain.simulate(decision, [])), "invalid");
    assert.throws(() => buildStoryRequest(decision, domain), /require a valid/);
  }
});

test("equal and non-crossing costs remain valid break-even stories", () => {
  const equal = breakEvenDecision();
  equal.options[1].usageCosts = structuredClone(equal.options[0].usageCosts);
  const parallel = breakEvenDecision();
  parallel.options[1].usageCosts.perUseCents = known(100);
  for (const [decision, kind] of [[equal, "equal"], [parallel, "no_crossing"]]) {
    const request = buildStoryRequest(decision, domain);
    assert.equal(request.snapshot.calculation.crossover.kind, kind);
    assert.deepEqual(validateStory(storyFor(request), request), []);
    assert.deepEqual(analyzeDecision(decision, { expectedBaseline: "break_even", expectedCrossover: { kind } }, domain).failures, []);
  }
});


test("subscription acceptance checks full payments and coverage at six, twelve and thirteen months", () => {
  const cases = [
    { months: 6, annual: { totalCostCents: 60000, paymentCount: 1, coverageMonths: 12 }, monthly: { totalCostCents: 36000, paymentCount: 6, coverageMonths: 6 } },
    { months: 12, annual: { totalCostCents: 60000, paymentCount: 1, coverageMonths: 12 }, monthly: { totalCostCents: 72000, paymentCount: 12, coverageMonths: 12 } },
    { months: 13, annual: { totalCostCents: 120000, paymentCount: 2, coverageMonths: 24 }, monthly: { totalCostCents: 78000, paymentCount: 13, coverageMonths: 13 } },
  ];
  for (const { months, annual, monthly } of cases) {
    const decision = subscriptionDecision(months);
    const expected = {
      expectedComparisonMode: "subscription", expectedBaseline: "subscription", expectedComparisonMonths: months,
      expectedSubscriptionOptions: [
        { paymentCents: 60000, periodMonths: 12, ...annual },
        { paymentCents: 6000, periodMonths: 1, ...monthly },
      ],
    };
    for (const options of [decision.options, [...decision.options].reverse()]) {
      const analysis = analyzeDecision({ ...decision, options }, expected, domain);
      assert.deepEqual(analysis.failures, []);
      assert.equal(analysis.status, "subscription");
      assert.equal(analysis.calculation.timeline.length, months + 1);
      assert.deepEqual(analysis.calculation.timeline[0], { month: 0, optionACostCents: 0, optionBCostCents: 0 });
    }
  }
});

test("subscription requests use the default twelve-month window and canonical long-term facts", () => {
  const decision = subscriptionDecision();
  decision.tags[0].importance = 5;
  const request = buildStoryRequest(decision, domain);
  assert.equal(request.snapshot.calculation.status, "subscription");
  assert.equal(request.snapshot.calculation.comparisonMonths, 12);
  assert.deepEqual(request.context, { mode: "qualitative" });
  assert.deepEqual(request.snapshot.enabledTagIds, ["factor-0", "factor-1"]);
  assert.deepEqual(request.snapshot.calculation, domain.simulate(subscriptionDecision(), []));
  assert.deepEqual(request.facts, domain.buildSubscriptionStoryFacts(decision, request.snapshot.calculation));
  assert.deepEqual(validateStory(storyFor(request), request), []);
});

test("unknown subscription prices stay unknown and cannot generate cost stories", () => {
  const decision = subscriptionDecision();
  decision.options[0].subscriptionCosts.paymentCents = { value: null, source: "unknown" };
  const analysis = analyzeDecision(decision, { expectedComparisonMode: "subscription", expectedBaseline: "needs_review" }, domain);
  assert.deepEqual(analysis.failures, []);
  assert.equal(analysis.comparisonMode, "subscription");
  assert.ok(analysis.unknownBaseline.some((field) => field.path.endsWith("subscriptionCosts.paymentCents")));
  assert.throws(() => buildStoryRequest(decision, domain), /require a valid/);
});

test("subscription acceptance catches wrong windows and incorrect payment timing", () => {
  const decision = subscriptionDecision(13);
  assert.ok(analyzeDecision(decision, { expectedBaseline: "subscription", expectedComparisonMonths: 12 }, domain).failures.length > 0);
  const result = structuredClone(domain.simulate(decision, []));
  result.timeline[12].optionACostCents = 120000;
  const analysis = analyzeDecision(decision, { expectedBaseline: "subscription" }, { ...domain, simulate: () => result });
  assert.ok(analysis.failures.some((issue) => issue.includes("timeline")));
});

test("optional story advice must be paired and use available facts without breaking legacy responses", () => {
  for (const decision of [qualitativeDecision(), quantitativeDecision(), breakEvenDecision(), subscriptionDecision()]) {
    const request = buildStoryRequest(decision, domain);
    const story = storyFor(request);
    assert.deepEqual(validateStory(story, request), []);
    story.advice = request.snapshot.decision.options.map((option, index) => ({
      optionId: option.id, text: `For {{option${index ? "B" : "A"}_name}}, verify the relevant terms before deciding.`,
    }));
    assert.deepEqual(validateStory(story, request), []);
    for (const bad of [null, [], [story.advice[0]], [...story.advice].reverse(), [story.advice[0], story.advice[0]], [{ ...story.advice[0], text: "" }, story.advice[1]]]) {
      assert.ok(validateStory({ ...story, advice: bad }, request).length > 0);
    }
    const unknownFact = structuredClone(story);
    unknownFact.advice[0].text = "Check {{unsupported_result}}.";
    assert.ok(validateStory(unknownFact, request).some((issue) => issue.includes("Unknown story fact")));
  }
});

test("campus-specific mixed Tag expectations do not create a global count requirement", () => {
  const decision = quantitativeDecision(2, 5);
  decision.tags.push(...qualitativeDecision(3).tags);
  const expected = { expectedBaseline: "valid", expectedTagCount: { min: 8, max: 10 }, expectedMixedTags: true };
  assert.deepEqual(analyzeDecision(decision, expected, domain).failures, []);
  const tooFew = quantitativeDecision(2, 3);
  assert.ok(analyzeDecision(tooFew, expected, domain).failures.some((issue) => issue.includes("8–10")));
  assert.deepEqual(analyzeDecision(tooFew, { expectedBaseline: "valid" }, domain).failures, []);
  for (const tags of [quantitativeDecision(2, 8).tags, qualitativeDecision(8).tags]) {
    assert.ok(analyzeDecision({ ...decision, tags }, expected, domain).failures.some((issue) => issue.includes("both numerical")));
  }
});

test("default, help and list invocations never make network requests", async (t) => {
  const network = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  t.mock.method(console, "log", () => {});
  assert.equal(await main([]), 0);
  assert.equal(await main(["--help"]), 0);
  assert.equal(await main(["--list"]), 0);
  assert.equal(network.mock.callCount(), 0);
});
