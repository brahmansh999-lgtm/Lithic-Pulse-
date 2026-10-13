import { chromium } from 'playwright';

const base = 'http://localhost:5212';
const shotDir = 'C:/Users/prana/AppData/Local/Temp/claude/e--PLANNER---Copy/e9caf3cc-2daa-4688-bd59-b1494fddcc0e/scratchpad';
const shot = (n) => `${shotDir}/${n}.png`;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];

async function runSite(page, siteText, tag) {
  page.on('pageerror', err => errors.push(`${tag}: ${err.message}`));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`${tag} console: ${msg.text()}`); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4800);
  await page.getByText('Open Architect View in Planner', { exact: false }).click();
  await page.waitForTimeout(1000);
  await page.locator('.sp-role-tab', { hasText: 'Permissioned' }).click();
  await page.waitForTimeout(500);
  const listScroll = page.locator('.sp-list-scroll');
  for (let i = 0; i < 40; i++) {
    if (await page.getByText(siteText, { exact: false }).count() > 0) break;
    await listScroll.evaluate(el => el.scrollBy(0, 400));
    await page.waitForTimeout(50);
  }
  await page.getByText(siteText, { exact: false }).first().click();
  await page.waitForTimeout(800);
  await page.getByText('GENERATE MASTERPLAN', { exact: false }).click();
  await page.waitForTimeout(1000);
  await page.locator('button', { hasText: 'ZONING' }).click();
  await page.waitForTimeout(1200);
  await page.locator('button', { hasText: 'MASSING' }).click();
  await page.waitForTimeout(1500);
  await page.locator('button', { hasText: 'Columns →' }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot(`final-${tag}-columns`) });
}

for (const [term, tag] of [
  ['Kensington High Street', 'medium'],
  ['Dover Court', 'large'],
  ['Padcroft', 'xl'],
  ['Torrington Park', 'small'],
  ['Tottenham Lane', 'small2'],
]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  try {
    await runSite(page, term, tag);
    console.log(tag, 'OK');
  } catch (e) {
    console.log(tag, 'FAILED:', e.message);
  }
  await page.close();
}

console.log('errors:', JSON.stringify(errors));
await browser.close();
