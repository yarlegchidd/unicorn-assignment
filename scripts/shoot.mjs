#!/usr/bin/env node
/**
 * Manual UI check: drives the app through idle, loading and success and writes
 * screenshots, failing loudly on any console error. Not part of `npm test` --
 * it needs a browser and a running frontend.
 *
 *   npm i -D playwright && npx playwright install chromium
 *   node scripts/mock-api.mjs &      # or `npm run dev:api` for the real thing
 *   npm --prefix web run dev &
 *   node scripts/shoot.mjs
 */

import { chromium } from 'playwright';

const URL_UNDER_TEST = process.env.APP ?? 'http://localhost:5174';
const LINK = 'https://drive.google.com/file/d/1RecmQXu2U-p_p1XPGrqRmialbSa63eDx/view';
const OUT = process.env.OUT ?? '/tmp/cs';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 2 });

const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(String(error)));

await page.goto(URL_UNDER_TEST, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/ui-idle.png`, fullPage: true });

await page.fill('#drive-url', LINK);
await page.click('button[type=submit]');
await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/ui-loading.png`, fullPage: true });

await page.waitForSelector('.attributes', { timeout: 30000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/ui-result.png`, fullPage: true });

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
