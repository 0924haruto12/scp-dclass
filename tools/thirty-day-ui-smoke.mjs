// Optional full 30-day UI walkthrough for the 30-day prototype.
// Like browser-smoke.mjs, this needs an existing Playwright module and Chromium.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
//   BROWSER_EXECUTABLE=/path/to/Chromium \
//   BASE_URL=http://127.0.0.1:5173 npm run test:30day
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
const artifactsDir = 'artifacts';
const results = [];
const pageErrors = [];
const consoleErrors = [];

await mkdir(artifactsDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

const click = async (selector) => {
  // Some buttons replace the whole UI synchronously. Click through the DOM and
  // yield briefly so the new frame is rendered before the next step. Verification
  // presets can live inside a closed <details>, so presence is enough here.
  try {
    await page.waitForSelector(selector, { timeout: 5000, state: 'attached' });
  } catch {
    const diagnostic = await page.evaluate(() => {
      const state = window.__NTK_APP__.getState();
      return {
        day: state.cycle.day,
        phase: state.cycle.phase,
        trialStatus: state.trial?.status ?? null,
        room: state.trial?.roomCode ?? null,
        badge: state.trial?.badge ?? null,
      };
    });
    throw new Error(`click target not found: ${selector} ${JSON.stringify(diagnostic)}`);
  }
  const clicked = await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) return false;
    element.click();
    return true;
  }, selector);
  if (!clicked) {
    throw new Error(`click target not found: ${selector}`);
  }
  await page.waitForTimeout(30);
};

const readState = () =>
  page.evaluate(() => {
    const state = window.__NTK_APP__.getState();
    return {
      day: state.cycle.day,
      phase: state.cycle.phase,
      ending: state.cycle.endingResult,
      subjectId: state.subject.subjectId,
      C: state.subject.C,
      S: state.subject.S,
      E: state.subject.E,
      room: state.trial?.roomCode ?? null,
    };
  });

const completeT101 = async () => {
  // Collect the objective, do the required 8m run in two segments with a stop
  // between them, then walk back to the exit.
  await click('[data-obj="obj-t101-box"]');
  await click('[data-step-mode="run"][data-step-dir="-1"][data-step-sec="2.0"]');
  await click('[data-step-mode="stop"][data-step-dir="0"][data-step-sec="0.6"]');
  await click('[data-step-mode="run"][data-step-dir="-1"][data-step-sec="2.0"]');
  await click('[data-step-mode="stop"][data-step-dir="0"][data-step-sec="0.6"]');
  await click('[data-step-mode="normal"][data-step-dir="-1"][data-step-sec="3.0"]');
  await click('[data-step-mode="normal"][data-step-dir="-1"][data-step-sec="3.0"]');
};

const completeT204 = async () => {
  await click('[data-obj="obj-t204-counter"]');
  await click('[data-obj="obj-t204-booth"]');
  await click('[data-obj="obj-t204-terminal"]');
  await click('[data-obj="obj-t204-tray"]');
  // The running trial loop sees interview + badge return + position at the exit
  // and transitions to the debrief on the next frame.
};

const completeT309 = async () => {
  await click('[data-obj="obj-t309-open-main"]');
  await click('#btn-wd-forward');
  await click('#btn-wd-forward');
  await click('#btn-wd-forward');
  await click('[data-obj="obj-t309-board"]');
  await click('#btn-wd-backward');
  await click('#btn-wd-backward');
  await click('#btn-wd-backward');
  await click('#btn-wd-backward');
};

try {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /新規サイクル開始（初回固定Seed/ }).click();
  await page.getByText('第 1 日 朝').waitFor();
  results.push('start: day 1 morning rendered');

  for (let day = 1; day <= 30; day++) {
    const morningState = await readState();
    assert.equal(morningState.day, day);
    assert.equal(morningState.phase, 'morning');

    // Clear the previous badge's hazard assignment if it is still active.
    if ((await page.locator('#btn-morning-reverify-badge').count()) > 0) {
      await click('#btn-morning-reverify-badge');
    }

    await click('#btn-proceed-briefing');
    await page.getByText(`第 ${day} 日 召集`).waitFor();
    // The briefing phase has no trial yet; read the scheduled room from the app state.
    const scheduledRoom = await page.evaluate((targetDay) => {
      const state = window.__NTK_APP__.getState();
      return state.cycle.schedule.find((entry) => entry.day === targetDay)?.roomCode ?? null;
    }, day);
    assert.ok(scheduledRoom, `day ${day} has a scheduled room`);

    await click('#btn-enter-trial');
    await page.getByText(/同期知覚字幕/).waitFor();
    const trialState = await readState();
    assert.equal(trialState.room, scheduledRoom);

    if (scheduledRoom === 'T-101') {
      await completeT101();
    } else if (scheduledRoom === 'T-204') {
      await completeT204();
    } else if (scheduledRoom === 'T-309') {
      await completeT309();
    } else {
      throw new Error(`unexpected room ${scheduledRoom}`);
    }

    await page.getByText(/【生還・事後聴取】/).waitFor();
    await click('button[data-choice="choice-silent"]');

    if (day < 30) {
      await page.getByText(`第 ${day} 日 夜`).waitFor();
      await click('#btn-night-safe-task');
      await click('#btn-proceed-next-day');
      await page.getByText(`第 ${day + 1} 日 朝`).waitFor();
    }
  }

  await page.getByRole('heading', { name: '終了分岐 3：有用認定' }).waitFor();
  const finalState = await readState();
  assert.equal(finalState.day, 30);
  assert.equal(finalState.phase, 'ending');
  assert.equal(finalState.ending, 'certified_useful');
  assert.equal(finalState.E, 2);
  assert.ok(finalState.C >= 2);
  assert.ok(finalState.S <= 1);

  await page.screenshot({ path: `${artifactsDir}/30-day-run-ending.png`, fullPage: true });
  results.push('run: 30 days completed through the final trial');
  results.push(
    `ending: ${finalState.ending} (E=${finalState.E}, C=${finalState.C}, S=${finalState.S})`
  );

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  results.push('console: no uncaught page errors');

  const report = {
    baseURL,
    checkedAt: new Date().toISOString(),
    results,
    pageErrors,
    consoleErrors,
    finalState,
  };
  await writeFile(`${artifactsDir}/thirty-day-run.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nPASS (${results.length} checks)`);
} catch (error) {
  const report = {
    baseURL,
    checkedAt: new Date().toISOString(),
    results,
    pageErrors,
    consoleErrors,
    failure: error instanceof Error ? error.message : String(error),
  };
  await writeFile(`${artifactsDir}/thirty-day-run.json`, JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
