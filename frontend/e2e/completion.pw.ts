import { expect, test, type Page } from "@playwright/test";
import { blankDecision, makeFactor } from "../src/choice/fixtures";
import {
  type ChoiceDecision,
  type Factor,
  unknownValue,
  userSource,
} from "../src/choice/schema";

const housing = (supplied = false): ChoiceDecision => {
  const d = blankDecision("Live on campus or off campus");
  d.title = "On-campus or off-campus housing";
  d.domain = "housing";
  d.origin = "model";
  d.options[0].name = "On-campus Housing";
  d.options[1].name = "Off-campus Housing";
  const add = (name: string, overrides: Partial<Factor>, values?: number[]) => {
    d.factors.push(
      makeFactor(d, name, {
        confirmed: false,
        source: { kind: "model_suggestion", note: "Suggested for review." },
        ...overrides,
        values: Object.fromEntries(
          d.options.map((o, i) => [
            o.id,
            values ? { value: values[i], source: userSource } : unknownValue(),
          ]),
        ),
      }),
    );
  };
  add(
    "Monthly Rent",
    { dataType: "money", unit: "USD", ruleId: "recurring" },
    supplied ? [0, 110000] : undefined,
  );
  add(
    "One-way commute",
    { dataType: "duration", unit: "min", ruleId: "time_per_use" },
    supplied ? [0, 40] : undefined,
  );
  add("Social opportunities", { dataType: "text" });
  if (supplied) {
    d.context.months = 9;
    d.context.usesPerWeek = 10;
    add(
      "Billing interval",
      { dataType: "number", unit: "months", ruleId: "billing_months" },
      [1, 1],
    );
  }
  return d;
};

const generate = async (page: Page, d: ChoiceDecision) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST")
      calls.push(new URL(request.url()).pathname);
  });
  await page.route("**/api/choices/understand", (route) =>
    route.fulfill({ json: d }),
  );
  await page.goto("/");
  await page.getByLabel("What decision is on your mind?").fill(d.description);
  await page.getByRole("button", { name: "Explore my choices" }).click();
  await expect(page.getByRole("heading", { name: d.title })).toBeVisible();
  await expect(page.getByTestId("completion-guide")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hide input guide" }),
  ).toHaveAttribute("aria-expanded", "true");
  return calls;
};

const setupValue = (page: Page, name: string, option: 0 | 1) =>
  page.getByLabel(
    `Setup ${name} — ${option === 0 ? "On-campus Housing" : "Off-campus Housing"}`,
    { exact: true },
  );
const total = (page: Page, option: number) =>
  page.getByTestId(`option-${option}`).getByTestId("total");
const stored = (page: Page): Promise<ChoiceDecision> =>
  page.evaluate(() => JSON.parse(localStorage.getItem("clear-choice-v2")!));

test("Unknown housing inputs guide direct entry and calculate without extra model calls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const calls = await generate(page, housing());
  const guide = page.getByTestId("completion-guide");
  await expect(total(page, 0)).toHaveText("Unknown");
  await expect(total(page, 1)).toHaveText("Unknown");
  await expect(
    guide.getByText("1 reference-only factor can stay unknown.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    guide.getByRole("heading", { name: "Social opportunities" }),
  ).toHaveCount(0);

  await page.getByLabel("Setup comparison months").fill("9");
  await page.getByLabel("Setup uses per week").fill("10");
  await setupValue(page, "Monthly Rent", 0).fill("1500");
  await setupValue(page, "Monthly Rent", 1).fill("1100");
  await expect(total(page, 0)).toHaveText("Unknown");
  await guide
    .getByRole("button", { name: "Confirm Monthly Rent", exact: true })
    .click();
  await guide
    .getByRole("button", { name: "Add billing interval", exact: true })
    .click();
  await setupValue(page, "Billing interval", 0).fill("1");
  await setupValue(page, "Billing interval", 1).fill("1");
  await guide
    .getByRole("button", { name: "Confirm Billing interval", exact: true })
    .click();
  await expect(total(page, 0)).toHaveText("$13,500.00");
  await expect(total(page, 1)).toHaveText("$9,900.00");
  await setupValue(page, "One-way commute", 0).fill("10");
  await setupValue(page, "One-way commute", 1).fill("40");
  await guide
    .getByRole("button", { name: "Confirm One-way commute", exact: true })
    .click();
  await expect(
    page.getByTestId("option-0").getByText("433 min", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("option-1").getByText("1733 min", { exact: true }),
  ).toBeVisible();
  await expect(
    guide.getByRole("heading", { name: "Your key inputs are ready" }),
  ).toBeVisible();

  await page.screenshot({
    path: "/tmp/yang-completion-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/yang-completion-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

  const rent = setupValue(page, "Monthly Rent", 0);
  await rent.fill("");
  for (const digit of "1250") {
    await rent.pressSequentially(digit);
    await expect(rent).toBeFocused();
  }
  await expect(rent).toHaveValue("1250");
  await expect(total(page, 0)).toHaveText("$11,250.00");
  await rent.fill("0");
  await expect(rent).toHaveValue("0");
  await expect(total(page, 0)).toHaveText("$0.00");
  await expect(total(page, 1)).toHaveText("$9,900.00");
  const d = await stored(page);
  expect(
    d.factors.find((f) => f.name === "Monthly Rent")?.values[d.options[0].id]
      .value,
  ).toBe(0);
  const social = d.factors.find((f) => f.name === "Social opportunities")!;
  expect(social.confirmed).toBe(false);
  expect(
    Object.values(social.values).every((field) => field.value === null),
  ).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    guide.getByRole("heading", { name: "Your key inputs are ready" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(calls).toEqual(["/api/choices/understand"]);
  expect(errors).toEqual([]);
});

test("Supplied values remain unconfirmed until review, including valid zero values", async ({
  page,
}) => {
  const calls = await generate(page, housing(true));
  const guide = page.getByTestId("completion-guide");
  await expect(
    guide.getByText("Review supplied values", { exact: true }),
  ).toHaveCount(3);
  await expect(setupValue(page, "Monthly Rent", 0)).toHaveValue("0");
  await expect(setupValue(page, "One-way commute", 0)).toHaveValue("0");
  await expect(total(page, 0)).toHaveText("Unknown");
  await expect(total(page, 1)).toHaveText("Unknown");
  await guide
    .getByRole("button", { name: "Confirm Monthly Rent", exact: true })
    .click();
  await expect(total(page, 0)).toHaveText("Unknown");
  await guide
    .getByRole("button", { name: "Confirm Billing interval", exact: true })
    .click();
  await expect(total(page, 0)).toHaveText("$0.00");
  await expect(total(page, 1)).toHaveText("$9,900.00");
  await expect(
    page.getByTestId("option-1").getByText("1733 min", { exact: true }),
  ).toHaveCount(0);
  await guide
    .getByRole("button", { name: "Confirm One-way commute", exact: true })
    .click();
  await expect(
    page.getByTestId("option-0").getByText("0 min", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("option-1").getByText("1733 min", { exact: true }),
  ).toBeVisible();
  await expect(
    guide.getByRole("heading", { name: "Your key inputs are ready" }),
  ).toBeVisible();
  expect(calls).toEqual(["/api/choices/understand"]);
});
