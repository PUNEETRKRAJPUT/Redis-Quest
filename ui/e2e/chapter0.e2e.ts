import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(here, 'screenshots');
mkdirSync(SHOTS, { recursive: true });

/**
 * Until the verifier engine (P0-09) lands, POST /api/levels/:id/verify answers { verdict: 'not_implemented' }.
 * With this on, that answer falls back to POST /api/levels/:id/complete (the engine allows it when ENGINE_DEV=1)
 * and prints a loud NOTE. To remove the fallback once P0-09 is in, set this to false: any verdict other than
 * 'right' then fails the test.
 */
const ALLOW_DEV_COMPLETE_FALLBACK = false;

const LEVELS = [
  'ch0-01-bhai-it-works-on-my-laptop',
  'ch0-02-say-hello',
  'ch0-03-find-your-save-file',
  'ch0-04-the-second-window',
  'ch0-05-roommate-ran-down',
] as const;

const PLAYER_NAME = 'Asha Test';
let shot = 0;
async function snap(page: Page, name: string): Promise<void> {
  shot += 1;
  await page.screenshot({ path: join(SHOTS, `${String(shot).padStart(2, '0')}-${name}.png`), fullPage: true });
}

async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `horizontal overflow on ${where}`).toBeLessThanOrEqual(0);
}

async function openStage(page: Page, n: number): Promise<Locator> {
  const stage = page.getByTestId(`stage-${n}`);
  const head = stage.getByRole('button').first();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  return stage;
}

async function terminalRun(page: Page, command: string): Promise<void> {
  const term = page.getByTestId('terminal').first();
  await term.click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}
const termText = (page: Page) => page.getByTestId('terminal').first().locator('.xterm-rows');

async function brainstorm(page: Page): Promise<void> {
  await openStage(page, 3);
  const first = page.locator('[data-testid^="brainstorm-option-"]').first();
  await first.check();
  await page.getByTestId('brainstorm-text').fill('It is the simplest thing that works for a hostel app.');
  await page.getByTestId('brainstorm-submit').click();
  await expect(page.getByTestId('brainstorm-locked')).toBeVisible();
}

/** Click Verify. Returns the verdict the engine gave. */
async function verify(page: Page): Promise<string> {
  await openStage(page, 6);
  await page.getByTestId('verify-button').click();
  const verdict = page.getByTestId('verdict');
  await expect(verdict).toBeVisible({ timeout: 60_000 });
  return (await verdict.getAttribute('data-verdict')) ?? 'missing';
}

/** Verify once with whatever is typed and wait until the engine has counted attempt number `n`. */
async function verifyAttempt(page: Page, request: APIRequestContext, id: string, n: number): Promise<string> {
  await openStage(page, 6);
  await page.getByTestId('verify-button').click();
  await expect
    .poll(async () => {
      const p = (await (await request.get('/api/progress')).json()) as { levels: Record<string, { attempts: number }> };
      return p.levels[id]?.attempts ?? 0;
    }, { timeout: 60_000 })
    .toBe(n);
  await expect(page.getByTestId('verify-button')).toBeEnabled();
  return (await page.getByTestId('verdict').getAttribute('data-verdict')) ?? 'missing';
}

async function passLevel(page: Page, request: APIRequestContext, id: string): Promise<void> {
  let verdict = await verify(page);
  await snap(page, `${id}-verify-${verdict}`);
  if (verdict === 'not_implemented') {
    if (!ALLOW_DEV_COMPLETE_FALLBACK) throw new Error('verify answered not_implemented and the dev-complete fallback is off');
    console.log(`NOTE: verify not implemented yet, used dev complete (${id})`);
    const res = await request.post(`/api/levels/${id}/complete`, { data: {} });
    expect(res.status(), 'POST /complete needs ENGINE_DEV=1 on the engine').toBe(200);
    verdict = 'right';
  }
  expect(verdict, `verdict for ${id}`).toBe('right');
  // The UI learns about the pass from the progress.changed WebSocket event; no reload.
  await expect(page.getByTestId('level-screen')).toHaveAttribute('data-status', 'passed');
  await expect(page.getByTestId('passed-panel')).toBeVisible();
  await expect(page.locator('[data-showme]').first()).toBeVisible();
}

test('Chapter 0 end to end: welcome, map, five levels, built, tools', async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // ---- welcome ------------------------------------------------------------------------------------------
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expectNoHorizontalScroll(page, 'welcome');
  await snap(page, 'welcome');
  await page.getByTestId('player-name').fill(PLAYER_NAME);
  await page.getByTestId('player-submit').click();

  // ---- map ------------------------------------------------------------------------------------------------
  await expect(page.getByTestId('chapter-map')).toBeVisible();
  await expect(page.getByTestId('chapter-ch0')).toBeVisible();
  for (const id of LEVELS) await expect(page.getByTestId(`level-${id}`)).toBeVisible();
  await expect(page.getByTestId(`level-${LEVELS[0]}`)).toHaveAttribute('href', /#\/level\//);
  await expect(page.getByTestId(`level-${LEVELS[1]}`)).toHaveAttribute('aria-disabled', 'true');
  await expectNoHorizontalScroll(page, 'map');
  await page.getByRole('button', { name: /Read the chapter thread/ }).click();
  await expect(page.locator('.thread .msg').first()).toBeVisible();
  await snap(page, 'map-start');
  const progress = (await (await request.get('/api/progress')).json()) as { player: { id: string; name: string } };
  expect(progress.player.name).toBe(PLAYER_NAME);
  const playerId = progress.player.id;

  // keyboard reachable: Tab lands on a real control, not on the body
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');

  // ---- level 1: ops, the full seven-beat tour --------------------------------------------------------------
  await page.getByTestId(`level-${LEVELS[0]}`).click();
  await expect(page.getByTestId('level-screen')).toHaveAttribute('data-level', LEVELS[0]);
  await expect(page.getByTestId('level-status')).toHaveText(/in progress/);
  await expect(page.getByTestId('stage-1').locator('.msg').first()).toBeVisible();
  await snap(page, 'level1-scenario');
  await openStage(page, 2);
  await expect(page.getByTestId('pain')).toBeVisible();
  await expect(page.getByTestId('redis-state')).toHaveText(/Redis is up/);
  await snap(page, 'level1-exists');
  await brainstorm(page);
  await snap(page, 'level1-brainstorm');
  await openStage(page, 4);
  await expect(page.getByTestId('stage-4').locator('.codeblock, .inline-code').first()).toBeVisible();
  const docLink = page.getByTestId('stage-4').locator('a[href^="https://redis.io/docs/"]').first();
  await expect(docLink).toHaveAttribute('target', '_blank');
  await openStage(page, 5);
  await page.getByTestId('hint-button').click();
  await expect(page.getByTestId('hint-0')).toBeVisible();
  await page.getByTestId('tab-terminal').click();
  await terminalRun(page, 'GET game:engine:boots');
  await expect(termText(page)).toContainText(/"\d+"/);
  await snap(page, 'level1-build');
  // Beat 7 is locked until a pass, a third failure, or a request.
  await openStage(page, 7);
  await expect(page.getByTestId('ideal-request')).toBeVisible();
  await passLevel(page, request, LEVELS[0]);
  // F-04: passed -> the panel is open with the reference solution, its reasoning and the wrong solutions.
  const ideal1 = page.getByTestId('stage-7').getByTestId('ideal');
  await expect(ideal1).toBeVisible();
  await expect(ideal1.getByTestId('ideal-reference')).toContainText('./scripts/start');
  await expect(ideal1.getByTestId('ideal-wrong').first()).toBeVisible();
  await expect(ideal1.getByTestId('ideal-reasoning')).toContainText('Why the others fall short');
  await snap(page, 'level1-passed');
  await expectNoHorizontalScroll(page, 'level');
  await page.getByTestId('next-level').click();

  // ---- level 2: cli, PING in the real terminal ---------------------------------------------------------------
  await expect(page.getByTestId('level-screen')).toHaveAttribute('data-level', LEVELS[1]);
  await brainstorm(page);
  await openStage(page, 5);
  await terminalRun(page, 'PING');
  await expect(termText(page)).toContainText('PONG');
  await terminalRun(page, 'INFO server');
  await expect(termText(page)).toContainText('redis_version');
  await terminalRun(page, 'DBSIZE');
  await expect(termText(page)).toContainText('(integer)');
  // F-06: with the terminal focused (and a full-page screenshot taken, which is what used to arm the jump), a real
  // click on a header further down must not move the page.
  await snap(page, 'level2-terminal');
  const stage6 = page.getByTestId('stage-6').getByRole('button').first();
  await stage6.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await stage6.click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before), `page scrollY moved from ${before} to ${after} when focus left the terminal`).toBeLessThanOrEqual(1);
  await passLevel(page, request, LEVELS[1]);
  await page.getByTestId('next-level').click();

  // ---- level 3: cli + answer box ---------------------------------------------------------------------------
  await expect(page.getByTestId('level-screen')).toHaveAttribute('data-level', LEVELS[2]);
  await brainstorm(page);
  await openStage(page, 5);
  await terminalRun(page, 'KEYS game:*');
  await expect(termText(page)).toContainText('[warning]');
  await expect(termText(page)).toContainText(`game:player:${playerId}`);
  await terminalRun(page, `TYPE game:player:${playerId}`);
  await expect(termText(page)).toContainText('hash');
  await terminalRun(page, `HGET game:player:${playerId} name`);
  await expect(termText(page)).toContainText(`"${PLAYER_NAME}"`);
  // F-04: three failed attempts with a wrong answer unlock the ideal way, with the reference and the wrong solutions.
  await openStage(page, 7);
  await expect(page.getByTestId('ideal-reason')).toContainText('0 of 3 attempts used');
  await snap(page, 'level3-ideal-locked');
  await page.getByTestId('answer-1').fill('definitely not the name');
  for (const n of [1, 2, 3]) {
    expect(await verifyAttempt(page, request, LEVELS[2], n), `wrong answer, attempt ${n}`).toBe('wrong');
  }
  const ideal3 = page.getByTestId('stage-7').getByTestId('ideal');
  await openStage(page, 7);
  await expect(ideal3).toBeVisible();
  await expect(page.getByTestId('stage-7')).toContainText('unlocked');
  await expect(ideal3.getByTestId('ideal-reference')).toContainText(`HGET game:player:${playerId} name`);
  await expect(ideal3.getByTestId('ideal-wrong').first()).toContainText('03-wrong-get-on-a-hash.redis');
  await ideal3.getByTestId('ideal-wrong').first().locator('summary').click();
  await expect(ideal3.getByTestId('ideal-wrong').first()).toContainText('WRONGTYPE');
  await snap(page, 'level3-ideal-after-three-fails');
  await page.getByTestId('answer-1').fill(PLAYER_NAME);
  await snap(page, 'level3-terminal');
  await passLevel(page, request, LEVELS[2]);
  await expect(page.getByTestId('passed-panel').getByTestId('hash-table')).toContainText(PLAYER_NAME);
  await page.getByTestId('next-level').click();

  // ---- level 4: ops + answer box: read the TTL through the terminal ------------------------------------------
  await expect(page.getByTestId('level-screen')).toHaveAttribute('data-level', LEVELS[3]);
  await brainstorm(page);
  await openStage(page, 5);
  await page.getByTestId('tab-terminal').click();
  await terminalRun(page, 'TTL game:welcome:gift');
  await expect(termText(page)).toContainText(/\(integer\) \d{3,}/);
  const ttlText = (await termText(page).innerText()).match(/\(integer\) (\d{3,})/g)?.pop() ?? '';
  const ttl = ttlText.replace(/\D/g, '');
  expect(Number(ttl)).toBeGreaterThan(0);
  // F-04: "Reveal anyway" on a locked level fetches the ideal way.
  await openStage(page, 7);
  await expect(page.getByTestId('ideal-reason')).toContainText('0 of 3 attempts used');
  await page.getByTestId('ideal-request').click();
  const ideal4 = page.getByTestId('stage-7').getByTestId('ideal');
  await expect(ideal4).toBeVisible();
  await expect(ideal4.getByTestId('ideal-revealed-note')).toBeVisible();
  await expect(ideal4.getByTestId('ideal-reference')).toBeVisible();
  const lv4 = (await (await request.get(`/api/progress`)).json()) as { levels: Record<string, { status: string }> };
  expect(lv4.levels[LEVELS[3]]?.status).not.toBe('passed');
  await snap(page, 'level4-ideal-revealed-anyway');
  await page.getByTestId('answer-0').fill(ttl);
  await passLevel(page, request, LEVELS[3]);
  await expect(page.getByTestId('passed-panel').getByTestId('ttl-left')).toBeVisible();
  await page.getByTestId('next-level').click();

  // ---- level 5: ops (the real down/up is done by the learner on the host; the check cannot do it) ---------------
  await expect(page.getByTestId('level-screen')).toHaveAttribute('data-level', LEVELS[4]);
  await brainstorm(page);
  await passLevel(page, request, LEVELS[4]);
  await expect(page.getByTestId('next-level')).toHaveCount(0);

  // ---- map after: xp and badge ---------------------------------------------------------------------------------
  await page.goto('/#/');
  await expect(page.getByTestId('xp')).toHaveText('85');
  await expect(page.locator('.badges')).toContainText('Booted');
  for (const id of LEVELS) await expect(page.getByTestId(`level-${id}`)).toContainText('Passed');
  await snap(page, 'map-done');

  // ---- what you built -----------------------------------------------------------------------------------------
  await page.getByRole('link', { name: /What you built/ }).click();
  await expect(page.getByTestId('built')).toBeVisible();
  for (const id of LEVELS) await expect(page.getByTestId(`built-${id}`).locator('[data-showme]')).toBeVisible();
  await expect(page.getByTestId(`built-${LEVELS[2]}`)).toContainText(PLAYER_NAME);
  // F-09: the Insight link follows insightUrl from GET /health: the page hostname and the stack's INSIGHT_PORT.
  await expect(page.getByTestId('insight-link')).toHaveAttribute('href', `http://${new URL(page.url()).hostname}:5543`);
  await expectNoHorizontalScroll(page, 'built');
  await snap(page, 'built');

  // ---- standalone tools ----------------------------------------------------------------------------------------
  await page.getByRole('link', { name: 'Terminal', exact: true }).click();
  await terminalRun(page, 'SET quest:e2e hello');
  await terminalRun(page, 'GET quest:e2e');
  await expect(termText(page)).toContainText('"hello"');
  await snap(page, 'terminal');

  await page.getByRole('link', { name: 'Editor', exact: true }).click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.filelist .file').first()).toBeVisible();
  const openedPath = ((await page.locator('.editor-bar code').innerText()) ?? '').replace(/^workspace\//, '');
  await page.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n// edited in the browser');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.editor-bar')).toContainText('Saved');
  const saved = (await (await request.get(`/api/workspace/file?path=${encodeURIComponent(openedPath)}`)).json()) as { content: string };
  expect(saved.content).toContain('// edited in the browser');
  await snap(page, 'editor');

  await page.getByRole('link', { name: 'Logs', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'proxy' })).toBeVisible();
  await page.getByRole('tab', { name: 'proxy' }).click();
  await expect(page.locator('.logbox')).not.toBeEmpty();
  await snap(page, 'logs');

  await page.getByRole('link', { name: 'Metrics', exact: true }).click();
  await expect(page.getByTestId('metrics')).toBeVisible();
  await expect(page.getByTestId('metric-p99')).toBeVisible();
  await snap(page, 'metrics');

  await page.goto('/#/showme');
  await expect(page.locator('[data-showme]')).toHaveCount(12);
  await snap(page, 'showme-gallery');

  // ---- FLUSHALL in the terminal: warning, then the mirror banner, then restore ---------------------------------
  await page.getByRole('link', { name: 'Terminal', exact: true }).click();
  await terminalRun(page, 'FLUSHALL');
  await expect(termText(page)).toContainText('[warning]');
  await expect(page.getByTestId('mirror-banner')).toBeVisible({ timeout: 20_000 });
  await snap(page, 'mirror-banner');
  await page.getByRole('button', { name: 'Restore my save file' }).click();
  await expect(page.getByTestId('mirror-banner')).toBeHidden({ timeout: 20_000 });

  // ---- dark scheme -----------------------------------------------------------------------------------------------
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#/');
  await expect(page.getByTestId('chapter-map')).toBeVisible();
  await snap(page, 'map-dark');
  await page.goto(`/#/level/${LEVELS[2]}`);
  await expect(page.getByTestId('level-screen')).toBeVisible();
  await snap(page, 'level-dark');

  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
