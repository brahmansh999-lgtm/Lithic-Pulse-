const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', msg => { if (msg.text().includes('DEBUG')) logs.push(msg.text()); });
  await page.goto('http://localhost:5203/', { waitUntil: 'networkidle' });
  await page.locator('button:has-text("Launch")').first().click();
  await page.waitForTimeout(1000);
  const item = page.locator('button.sp-list-item', { hasText: 'Woodberry Down' }).first();
  await item.click();
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Generate Masterplan")').first().click();
  await page.waitForTimeout(1500);
  console.log(logs.join('\n'));
  await browser.close();
})();
