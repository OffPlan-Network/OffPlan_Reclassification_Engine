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
  // On the API backend it's fetched async; on the localStorage backend it
  // computes synchronously in the hook. Either way, wait for the
  // "computing…" placeholder to clear before reading the value.
  const mrlCard = page.getByTestId('mrl-card');
  await expect(mrlCard).toBeVisible();
  await expect(mrlCard).not.toContainText('computing', { timeout: 15_000 });

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

test('6. /api/liquidity/simulate computes MRL server-side and caches by hash', async ({ request }) => {
  // Seed an employer + claims directly into Postgres so the API has data
  // to operate on. Reuses ABC's classifier output shape.
  const employer = { id: 'TEST_LIQ_API', name: 'Liquidity API Test', covered_lives: 100, current_total_healthcare_spend: 1000000 };
  const scenario = { name: 'Expected', dpc_elimination_pct: 0.85, urgent_care_reduction_pct: 0.65, er_reduction_pct: 0.25, cashpay_discount_factor: 0.5, indemnity_enabled: true, attachment_point: 50000, stop_loss_pepm: 100, risk_margin: 1.25 };
  const claims = Array.from({ length: 200 }, (_, i) => ({
    claim_id: `T${i}`,
    member_id: `M${(i % 50)}`,
    cpt_code: '99213',
    place_of_service: 'Office',
    allowed_amount: 200 + (i % 10) * 50,
    bucket: i % 5 === 0 ? 'B' : 'A',
    normalized_category: i % 5 === 0 ? 'Specialist Consult' : 'Primary Care',
  }));
  await request.put('/api/storage/' + encodeURIComponent('employer:TEST_LIQ_API'), { data: { value: employer } });
  await request.put('/api/storage/' + encodeURIComponent('claims:TEST_LIQ_API'), { data: { value: claims } });

  // Cold call — should compute, return cached:false.
  const t0 = Date.now();
  const res1 = await request.post('/api/liquidity/simulate', {
    data: { employerId: 'TEST_LIQ_API', scenario, runs: 2000 },
  });
  const elapsed1 = Date.now() - t0;
  expect(res1.ok()).toBeTruthy();
  const r1 = await res1.json();
  expect(r1.cached).toBe(false);
  expect(r1.mrl, `MRL "${r1.mrl}" should be a positive number`).toBeGreaterThan(0);
  expect(r1.percentiles).toMatchObject({ p50: expect.any(Number), p95: expect.any(Number) });
  expect(r1.timings_ms).toMatchObject({ cascade: expect.any(Number), simulation: expect.any(Number) });
  expect(r1.meta.method).toMatch(/timing-resample/);

  // Warm call with identical inputs — must come back cached.
  const res2 = await request.post('/api/liquidity/simulate', {
    data: { employerId: 'TEST_LIQ_API', scenario, runs: 2000 },
  });
  const r2 = await res2.json();
  expect(r2.cached).toBe(true);
  expect(r2.mrl).toBe(r1.mrl); // determinism — same seed produces same MRL

  // Different scenario → different cache key → fresh compute.
  const res3 = await request.post('/api/liquidity/simulate', {
    data: { employerId: 'TEST_LIQ_API', scenario: { ...scenario, stop_loss_pepm: 130 }, runs: 2000 },
  });
  const r3 = await res3.json();
  expect(r3.cached).toBe(false);
  expect(r3.cache_key).not.toBe(r1.cache_key);

  // Cleanup
  await request.delete('/api/storage/' + encodeURIComponent('employer:TEST_LIQ_API'));
  await request.delete('/api/storage/' + encodeURIComponent('claims:TEST_LIQ_API'));
});

test('7. Liquidity mode toggle switches between resample and tier-generated', async ({ page }) => {
  await loadAbcDemo(page);
  const mrlCard = page.getByTestId('mrl-card');
  await expect(mrlCard).not.toContainText('computing', { timeout: 15_000 });
  const resampleMrl = (await mrlCard.locator('.num').first().innerText()).trim();
  expect(resampleMrl).toMatch(USD_RE);

  // Method label should reflect timing-resample default.
  const profile = page.getByTestId('liquidity-profile');
  await expect(profile).toContainText(/timing-resample/);

  // Switch to tier-generated.
  await page.getByTestId('mode-toggle-tier').click();
  await expect(mrlCard).not.toContainText('computing', { timeout: 15_000 });
  await expect(profile).toContainText(/tier-generated/);

  // Tier-generated MRL is a different number; assert it's still a USD value.
  const tierMrl = (await mrlCard.locator('.num').first().innerText()).trim();
  expect(tierMrl).toMatch(USD_RE);

  // Calibration drift block must render in tier mode (banner fires when drift exceeds 10%).
  await expect(profile).toContainText(/Calibration drift/);

  // Switch back; verify the resample MRL returns. Numbers are deterministic
  // for fixed inputs so we should get the same value as before.
  await page.getByTestId('mode-toggle-resample').click();
  await expect(mrlCard).not.toContainText('computing', { timeout: 15_000 });
  const resampleMrl2 = (await mrlCard.locator('.num').first().innerText()).trim();
  expect(resampleMrl2).toBe(resampleMrl);
});

test('5. /migrate.html migrates localStorage data into Postgres', async ({ page, request }) => {
  // Seed three keys into the page's localStorage as if a previous session
  // had been running with VITE_STORAGE_BACKEND=localStorage. We do this by
  // navigating to a same-origin page first (so localStorage is unlocked),
  // then evaluating the seed in page context.
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('offplan_engine:employer:DEMO_LOCAL', JSON.stringify({ id: 'DEMO_LOCAL', name: 'Local Storage Co.', covered_lives: 99 }));
    localStorage.setItem('offplan_engine:scenario:DEMO_LOCAL', JSON.stringify({ name: 'Expected', stop_loss_pepm: 100 }));
    localStorage.setItem('offplan_engine:claims:DEMO_LOCAL', JSON.stringify([{ claim_id: 'L1', allowed_amount: 250 }]));
  });

  // Open the migrate page, uncheck dry-run, run the migration.
  await page.goto('/migrate.html');
  await expect(page.getByRole('heading', { name: /localStorage.*Postgres/i })).toBeVisible();
  // The inventory should list our three keys.
  const inv = page.locator('#inventory');
  await expect(inv).toContainText('employer:DEMO_LOCAL');
  await expect(inv).toContainText('scenario:DEMO_LOCAL');
  await expect(inv).toContainText('claims:DEMO_LOCAL');

  await page.locator('#dry-run').uncheck();
  await page.locator('#migrate').click();

  // Wait for the summary to land. The success path text begins with
  // "Migration complete:" and ends with the post-migrate instructions.
  const summary = page.locator('#summary');
  await expect(summary).toContainText('Migration complete', { timeout: 10_000 });
  await expect(summary).toContainText('0 failed');

  // Verify Postgres actually has the data.
  for (const k of ['employer:DEMO_LOCAL', 'scenario:DEMO_LOCAL', 'claims:DEMO_LOCAL']) {
    const r = await request.get('/api/storage/' + encodeURIComponent(k));
    expect(r.ok()).toBeTruthy();
    const { value } = await r.json();
    expect(value, `${k} should round-trip to Postgres`).toBeTruthy();
  }

  const empRes = await request.get('/api/storage/' + encodeURIComponent('employer:DEMO_LOCAL'));
  const { value: emp } = await empRes.json();
  expect(emp).toMatchObject({ id: 'DEMO_LOCAL', name: 'Local Storage Co.', covered_lives: 99 });
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
