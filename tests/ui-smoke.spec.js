import { test, expect } from '@playwright/test';

// Each test starts from a clean app_data table so demo loads write fresh
// rows we can assert on. The /api/storage DELETE endpoint requires
// confirm=yes so we don't accidentally wipe the live DB from a curl typo.
test.beforeEach(async ({ request }) => {
  const res = await request.delete('/api/storage?confirm=yes');
  expect(res.ok(), 'app_data wipe must succeed before each test').toBeTruthy();
});

// USD-shaped value: matches "$1,234.56", "−$108K", "$1.2M", etc. We're
// asserting the cell rendered *something dollar-like*, not a specific
// number — exact figures move whenever constants or distributions change.
const USD_RE = /[−-]?\$[\d,.]+[KM]?/;

async function loadAbcDemo(page) {
  await page.goto('/');
  // CasesScreen tags each demo card's button with `load-demo-<id>`.
  await page.getByTestId('load-demo-DEMO_ABC').click();
  // Demo destination is dashboard. Wait for the Scenario Comparison table —
  // it's unique to the dashboard and only renders after `runCalculation`
  // finishes for all three presets.
  await expect(
    page.getByRole('heading', { name: 'Scenario Comparison', level: 3 }),
  ).toBeVisible({ timeout: 20_000 });
}

test('1. ABC demo loads and the deterministic cascade renders the dashboard', async ({ page }) => {
  await loadAbcDemo(page);

  // Scenario Comparison table renders three rows (Conservative / Expected /
  // Aggressive) only after `runCalculation` has been invoked on each preset.
  // Asserting at least three USD-shaped cells in the table proves the
  // cascade ran end-to-end and the storage layer round-tripped the claims.
  const compareRows = page.locator('table').filter({
    has: page.getByRole('columnheader', { name: 'Total OffPlan PEPM' }),
  }).locator('tbody tr');
  await expect(compareRows).toHaveCount(3);

  const usdCells = page.locator('table').filter({
    has: page.getByRole('columnheader', { name: 'Total OffPlan PEPM' }),
  }).locator('td.font-mono');
  const cellTexts = await usdCells.allInnerTexts();
  const moneyCells = cellTexts.filter((t) => USD_RE.test(t));
  expect(
    moneyCells.length,
    `Scenario Comparison table should contain USD-shaped values; got: ${JSON.stringify(cellTexts)}`,
  ).toBeGreaterThanOrEqual(3);
});

test('2. Demo load persists employer + claims + scenario rows in Postgres', async ({ page, request }) => {
  await loadAbcDemo(page);

  const listRes = await request.get('/api/storage?prefix=');
  expect(listRes.ok()).toBeTruthy();
  const { keys } = await listRes.json();

  // Required keys after an ABC demo load.
  const expected = [
    'employer:DEMO_ABC',
    'claims:DEMO_ABC',
    'scenario:DEMO_ABC',
    'input_mode:DEMO_ABC',
  ];
  for (const k of expected) {
    expect(keys, `app_data should contain ${k} after demo load`).toContain(k);
  }

  // Spot-check the employer row's payload.
  const empRes = await request.get('/api/storage/' + encodeURIComponent('employer:DEMO_ABC'));
  expect(empRes.ok()).toBeTruthy();
  const { value: emp } = await empRes.json();
  expect(emp).toMatchObject({ id: 'DEMO_ABC', name: 'ABC Manufacturing' });
  expect(Number(emp.covered_lives)).toBe(162);

  // And confirm classified claims came along — the frozen JSON has 1758 lines.
  const claimsRes = await request.get('/api/storage/' + encodeURIComponent('claims:DEMO_ABC'));
  expect(claimsRes.ok()).toBeTruthy();
  const { value: claims } = await claimsRes.json();
  expect(Array.isArray(claims)).toBeTruthy();
  expect(claims.length).toBeGreaterThan(1000);
});

test('4. Stochastic MRL renders on dashboard with positive USD value and CER', async ({ page }) => {
  await loadAbcDemo(page);

  // The MRL card is in the dark hero and tagged with data-testid="mrl-card".
  // The simulation runs synchronously in useMemo, so the value should be
  // present on first render of the dashboard.
  const mrlCard = page.getByTestId('mrl-card');
  await expect(mrlCard).toBeVisible();

  // Read the headline MRL value (the only .num element directly inside the card).
  const mrlText = (await mrlCard.locator('.num').first().innerText()).trim();
  expect(mrlText, `MRL "${mrlText}" should be a USD figure`).toMatch(USD_RE);
  expect(mrlText, 'MRL should not be the placeholder dash').not.toBe('—');

  // CER should appear in the subtitle as something like "20.2× capital efficiency vs ELF".
  const subText = await mrlCard.locator('div').last().innerText();
  expect(subText, `CER subtitle "${subText}" should reference capital efficiency`).toMatch(/capital efficiency/i);
  expect(subText).toMatch(/\d+\.\d+×/);

  // Liquidity Profile section should render with the P95 percentile card
  // labeled "MRL". Targeting the specific percentile card heading avoids
  // the prose-paragraph and footer-caveat matches for "P95".
  const profile = page.getByTestId('liquidity-profile');
  await expect(profile).toBeVisible();
  await expect(profile.getByText('P95 · MRL', { exact: false })).toBeVisible();
  await expect(profile.getByText(/^P50\b/)).toBeVisible();
});

test('3. Editing a scenario knob persists to Postgres on change', async ({ page, request }) => {
  await loadAbcDemo(page);

  // Navigate from Dashboard to Scenario via the header nav.
  await page.getByRole('button', { name: /^Scenario$/ }).click();
  await expect(page.getByRole('heading', { name: 'Scenario Controls' })).toBeVisible();

  // Change the Stop-Loss PEPM input to a sentinel value (142) and blur to commit.
  const slInput = page.getByTestId('scenario-stop-loss-pepm');
  await slInput.fill('142');
  await slInput.blur();

  // The onChange wiring writes to Postgres synchronously via the API
  // backend; give it a beat for the round-trip then verify.
  await page.waitForTimeout(500);

  const scnRes = await request.get('/api/storage/' + encodeURIComponent('scenario:DEMO_ABC'));
  expect(scnRes.ok()).toBeTruthy();
  const { value: scn } = await scnRes.json();
  expect(scn.stop_loss_pepm).toBe(142);
});
