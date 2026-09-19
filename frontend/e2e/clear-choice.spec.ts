import { test, expect, type Page, type Route } from '@playwright/test';
import { makeDemo } from '../src/choice/fixtures';
import type { ChoiceDecision, Factor, MaterialAnalysis } from '../src/choice/types';

const card = (page: Page, index: number) => page.getByTestId(`option-${index}`);
async function demo(page: Page, kind = 'gym') {
  await page.goto('/');
  await page.getByTestId(`demo-${kind}`).click();
}
async function materialEditor(page: Page, index: number) {
  const panel = card(page, index).locator('details.cc-materials');
  if (await panel.getAttribute('open') === null) await panel.locator('summary').click();
  return panel;
}
function analysisFor(body: { decision: ChoiceDecision; optionId: string }, extraction = false): MaterialAnalysis {
  const { decision, optionId } = body;
  const option = decision.options.find(o => o.id === optionId)!;
  const materials = option.materials;
  const conflict = materials.length > 1;
  return {
    decisionId: decision.id, decisionVersion: decision.version, optionId,
    status: conflict ? 'inconsistent' : 'needs_verification',
    findings: [{ id: 'finding', optionId, materialIds: materials.map(m => m.id), quotes: materials.map(m => ({ materialId: m.id, quote: m.text })), labels: conflict ? ['conflict', 'unclear_terms'] : ['urgency', 'disclosed'], explanation: conflict ? 'The cancellation claims differ. Verify which terms apply.' : 'The deadline needs verification; the listed price is explicitly disclosed.', needsVerification: true }],
    extractions: extraction ? [{ id: 'price', optionId, materialId: materials[0].id, quote: materials[0].text, label: 'Annual offer price', value: 100000, unit: decision.currency, costId: option.costs[0].id, factorId: null }] : [],
    limitations: ['Automated test response; no external factual verification.'],
  };
}
async function fillMaterial(page: Page, index: number, text: string) {
  const panel = await materialEditor(page, index);
  await panel.getByRole('button', { name: 'Add text material' }).click();
  // Native details must remain usable after an edit rerenders the card.
  if (!await panel.getByRole('textbox').first().isVisible()) await panel.locator('summary').click();
  await panel.getByRole('textbox', { name: /material 1 text/ }).fill(text);
  return panel;
}

test.beforeEach(async ({ page }) => {
  // No offline browser test may accidentally spend a live model request.
  await page.route('**/api/choices/**', route => route.fulfill({ status: 503, json: { code: 'MODEL_NOT_CONFIGURED', message: 'Model access is not configured for this offline test.' } }));
});

test('no-ad decision: 4/8/9 months, frequency invariant, chart and story agree', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/choices/')) requests.push(r.url()); });
  await demo(page);
  await expect(page.getByTestId('total-0')).toContainText('1,200.00');
  await expect(page.getByTestId('total-1')).toContainText('600.00');
  await expect(card(page, 1)).toContainText('Over 4 months, total cost is');
  await page.getByText('Exact chart values', { exact: true }).click();
  await expect(page.locator('table tbody tr').last()).toContainText('600.00');
  await page.getByLabel('Planning horizon', { exact: true }).fill('8');
  await expect(page.getByRole('heading', { name: 'A tie on what matters most' })).toBeVisible();
  await page.getByLabel('Planning horizon', { exact: true }).fill('9');
  await expect(page.getByTestId('total-1')).toContainText('1,350.00');
  await expect(card(page, 0)).toContainText('Current fit');
  await page.getByLabel('Uses per month', { exact: true }).fill('24');
  await expect(page.getByTestId('total-0')).toContainText('1,200.00');
  await expect(page.getByTestId('total-1')).toContainText('1,350.00');
  await expect(card(page, 0)).toContainText('The overall comparison stays the same.');
  await expect(card(page, 0)).toContainText('Cost per use:');
  await expect(page.getByText('0 supplied · No materials provided')).toHaveCount(2);
  expect(requests).toEqual([]);
});

test('budget no-solution and missing horizon replace current results without stale totals', async ({ page }) => {
  await demo(page);
  await page.getByLabel('Total budget (optional)', { exact: true }).fill('500');
  await expect(page.getByRole('heading', { name: 'None meet your current requirements' })).toBeVisible();
  await page.getByLabel('Total budget (optional)', { exact: true }).fill('');
  await page.getByLabel('Planning horizon', { exact: true }).fill('');
  await expect(page.getByTestId('total-0')).toHaveText('Unknown');
  await expect(page.getByTestId('total-1')).toHaveText('Unknown');
  await expect(card(page, 1)).toContainText('Set a planning horizon');
});

test('custom required boolean participates and is preserved across unrelated edits', async ({ page }) => {
  await demo(page);
  await page.getByRole('button', { name: 'Add factor', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Factor name', { exact: true }).fill('Allows my cat');
  await dialog.getByLabel('Why this factor matters').fill('I need my cat to be allowed.');
  await dialog.getByLabel('Factor data type').selectOption('boolean');
  await dialog.getByLabel('Factor purpose').selectOption('hard');
  await dialog.getByLabel('Desired value (optional for a range)').selectOption('true');
  await dialog.getByLabel('Annual membership value', { exact: true }).selectOption('true');
  await dialog.getByLabel('Monthly membership value', { exact: true }).selectOption('false');
  await dialog.getByRole('button', { name: 'Save factor' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card(page, 0)).toContainText('Current fit');
  await expect(card(page, 1)).toContainText('Allows my cat: the confirmed target is not met.');
  await page.getByLabel('Uses per month', { exact: true }).fill('16');
  const more = page.getByRole('button', { name: /Show .* more factors/ });
  if (await more.isVisible()) await more.click();
  await expect(page.getByRole('heading', { name: 'Allows my cat', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove factor Allows my cat' }).click();
  await expect(card(page, 1)).toContainText('Current fit');
});

test('factor applicability can exclude one option and save', async ({ page }) => {
  await demo(page);
  await page.getByRole('button', { name: 'Edit Can stop after a month', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: 'Annual membership', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Save factor' }).click();
  await expect(dialog).not.toBeVisible();
  const factor = page.locator('.cc-factor').filter({ has: page.getByRole('heading', { name: 'Can stop after a month', exact: true }) });
  await expect(factor).toContainText('Not applicable');
});

test('generic course demo keeps unknowns and a manual decision works without ads', async ({ page }) => {
  await demo(page, 'course');
  await expect(page.getByText('Open comparison', { exact: true })).toBeVisible();
  await expect(page.getByTestId('total-0')).toHaveText('Unknown');
  await page.getByRole('button', { name: 'Clear Choice home' }).click();
  await page.getByRole('button', { name: 'Build a manual comparison' }).click();
  await page.getByLabel('Planning horizon', { exact: true }).fill('4');
  await page.getByLabel('Uses per month', { exact: true }).fill('8');
  const options = page.locator('.cc-review-card');
  for (const [i, amount] of ['100', '150'].entries()) {
    const option = options.nth(i);
    await option.getByRole('button', { name: 'Add charge', exact: true }).click();
    await option.getByLabel(`Option ${i ? 'B' : 'A'}: New charge`, { exact: true }).fill(amount);
    await option.getByRole('checkbox', { name: 'I have included all relevant charges' }).check();
  }
  const factor = page.locator('.cc-factor').filter({ has: page.getByRole('heading', { name: 'Total cost', exact: true }) });
  await factor.getByRole('button', { name: 'Make primary' }).click();
  await page.getByRole('button', { name: 'Compare my options' }).first().click();
  await expect(page.getByTestId('total-0')).toContainText('400.00');
  await expect(page.getByTestId('total-1')).toContainText('600.00');
  await expect(card(page, 0)).toContainText('Current fit');
});

test('per-option materials 0/1/many, conflict and explicit extraction replacement', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/choices/materials', async route => {
    calls++;
    await route.fulfill({ json: analysisFor(route.request().postDataJSON(), true) });
  });
  await demo(page);
  const first = await fillMaterial(page, 0, 'Last day! Annual offer CNY 1000. Cancel any time.');
  await expect(page.getByTestId('total-0')).toContainText('1,200.00');
  await first.getByRole('button', { name: 'Analyze this option' }).click();
  await expect(first.getByText('Information to verify', { exact: true })).toBeVisible();
  await expect(first.getByText('Urgency', { exact: true })).toBeVisible();
  await expect(first.getByText('Clearly disclosed', { exact: true })).toBeVisible();
  await expect(page.getByTestId('total-0')).toContainText('1,200.00');
  await first.getByRole('button', { name: 'Review value' }).click();
  await expect(first).toContainText('Conflicting value');
  await first.getByRole('button', { name: 'Confirm replacement' }).click();
  await expect(page.getByTestId('total-0')).toContainText('1,000.00');
  await expect(page.getByTestId('total-1')).toContainText('600.00');
  await first.getByRole('button', { name: 'Add text material' }).click();
  await first.getByRole('textbox', { name: /material 2 text/ }).fill('No refunds or cancellation for twelve months.');
  await first.getByRole('button', { name: 'Analyze this option' }).click();
  await expect(first.getByText('Materials are inconsistent', { exact: true })).toBeVisible();
  await expect(card(page, 1)).toContainText('0 supplied · No materials provided');
  const second = await fillMaterial(page, 1, 'Monthly price CNY 150.');
  await second.getByRole('button', { name: 'Analyze this option' }).click();
  await expect(second.getByText('Information to verify', { exact: true })).toBeVisible();
  expect(calls).toBe(3);
  // Altering supporting evidence invalidates an accepted sourced value.
  await first.getByRole('textbox', { name: /material 1 text/ }).fill('The old offer has been withdrawn.');
  await expect(page.getByTestId('total-0')).toHaveText('Unknown');
});

test('late material response cannot overwrite a newer decision version', async ({ page }) => {
  let pending: Route | undefined;
  await page.route('**/api/choices/materials', route => { pending = route; });
  await demo(page);
  const panel = await fillMaterial(page, 0, 'Last day! Annual offer CNY 1000.');
  await panel.getByRole('button', { name: 'Analyze this option' }).click();
  await expect.poll(() => !!pending).toBe(true);
  const old = analysisFor(pending!.request().postDataJSON(), true);
  await page.getByLabel('Planning horizon', { exact: true }).fill('9');
  await pending!.fulfill({ json: old });
  await expect(panel.getByRole('alert')).toContainText('response was not applied');
  await expect(panel.getByRole('button', { name: 'Review value' })).toHaveCount(0);
  await expect(page.getByTestId('total-1')).toContainText('1,350.00');
});

test('natural-language additions require review, preserve existing factors and enforce accepted hard target', async ({ page }) => {
  await page.route('**/api/choices/factors', async route => {
    const { decision } = route.request().postDataJSON() as { decision: ChoiceDecision };
    const factor: Factor = { id: 'new-exit', name: 'Can leave next month', reason: 'You may leave the city.', optionIds: decision.options.map(o => o.id), dataType: 'boolean', unit: '', allowedValues: [], direction: 'target', purpose: 'hard', importance: 5, target: { min: null, max: null, desired: true }, values: Object.fromEntries(decision.options.map((o, i) => [o.id, { value: !!i, source: 'user_input', note: 'Test supplied fact' }])), origin: 'user', confirmed: true, userQuote: 'I must be able to leave next month.' };
    await route.fulfill({ json: { decisionId: decision.id, decisionVersion: decision.version, factors: [factor], questions: [] } });
  });
  await demo(page);
  await page.getByText('Add a factor in your own words', { exact: false }).click();
  await page.getByLabel('Additional factor request').fill('I must be able to leave next month.');
  await page.getByRole('button', { name: 'Suggest factors', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review new suggestions' })).toBeVisible();
  await expect(card(page, 0)).not.toContainText('Can leave next month: the confirmed target is not met.');
  await page.getByRole('button', { name: 'Confirm & add selected' }).click();
  await expect(card(page, 0)).toContainText('Can leave next month: the confirmed target is not met.');
  await expect(page.getByRole('heading', { name: 'Total cost', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Can leave next month', exact: true })).toBeVisible();
});

test('model failure preserves description and manual alternative remains available', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('#choice-description');
  await input.fill('Should I accept a weekend shift or keep the weekend free?');
  await page.getByRole('button', { name: 'Explore my options' }).click();
  await expect(page.getByRole('alert')).toContainText('Model access is not configured');
  await expect(input).toHaveValue('Should I accept a weekend shift or keep the weekend free?');
  await page.getByRole('button', { name: 'Build a manual comparison' }).click();
  await expect(page.getByText('Your manual comparison', { exact: true })).toBeVisible();
});

test('validated model generation reaches review with unknowns and no guessed values', async ({ page }) => {
  await page.route('**/api/choices/generate', async route => {
    const fixture = makeDemo('course');
    fixture.mode = 'live';
    fixture.factors.forEach(f => { f.origin = 'model'; f.confirmed = false; });
    fixture.primaryFactorId = null;
    fixture.originalInput = route.request().postDataJSON().description;
    await route.fulfill({ json: fixture });
  });
  await page.goto('/');
  await page.locator('#choice-description').fill('Compare two classes; their prices are unknown.');
  await page.getByRole('button', { name: 'Explore my options' }).click();
  await expect(page.getByText('Live AI interpretation', { exact: true })).toBeVisible();
  await expect(page.getByText('Open comparison', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Compare my options' }).first().click();
  await expect(page.getByTestId('total-0')).toHaveText('Unknown');
});

test('auxiliary material entry preserves text and can join comparison', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Check this information' }).click();
  await page.locator('#material-entry').fill('Offer: 150 per month, cancel before the next renewal.');
  await page.getByRole('button', { name: 'Start material review' }).click();
  await expect(page.getByRole('heading', { name: 'Understand this offer' })).toBeVisible();
  await page.getByRole('button', { name: 'Compare my options' }).first().click();
  const panel = await materialEditor(page, 0);
  await expect(panel.getByRole('textbox', { name: /material 1 text/ })).toHaveValue('Offer: 150 per month, cancel before the next renewal.');
  await expect(card(page, 1)).toContainText('0 supplied · No materials provided');
});

test('desktop and narrow layouts render without browser errors or horizontal overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.screenshot({ path: '/tmp/clear-choice-desktop-entry.png', fullPage: true });
  await page.getByTestId('demo-gym').click();
  await page.screenshot({ path: '/tmp/clear-choice-desktop-comparison.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('total-0')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/clear-choice-mobile-comparison.png', fullPage: true });
  expect(errors).toEqual([]);
});


test('currency reset is explicit and reversible; qualitative assumptions do not alter arithmetic', async ({ page }) => {
  await demo(page);
  await page.getByRole('button', { name: 'Review your inputs' }).click();
  await page.getByText('Decision title, currency & original input', { exact: true }).click();
  await page.getByLabel('Decision currency').selectOption('USD');
  await expect(page.getByRole('status').filter({ hasText: 'Currency changed from' })).toBeVisible();
  await page.getByRole('button', { name: 'Compare my options' }).first().click();
  await expect(page.getByTestId('total-0')).toHaveText('Unknown');
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect(page.getByTestId('total-0')).toContainText('1,200.00');
  await expect(page.getByRole('status').filter({ hasText: 'Currency changed from' })).toHaveCount(0);
  await page.getByText('Your goals & qualitative assumptions', { exact: false }).click();
  await page.getByRole('button', { name: 'Edit assumption 1', exact: true }).click();
  await page.getByLabel('Edit assumption 1 text', { exact: true }).fill('I may visit less after moving; this is only a possibility.');
  await page.getByRole('button', { name: 'Save assumption', exact: true }).click();
  await expect(page.getByTestId('total-1')).toContainText('600.00');
  await expect(page.getByText('I may visit less after moving; this is only a possibility.', { exact: true })).toBeVisible();
});
