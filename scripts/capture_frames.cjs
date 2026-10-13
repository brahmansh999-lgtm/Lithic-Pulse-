const { chromium } = require('playwright');
const path = require('path');

const OUT = path.join(__dirname, 'out', 'frames');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // 1. Landing hero
  await page.goto('http://localhost:5201/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/01_landing.png` });

  // 2. Role selection modal
  await page.click('text=OPEN MASTERPLANNER →');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/02_roles.png` });

  // 3. Site map — all sites
  await page.click('text=ARCHITECT');
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/03_sitemap_all.png` });

  // 4. Permissioned (green) sites filter
  await page.click('text=PERMISSIONED');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/04_sitemap_green.png` });

  // 5. Selected green site — analysis panel
  const markers = await page.$$('.leaflet-marker-icon');
  await markers[0].click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/05_site_analysis.png` });

  // 6. Site stage (generated masterplan, before massing)
  await page.click('text=GENERATE MASTERPLAN →');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/06_site_stage.png` });

  // 7-10. Massing stage, cycling through styles
  await page.click('text=MASSING →');
  await page.waitForTimeout(3200);
  await page.screenshot({ path: `${OUT}/07_massing_organic.png` });

  await page.selectOption('select', { label: 'Slab block' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/08_massing_slab.png` });

  await page.selectOption('select', { label: 'Point towers' });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/09_massing_towers.png` });

  await page.selectOption('select', { label: 'Perimeter block' });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/10_massing_perimeter.png` });

  await browser.close();
  console.log('done');
})();
