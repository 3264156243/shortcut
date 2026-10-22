const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.SC_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SC_SITE_BASE || 'http://127.0.0.1:8877';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/sync/feedback.php', route => route.fulfill({ json: { ok: true, items: [] } }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const lang of ['', 'en/']) {
      await page.goto(base + '/' + lang, { waitUntil: 'networkidle' });
      await page.locator('.to-top').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.to-top').evaluate(n => getComputedStyle(n).opacity), '1');
      await page.evaluate(() => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2));
      await page.waitForTimeout(500);
      assert.ok(Math.abs(Number(await page.locator('.reading-progress').getAttribute('aria-valuenow')) - 50) <= 1);
      await page.locator('.to-top').click();
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => scrollY), 0);
      await page.goto(base + '/' + lang + 'feedback.html');
      assert.equal(await page.locator('.custom-select').count(), 4);
      for (const mode of ['light', 'dark']) {
        await page.evaluate(mode => document.documentElement.dataset.mode = mode, mode);
        const trigger = page.locator('#fbStatusFilter-trigger');
        await trigger.click();
        const options = page.locator('#fbStatusFilter-options');
        assert.equal(await options.isVisible(), true);
        const colors = await options.locator('button').first().evaluate(n => ({ color: getComputedStyle(n).color, background: getComputedStyle(n).backgroundColor }));
        assert.notEqual(colors.color, colors.background);
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        assert.equal(await options.isVisible(), false);
        assert.equal(await page.locator('#fbStatusFilter').inputValue(), await page.locator('#fbStatusFilter option').last().getAttribute('value'));
        await trigger.click();
        await page.keyboard.press('Escape');
        assert.equal(await trigger.evaluate(n => n === document.activeElement), true);
        await page.locator('#fbArea-trigger').click();
        await page.screenshot({ path: path.join(require('node:os').tmpdir(), `sc-controls-${lang ? 'en' : 'zh'}-${width}-${mode}.png`), fullPage: true });
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
    }
  }
  await page.goto(base + '/changelog.html');
  assert.equal(await page.locator('.release-rail').evaluate(n => getComputedStyle(n).scrollbarWidth), 'thin');
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('PASS: progress, back-to-top, four custom selects, keyboard navigation, light/dark and desktop/mobile in both languages.');
})().catch(error => { console.error(error); process.exit(1); });
