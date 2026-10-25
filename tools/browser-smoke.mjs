// Optional browser verification for the unified prototype.
// The app and unit tests need no installed packages; this script uses Playwright when available.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
//   BROWSER_EXECUTABLE=/path/to/Chromium \
//   BASE_URL=http://127.0.0.1:5173 npm run test:browser
//
// Results and screenshots are written to artifacts/ (git-ignored).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const modulePath = process.env.PLAYWRIGHT_MODULE || 'playwright-core';
let chromium;
try {
  ({ chromium } = await import(modulePath));
} catch {
  console.error(
    `Playwright が見つかりません（${modulePath}）。\n` +
      'PLAYWRIGHT_MODULE に既存の playwright / playwright-core の index.mjs を指定するか、開発用に導入してください。'
  );
  process.exit(2);
}

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const saveKey = 'need_to_know_mvp_save_v1';
const backupKey = 'need_to_know_mvp_corrupted_backup_v1';
const artifactsDir = 'artifacts';
const results = [];
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
const externalRequests = [];

await mkdir(artifactsDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const track = (target) => {
  target.on('pageerror', (error) => pageErrors.push(error.message));
  target.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  target.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()} ${request.failure()?.errorText || ''}`);
  });
  target.on('request', (request) => {
    try {
      const url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin && !request.url().startsWith('data:')) {
        externalRequests.push(request.url());
      }
    } catch {
      // Ignore non-URL requests.
    }
  });
};
track(page);

const readState = (target = page) =>
  target.evaluate(() => {
    const state = window.__NTK_APP__.getState();
    const raw = localStorage.getItem('need_to_know_mvp_save_v1');
    let saved = null;
    try {
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      saved = null;
    }
    return {
      phase: state.cycle.phase,
      day: state.cycle.day,
      trialStatus: state.trial?.status ?? null,
      x: state.trial?.player.x ?? null,
      clock: state.trial?.externalClock ?? null,
      hazard: state.trial?.hazardTimer ?? null,
      gait: state.trial?.gait.state ?? null,
      omen: state.trial?.omen.active ?? null,
      saveRaw: raw,
      savedTrial: saved?.Trial
        ? { x: saved.Trial.player?.x, clock: saved.Trial.externalClock, status: saved.Trial.status }
        : null,
    };
  });

const click = async (name) => {
  await page.getByRole('button', { name }).first().click();
};

try {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /新規サイクル開始（初回固定Seed/ }).waitFor();
  await page.screenshot({ path: `${artifactsDir}/01-title.png`, fullPage: true });
  results.push('title: loaded');

  await click(/新規サイクル開始（初回固定Seed/);
  await page.getByText('第 1 日 朝').waitFor();
  results.push('morning: day 1 rendered');

  await click(/召集へ進む/);
  await click(/入室して実験を開始する/);
  await page.getByText(/同期知覚字幕/).waitFor();
  const started = await readState();
  assert.equal(started.phase, 'trial');
  assert.equal(started.trialStatus, 'active');
  results.push('trial: T-101 started');

  await page.keyboard.down('d');
  await page.waitForTimeout(2500);
  await page.keyboard.up('d');
  const moved = await readState();
  assert.ok(moved.x > 2.5, `expected to move forward, x=${moved.x}`);
  results.push(`trial: moved to x=${moved.x.toFixed(2)}`);

  // Periodic autosave (2s) must capture an in-progress trial.
  await page.waitForTimeout(2300);
  const saved = await readState();
  assert.ok(saved.savedTrial, 'expected an autosave during the trial');
  assert.equal(saved.savedTrial.status, 'active');
  assert.ok(
    Math.abs(saved.savedTrial.x - saved.x) < 0.05,
    `save x=${saved.savedTrial.x} live x=${saved.x}`
  );
  results.push('autosave: in-progress position persisted');

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#btn-resume-trial').waitFor();
  const restored = await readState();
  assert.equal(restored.trialStatus, 'paused');
  assert.ok(Math.abs(restored.x - saved.x) < 0.05, `restored x=${restored.x} saved x=${saved.x}`);
  assert.ok(
    Math.abs(restored.clock - saved.clock) < 0.1,
    `restored clock=${restored.clock} saved clock=${saved.clock}`
  );
  await page.screenshot({ path: `${artifactsDir}/02-resume-banner.png`, fullPage: true });
  results.push('reload: trial restored paused with position and clock');

  await page.locator('#btn-resume-trial').click();
  await page.waitForTimeout(300);
  const resumed = await readState();
  assert.equal(resumed.trialStatus, 'active');
  results.push('reload: resume button restarts the clock');

  // Trigger an approach warning, then release it with a 0.6s stop.
  await page.keyboard.down('Shift');
  await page.keyboard.down('d');
  await page.waitForTimeout(900);
  await page.keyboard.up('d');
  await page.keyboard.up('Shift');
  const warning = await readState();
  assert.equal(warning.gait, 'approaching');
  assert.equal(warning.omen, true);
  await page.screenshot({ path: `${artifactsDir}/03-warning.png`, fullPage: true });

  await page.keyboard.down(' ');
  await page.waitForTimeout(700);
  await page.keyboard.up(' ');
  const relieved = await readState();
  assert.equal(relieved.gait, 'retreating');
  assert.ok(relieved.hazard < 0.01, `hazard should reset, got ${relieved.hazard}`);
  results.push('trial: omen followed by stop relief (retreating, hazard reset)');

  // Corrupted-save protection runs in a separate tab so pagehide autosave cannot hide it.
  const corruptPage = await context.newPage();
  track(corruptPage);
  await corruptPage.goto(baseURL, { waitUntil: 'networkidle' });
  const corrupted = '{ "schemaVersion": "1.0", "FacilityCycle": CORRUPTED';
  await corruptPage.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [saveKey, corrupted]
  );
  await corruptPage.reload({ waitUntil: 'networkidle' });
  await corruptPage.locator('.corrupted-banner').waitFor();
  const preserved = await corruptPage.evaluate(
    ([key, backup]) => ({
      raw: localStorage.getItem(key),
      backup: localStorage.getItem(backup),
    }),
    [saveKey, backupKey]
  );
  assert.equal(preserved.raw, corrupted);
  await corruptPage.screenshot({ path: `${artifactsDir}/04-corrupted-save.png`, fullPage: true });
  await corruptPage.locator('#btn-resolve-corrupted').click();
  const afterResolve = await corruptPage.evaluate(
    ([key, backup]) => ({
      raw: localStorage.getItem(key),
      backup: localStorage.getItem(backup),
    }),
    [saveKey, backupKey]
  );
  assert.equal(afterResolve.raw, null);
  assert.equal(afterResolve.backup, corrupted);
  results.push('storage: corrupted payload preserved and archived only on explicit action');
  await corruptPage.close();

  // Narrow viewport must not overflow horizontally.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const narrow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    narrow.scrollWidth <= narrow.innerWidth + 1,
    `horizontal overflow at 390px: ${narrow.scrollWidth} > ${narrow.innerWidth}`
  );
  await page.screenshot({ path: `${artifactsDir}/05-mobile-390.png`, fullPage: true });
  results.push('layout: no horizontal overflow at 390px');

  // 200% root text size must remain horizontally scrollable-free at desktop width.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await page.waitForTimeout(400);
  const enlarged = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    enlarged.scrollWidth <= enlarged.innerWidth + 1,
    `horizontal overflow at 200% text: ${enlarged.scrollWidth} > ${enlarged.innerWidth}`
  );
  await page.screenshot({ path: `${artifactsDir}/06-text-200.png`, fullPage: true });
  results.push('layout: no horizontal overflow at 200% text');

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.equal(failedRequests.length, 0, `failed requests: ${failedRequests.join(' | ')}`);
  assert.equal(externalRequests.length, 0, `external requests: ${externalRequests.join(' | ')}`);
  results.push('network: no failed, external, or uncaught-error events');

  const report = {
    baseURL,
    checkedAt: new Date().toISOString(),
    results,
    pageErrors,
    consoleErrors,
    failedRequests,
    externalRequests,
  };
  await writeFile(`${artifactsDir}/browser-verification.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nPASS (${results.length} checks)`);
} catch (error) {
  const report = {
    baseURL,
    checkedAt: new Date().toISOString(),
    results,
    pageErrors,
    consoleErrors,
    failedRequests,
    externalRequests,
    failure: error instanceof Error ? error.message : String(error),
  };
  await writeFile(`${artifactsDir}/browser-verification.json`, JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
