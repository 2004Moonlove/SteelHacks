import { test, expect, type Page } from "@playwright/test";
const demo = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Annual or monthly/ }).click();
};
const stored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("clear-choice-v2")!));
test("No-ad flow, break-even, frequency invariance, summaries, desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [],
    calls: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.method() === "POST") calls.push(r.url());
  });
  await demo(page);
  await expect(page.getByTestId("option-0").getByTestId("total")).toContainText(
    "1,200",
  );
  await expect(page.getByTestId("option-1").getByTestId("total")).toContainText(
    "600",
  );
  await page.getByLabel("Use horizon in months").fill("8");
  await expect(page.getByTestId("conclusion")).toContainText("A tie");
  await page.getByLabel("Use horizon in months").fill("9");
  await expect(page.getByTestId("conclusion")).toContainText(
    "Annual membership fits",
  );
  await expect(
    page.getByTestId("option-1").getByText(/Across 9 months/),
  ).toContainText("1,350");
  await page.getByLabel("Uses per week").fill("6");
  await expect(page.getByTestId("option-1").getByTestId("total")).toContainText(
    "1,350",
  );
  expect(calls).toEqual([]);
  await page.screenshot({
    path: "../artifacts/clear-choice-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../artifacts/clear-choice-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("Custom hard factor is retained, enforced, editable, removable, and persisted", async ({
  page,
}) => {
  await demo(page);
  await page.getByRole("button", { name: /Factors & options/ }).click();
  await page.getByLabel("New factor name").fill("Cats allowed");
  await page.getByRole("button", { name: "Add factor", exact: true }).click();
  const card = page.locator('[data-factor-name="Cats allowed"]');
  await card.getByRole("button", { name: "Edit Cats allowed" }).click();
  await card.getByLabel("Cats allowed data type").selectOption("boolean");
  await card.getByLabel("Cats allowed purpose").selectOption("hard");
  await card.getByLabel("Cats allowed required value").selectOption("true");
  await card
    .getByLabel("Cats allowed — Annual membership")
    .selectOption("true");
  await card
    .getByLabel("Cats allowed — Monthly membership")
    .selectOption("false");
  await expect(page.getByTestId("conclusion")).toContainText(
    "Annual membership fits",
  );
  await page.reload();
  await page.getByRole("button", { name: /Resume:/ }).click();
  await expect(page.getByTestId("conclusion")).toContainText(
    "Annual membership fits",
  );
  await page.getByRole("button", { name: /Factors & options/ }).click();
  await page.getByRole("button", { name: /Show all/ }).click();
  await card.getByRole("button", { name: "Edit Cats allowed" }).click();
  await card.getByRole("button", { name: "Remove factor" }).click();
  await expect(page.getByTestId("conclusion")).toContainText(
    "Monthly membership fits",
  );
});
test("Unknown key data, invalid parameters, and no feasible options are visible", async ({
  page,
}) => {
  await demo(page);
  await page.getByLabel("Budget", { exact: true }).fill("0");
  await expect(page.getByTestId("conclusion")).toContainText("No option meets");
  await page.getByLabel("Budget", { exact: true }).fill("");
  await page.getByRole("button", { name: /Factors & options/ }).click();
  await page.getByLabel("Membership payment — Annual membership").fill("");
  await expect(page.getByTestId("conclusion")).toContainText(
    "missing comparable data",
  );
  await page.getByLabel("Membership payment — Annual membership").fill("-1");
  await expect(page.getByTestId("conclusion")).toContainText(
    "inputs need correction",
  );
});
test("Generic manual path supports a new domain and optional third alternative", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("What decision is on your mind?")
    .fill("Should I volunteer at a local observatory?");
  await page
    .getByRole("button", { name: "Build a comparison manually" })
    .click();
  await expect(page.getByTestId("conclusion")).toContainText(
    "Compare the tradeoffs",
  );
  await page.getByRole("button", { name: /Add an option/ }).click();
  const d = await stored(page);
  expect(d.options).toHaveLength(3);
  expect(d.description).toContain("observatory");
  expect(d.factors).toHaveLength(0);
});
test("Optional materials stay per option; mock analysis needs explicit value confirmation", async ({
  page,
}) => {
  await demo(page);
  const first = page.getByTestId("option-0"),
    second = page.getByTestId("option-1");
  for (const card of [first, second])
    await card
      .locator("summary")
      .filter({ hasText: "Supporting materials" })
      .click();
  await expect(second.getByText(/No materials provided/)).toBeVisible();
  await first
    .getByLabel("Material text — Annual membership")
    .fill("Only today. Annual fee 1200 CNY.");
  await first
    .getByRole("button", { name: "Add material", exact: true })
    .click();
  await first
    .getByLabel("Material text — Annual membership")
    .fill("Annual fee 900 CNY; verify eligibility.");
  await first
    .getByRole("button", { name: "Add material", exact: true })
    .click();
  await second
    .getByLabel("Material text — Monthly membership")
    .fill("150 CNY per month.");
  await second
    .getByRole("button", { name: "Add material", exact: true })
    .click();
  await page.route("**/api/choices/materials", async (route) => {
    const { decision: d, optionId } = route.request().postDataJSON(),
      o = d.options.find((o: any) => o.id === optionId);
    expect(o.materials).toHaveLength(2);
    await route.fulfill({
      json: {
        decisionId: d.id,
        version: d.version,
        optionId,
        status: "inconsistent",
        findings: [
          {
            id: "f",
            tags: ["conflict", "urgency"],
            explanation: "The annual fees differ; confirm eligibility.",
            evidence: [
              { materialId: o.materials[0].id, quote: "Annual fee 1200 CNY." },
              { materialId: o.materials[1].id, quote: "Annual fee 900 CNY" },
            ],
          },
        ],
        extracted: [
          {
            factorId: d.factors[0].id,
            value: 90000,
            unit: "CNY",
            materialId: o.materials[1].id,
            quote: "Annual fee 900 CNY",
            note: "Verify eligibility",
          },
        ],
      },
    });
  });
  await first.getByRole("button", { name: "Analyze all materials" }).click();
  await expect(
    first.getByText("Materials contain inconsistent information"),
  ).toBeVisible();
  await expect(first.getByTestId("total")).toContainText("1,200");
  await first.getByRole("button", { name: "Confirm this value" }).click();
  await expect(first.getByTestId("total")).toContainText("900");
  await expect(second.getByTestId("total")).toContainText("600");
  await expect(
    first.getByRole("button", { name: "Confirm this value" }),
  ).toBeDisabled();
});
test("Mock free-text understanding supports open domain and model failure preserves input", async ({
  page,
}) => {
  await page.route("**/api/choices/understand", (route) =>
    route.fulfill({
      status: 503,
      json: {
        message:
          "Model access is not configured. Set NVIDIA_API_KEY and NVIDIA_MODEL.",
      },
    }),
  );
  await page.goto("/");
  await page
    .getByLabel("What decision is on your mind?")
    .fill("我要不要接一份周末兼职？必须周日休息。");
  await page.getByRole("button", { name: "Explore my choices" }).click();
  await expect(page.getByRole("alert")).toContainText("NVIDIA_API_KEY");
  await expect(page.getByLabel("What decision is on your mind?")).toHaveValue(
    "我要不要接一份周末兼职？必须周日休息。",
  );
  await page.getByRole("button", { name: /Annual or monthly/ }).click();
  const d = await stored(page);
  d.origin = "model";
  d.title = "A new domain";
  d.domain = "community";
  d.primaryFactorId = null;
  d.factors.forEach((f: any) => (f.confirmed = false));
  await page.getByRole("button", { name: "Clear Choice home" }).click();
  await page.unroute("**/api/choices/understand");
  await page.route("**/api/choices/understand", (route) =>
    route.fulfill({ json: d }),
  );
  await page
    .getByLabel("What decision is on your mind?")
    .fill("An unusual decision");
  await page.getByRole("button", { name: "Explore my choices" }).click();
  await expect(
    page.getByRole("heading", { name: "A new domain" }),
  ).toBeVisible();
  await expect(page.getByText("Proposed · review").first()).toBeVisible();
});
test("Slow model response cannot overwrite intervening edits", async ({
  page,
}) => {
  await demo(page);
  let release: () => void = () => {};
  let captured: any;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/choices/factors", async (route) => {
    captured = route.request().postDataJSON().decision;
    await gate;
    await route.fulfill({
      json: {
        decisionId: captured.id,
        version: captured.version,
        factors: [],
        questions: [],
      },
    });
  });
  await page
    .getByLabel("Additional requirements")
    .fill("I need to bring my cat.");
  await page.getByRole("button", { name: "Suggest factors" }).click();
  await expect.poll(() => captured != null).toBe(true);
  await page.getByLabel("Use horizon in months").fill("9");
  release();
  await expect(page.getByRole("status")).toContainText("Your decision changed");
  await expect(page.getByLabel("Use horizon in months")).toHaveValue("9");
});
test("Information entry creates an option with material and can become a decision", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Help me understand this" }).click();
  await page
    .getByLabel("What information would you like to check?")
    .fill("Only today: a workshop for 100 USD.");
  await page.getByRole("button", { name: "Use this information" }).click();
  const d = await stored(page);
  expect(d.options[0].materials).toHaveLength(1);
  expect(d.options[1].materials).toHaveLength(0);
  expect(d.options[0].materials[0].text).toContain("100 USD");
});
