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
  await page.screenshot({
    path: join(SHOTS, `${String(shot).padStart(2, '0')}-${name}.png`),
    fullPage: true,
  });
}

/**
 * Next.js keeps up to three visited routes mounted but hidden, so one test id can match a visible and a hidden
 * element. What the player interacts with is looked up among visible elements only.
 */
const vis = (page: Page, id: string): Locator => page.getByTestId(id).filter({ visible: true });

async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `horizontal overflow on ${where}`).toBeLessThanOrEqual(0);
}

async function openStage(page: Page, n: number): Promise<Locator> {
  const stage = vis(page, `stage-${n}`);
  const head = stage.getByRole('button').first();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  return stage;
}

async function terminalRun(page: Page, command: string): Promise<void> {
  const term = vis(page, 'terminal').first();
  await term.click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}
const termText = (page: Page) => vis(page, 'terminal').first().locator('.xterm-rows');

async function brainstorm(page: Page): Promise<void> {
  await openStage(page, 3);
  const first = page.locator('[data-testid^="brainstorm-option-"]').first();
  await first.check();
  await page
    .getByTestId('brainstorm-text')
    .fill('It is the simplest thing that works for a hostel app.');
  await vis(page, 'brainstorm-submit').click();
  await expect(vis(page, 'brainstorm-locked')).toBeVisible();
}

/** Click "Verify my work". Returns the verdict the engine gave. */
async function verify(page: Page): Promise<string> {
  await openStage(page, 6);
  await vis(page, 'verify-button').click();
  // F-21: the third-umpire review plays over the page (pointer-transparent) before the verdict is revealed.
  await expect(page.getByTestId('big-screen')).toBeVisible({ timeout: 5_000 });
  const verdict = vis(page, 'verdict');
  await expect(verdict).toBeVisible({ timeout: 60_000 });
  return (await verdict.getAttribute('data-verdict')) ?? 'missing';
}

/** Verify once with whatever is typed and wait until the engine has counted attempt number `n`. */
async function verifyAttempt(
  page: Page,
  request: APIRequestContext,
  id: string,
  n: number,
): Promise<string> {
  await openStage(page, 6);
  await vis(page, 'verify-button').click();
  await expect
    .poll(
      async () => {
        const p = (await (await request.get('/api/progress')).json()) as {
          levels: Record<string, { attempts: number }>;
        };
        return p.levels[id]?.attempts ?? 0;
      },
      { timeout: 60_000 },
    )
    .toBe(n);
  await expect(vis(page, 'verify-button')).toBeEnabled();
  await expect(vis(page, 'verdict')).toBeVisible();
  return (await vis(page, 'verdict').getAttribute('data-verdict')) ?? 'missing';
}

async function passLevel(page: Page, request: APIRequestContext, id: string): Promise<void> {
  let verdict = await verify(page);
  await snap(page, `${id}-verify-${verdict}`);
  if (verdict === 'not_implemented') {
    if (!ALLOW_DEV_COMPLETE_FALLBACK)
      throw new Error('verify answered not_implemented and the dev-complete fallback is off');
    console.log(`NOTE: verify not implemented yet, used dev complete (${id})`);
    const res = await request.post(`/api/levels/${id}/complete`, { data: {} });
    expect(res.status(), 'POST /complete needs ENGINE_DEV=1 on the engine').toBe(200);
    verdict = 'right';
  }
  expect(verdict, `verdict for ${id}`).toBe('right');
  // The UI learns about the pass from the progress.changed WebSocket event; no reload.
  await expect(vis(page, 'level-screen')).toHaveAttribute('data-status', 'passed');
  await expect(vis(page, 'passed-panel')).toBeVisible();
  await expect(vis(page, 'passed-panel').locator('[data-showme]').first()).toBeVisible();
}

test('Chapter 0 end to end: welcome, map, five levels, built, tools', async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // ---- welcome ------------------------------------------------------------------------------------------
  // F-18: an opening scene (about nine seconds) plays before the name form; "Skip intro" or Escape jumps to the
  // form with the name field focused. After the submit a two-second, pointer-transparent kick-off beat plays.
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByTestId('welcome-skip')).toBeVisible();
  await expect(page.getByTestId('welcome-line').first()).toBeVisible({ timeout: 10_000 });
  await expectNoHorizontalScroll(page, 'welcome');
  await snap(page, 'welcome');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('player-name')).toBeFocused();
  await page.keyboard.type(PLAYER_NAME);
  await page.getByTestId('jersey-sky').click();
  await snap(page, 'welcome-form');
  await page.getByTestId('player-submit').click();
  const kickoff = page.getByTestId('welcome-kickoff');
  await expect(kickoff).toBeVisible();
  await expect(kickoff).toContainText(PLAYER_NAME);
  await snap(page, 'welcome-kickoff');
  await expect(kickoff).toBeHidden({ timeout: 10_000 });

  // ---- map ------------------------------------------------------------------------------------------------
  await expect(page.getByTestId('chapter-map')).toBeVisible();
  await expect(page.getByTestId('chapter-ch0')).toBeVisible();
  for (const id of LEVELS) await expect(page.getByTestId(`level-${id}`)).toBeVisible();
  // F-14: real routes, no hash links.
  await expect(page.getByTestId(`level-${LEVELS[0]}`)).toHaveAttribute(
    'href',
    `/level/${LEVELS[0]}`,
  );
  await expect(page.getByTestId('next-match-play')).toHaveAttribute('href', `/level/${LEVELS[0]}`);
  await expect(page.getByTestId('caps-count')).toHaveText('0 caps');
  await expect(page.getByTestId(`level-${LEVELS[1]}`)).toHaveAttribute('aria-disabled', 'true');
  await expectNoHorizontalScroll(page, 'map');
  await page.getByRole('button', { name: /Read the chapter thread/ }).click();
  const threadDialog = page.getByRole('dialog');
  await expect(threadDialog.getByTestId('thread-msg').first()).toBeVisible();
  await snap(page, 'map-start');
  // The thread is a modal: Escape closes it and the map is usable again.
  await page.keyboard.press('Escape');
  await expect(threadDialog).toBeHidden();
  const progress = (await (await request.get('/api/progress')).json()) as {
    player: { id: string; name: string };
  };
  expect(progress.player.name).toBe(PLAYER_NAME);
  const playerId = progress.player.id;

  // keyboard reachable: Tab lands on a real control, not on the body
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');

  // ---- level 1: ops, the full seven-beat tour --------------------------------------------------------------
  await page.getByTestId(`level-${LEVELS[0]}`).click();
  await expect(page).toHaveURL(new RegExp(`/level/${LEVELS[0]}$`));
  await expect(vis(page, 'level-screen')).toHaveAttribute('data-level', LEVELS[0]);
  await expect(vis(page, 'level-status')).toHaveText(/in progress/);
  await expect(vis(page, 'stage-1').getByTestId('thread-msg').first()).toBeVisible();
  await snap(page, 'level1-scenario');
  await openStage(page, 2);
  await expect(vis(page, 'pain')).toBeVisible();
  await expect(vis(page, 'redis-state')).toHaveText(/Redis is up/);
  await snap(page, 'level1-exists');
  await brainstorm(page);
  await snap(page, 'level1-brainstorm');
  await openStage(page, 4);
  await expect(vis(page, 'stage-4').locator('.codeblock, .inline-code').first()).toBeVisible();
  const docLink = vis(page, 'stage-4').locator('a[href^="https://redis.io/docs/"]').first();
  await expect(docLink).toHaveAttribute('target', '_blank');
  await openStage(page, 5);
  await vis(page, 'hint-button').click();
  await expect(vis(page, 'hint-0')).toBeVisible();
  await vis(page, 'tab-terminal').click();
  await terminalRun(page, 'GET game:engine:boots');
  await expect(termText(page)).toContainText(/"\d+"/);
  await snap(page, 'level1-build');
  // Beat 7 is locked until a pass, a third failure, or a request.
  await openStage(page, 7);
  await expect(vis(page, 'ideal-request')).toBeVisible();
  await passLevel(page, request, LEVELS[0]);
  // F-04: passed -> the panel is open with the reference solution, its reasoning and the wrong solutions.
  const ideal1 = vis(page, 'stage-7').getByTestId('ideal');
  await expect(ideal1).toBeVisible();
  await expect(ideal1.getByTestId('ideal-reference')).toContainText('./scripts/start');
  await expect(ideal1.getByTestId('ideal-wrong').first()).toBeVisible();
  await expect(ideal1.getByTestId('ideal-reasoning')).toContainText('Why the others fall short');
  await snap(page, 'level1-passed');
  await expectNoHorizontalScroll(page, 'level');
  await vis(page, 'next-level').click();

  // ---- level 2: cli, PING in the real terminal ---------------------------------------------------------------
  await expect(vis(page, 'level-screen')).toHaveAttribute('data-level', LEVELS[1]);
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
  const stage6 = vis(page, 'stage-6').getByRole('button').first();
  await stage6.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await stage6.click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.scrollY);
  expect(
    Math.abs(after - before),
    `page scrollY moved from ${before} to ${after} when focus left the terminal`,
  ).toBeLessThanOrEqual(1);
  await passLevel(page, request, LEVELS[1]);
  await vis(page, 'next-level').click();

  // ---- level 3: cli + answer box ---------------------------------------------------------------------------
  await expect(vis(page, 'level-screen')).toHaveAttribute('data-level', LEVELS[2]);
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
  await expect(vis(page, 'ideal-reason')).toContainText('0 of 3 attempts used');
  await snap(page, 'level3-ideal-locked');
  await vis(page, 'answer-1').fill('definitely not the name');
  for (const n of [1, 2, 3]) {
    expect(await verifyAttempt(page, request, LEVELS[2], n), `wrong answer, attempt ${n}`).toBe(
      'wrong',
    );
  }
  const ideal3 = vis(page, 'stage-7').getByTestId('ideal');
  await openStage(page, 7);
  await expect(ideal3).toBeVisible();
  await expect(vis(page, 'stage-7')).toContainText('unlocked');
  await expect(ideal3.getByTestId('ideal-reference')).toContainText(
    `HGET game:player:${playerId} name`,
  );
  await expect(ideal3.getByTestId('ideal-wrong').first()).toContainText(
    '03-wrong-get-on-a-hash.redis',
  );
  await ideal3.getByTestId('ideal-wrong').first().locator('summary').click();
  await expect(ideal3.getByTestId('ideal-wrong').first()).toContainText('WRONGTYPE');
  await snap(page, 'level3-ideal-after-three-fails');
  await vis(page, 'answer-1').fill(PLAYER_NAME);
  await snap(page, 'level3-terminal');
  await passLevel(page, request, LEVELS[2]);
  await expect(vis(page, 'passed-panel').getByTestId('hash-table')).toContainText(PLAYER_NAME);
  // F-05: the panel shows the key the level declares (show_me.keys), not one the UI hard-codes.
  const keyPanel = vis(page, 'passed-panel').getByTestId('showme-panel');
  await expect(keyPanel).toHaveAttribute('data-key', `game:player:${playerId}`);
  await expect(keyPanel.locator('.showme-key')).toHaveText(`game:player:${playerId}`);
  await vis(page, 'next-level').click();

  // ---- level 4: ops + answer box: read the TTL through the terminal ------------------------------------------
  await expect(vis(page, 'level-screen')).toHaveAttribute('data-level', LEVELS[3]);
  await brainstorm(page);
  await openStage(page, 5);
  await vis(page, 'tab-terminal').click();
  await terminalRun(page, 'TTL game:welcome:gift');
  await expect(termText(page)).toContainText(/\(integer\) \d{3,}/);
  const ttlText = (await termText(page).innerText()).match(/\(integer\) (\d{3,})/g)?.pop() ?? '';
  const ttl = ttlText.replace(/\D/g, '');
  expect(Number(ttl)).toBeGreaterThan(0);
  // F-04: "Reveal anyway" on a locked level fetches the ideal way.
  await openStage(page, 7);
  await expect(vis(page, 'ideal-reason')).toContainText('0 of 3 attempts used');
  await vis(page, 'ideal-request').click();
  const ideal4 = vis(page, 'stage-7').getByTestId('ideal');
  await expect(ideal4).toBeVisible();
  await expect(ideal4.getByTestId('ideal-revealed-note')).toBeVisible();
  await expect(ideal4.getByTestId('ideal-reference')).toBeVisible();
  const lv4 = (await (await request.get(`/api/progress`)).json()) as {
    levels: Record<string, { status: string }>;
  };
  expect(lv4.levels[LEVELS[3]]?.status).not.toBe('passed');
  await snap(page, 'level4-ideal-revealed-anyway');
  await vis(page, 'answer-0').fill(ttl);
  await passLevel(page, request, LEVELS[3]);
  await expect(vis(page, 'passed-panel').getByTestId('ttl-left')).toBeVisible();
  await vis(page, 'next-level').click();

  // ---- level 5: ops (the real down/up is done by the learner on the host; the check cannot do it) ---------------
  await expect(vis(page, 'level-screen')).toHaveAttribute('data-level', LEVELS[4]);
  await brainstorm(page);
  await passLevel(page, request, LEVELS[4]);
  await expect(vis(page, 'next-level')).toHaveCount(0);

  // ---- map after: xp and badge ---------------------------------------------------------------------------------
  // An old hash URL from the Vite app still works: the shell replaces it with the real path.
  await page.goto('/#/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('xp')).toHaveText('85');
  await expect(page.getByTestId('caps-count')).toHaveText('1 cap');
  await expect(page.locator('.badges')).toContainText('Booted');
  for (const id of LEVELS) await expect(page.getByTestId(`level-${id}`)).toContainText('Passed');
  await snap(page, 'map-done');

  // ---- what you built -----------------------------------------------------------------------------------------
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /What you built/ })
    .click();
  await expect(page).toHaveURL(/\/built$/);
  await expect(page.getByTestId('built')).toBeVisible();
  for (const id of LEVELS)
    await expect(page.getByTestId(`built-${id}`).locator('[data-showme]')).toBeVisible();
  await expect(page.getByTestId(`built-${LEVELS[2]}`)).toContainText(PLAYER_NAME);
  // F-09: the Insight link follows insightUrl from GET /health: the page hostname and the stack's INSIGHT_PORT.
  await expect(page.getByTestId('insight-link')).toHaveAttribute(
    'href',
    `http://${new URL(page.url()).hostname}:5543`,
  );
  await expectNoHorizontalScroll(page, 'built');
  await snap(page, 'built');

  // ---- standalone tools ----------------------------------------------------------------------------------------
  await page.getByRole('link', { name: 'Terminal', exact: true }).click();
  await terminalRun(page, 'SET quest:e2e hello');
  await terminalRun(page, 'GET quest:e2e');
  await expect(termText(page)).toContainText('"hello"');
  await snap(page, 'terminal');

  await page.getByRole('link', { name: 'Editor', exact: true }).click();
  await expect(page).toHaveURL(/\/editor$/);
  const editor = vis(page, 'editor-panel');
  await expect(editor.locator('.monaco-editor').first()).toBeVisible({ timeout: 60_000 });
  // On the /editor page the file list starts open; it folds away and comes back.
  await expect(editor.getByTestId('editor-file').first()).toBeVisible();
  await editor.getByTestId('editor-files-toggle').click();
  await expect(editor.getByTestId('editor-file').first()).toBeHidden();
  await editor.getByTestId('editor-files-toggle').click();
  await expect(editor.getByTestId('editor-file').first()).toBeVisible();
  const openedPath = (
    (await editor.getByTestId('editor-bar').locator('code').innerText()) ?? ''
  ).replace(/^workspace\//, '');
  await editor.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n// edited in the browser');
  const save = editor.getByRole('button', { name: 'Save' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(editor.getByTestId('editor-bar')).toContainText('Saved');
  const saved = (await (
    await request.get(`/api/workspace/file?path=${encodeURIComponent(openedPath)}`)
  ).json()) as { content: string };
  expect(saved.content).toContain('// edited in the browser');
  await snap(page, 'editor');

  await page.getByRole('link', { name: 'Logs', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'proxy' })).toBeVisible();
  await page.getByRole('tab', { name: 'proxy' }).click();
  await expect(vis(page, 'logbox')).not.toBeEmpty();
  await snap(page, 'logs');

  await page.getByRole('link', { name: 'Metrics', exact: true }).click();
  await expect(vis(page, 'metrics')).toBeVisible();
  await expect(vis(page, 'metric-p99')).toBeVisible();
  await snap(page, 'metrics');

  await page.goto('/#/showme');
  await expect(page).toHaveURL(/\/showme$/);
  // Every registered show-me component renders once on sample data: 14 before F-13, 19 with its five panels.
  // (Visible ones only: What you built may still be mounted, hidden, with its own panels.)
  await expect(page.locator('[data-showme]').filter({ visible: true })).toHaveCount(19);
  await expect(page.getByText('Unknown show-me component')).toHaveCount(0);
  await snap(page, 'showme-gallery');
  // F-10: the two components that used to fall back to "unknown", shot on their own.
  for (const id of ['stats_latency_panel', 'otp_limiter_panel']) {
    const card = page.locator(`[data-showme="${id}"]`).filter({ visible: true });
    await expect(card).toBeVisible();
    await card.screenshot({ path: join(SHOTS, `showme-${id}.png`) });
  }

  // ---- FLUSHALL in the terminal: warning, then the mirror banner, then restore ---------------------------------
  await page.getByRole('link', { name: 'Terminal', exact: true }).click();
  await terminalRun(page, 'FLUSHALL');
  await expect(termText(page)).toContainText('[warning]');
  await expect(vis(page, 'mirror-banner')).toBeVisible({ timeout: 20_000 });
  await snap(page, 'mirror-banner');
  await page.getByRole('button', { name: 'Restore my save file' }).click();
  await expect(vis(page, 'mirror-banner')).toBeHidden({ timeout: 20_000 });

  // ---- dark scheme -----------------------------------------------------------------------------------------------
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#/');
  await expect(page.getByTestId('chapter-map')).toBeVisible();
  await snap(page, 'map-dark');
  await page.goto(`/#/level/${LEVELS[2]}`);
  await expect(page).toHaveURL(new RegExp(`/level/${LEVELS[2]}$`));
  await expect(vis(page, 'level-screen')).toBeVisible();
  await snap(page, 'level-dark');

  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});

// F-25: the shell around the screens. Runs after the chapter above (same player), in the same stack.
test('shell: palette, real routes, terminal help from the server, rain delay', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // The game's socket goes through this route so the test can cut it later, like a stopped stack would.
  const sockets: { close: () => Promise<void> }[] = [];
  let stackDown = false;
  await page.routeWebSocket(/\/ws(\?.*)?$/, (ws) => {
    if (stackDown) {
      void ws.close();
      return;
    }
    sockets.push(ws);
    ws.connectToServer();
  });

  await page.goto('/');
  await expect(page.getByTestId('chapter-map')).toBeVisible();
  await expect(page.getByTestId('conn-state')).toHaveText(/live/);

  // ---- command palette: open it, type a level title, Enter jumps there ------------------------------------------
  await page.keyboard.press('ControlOrMeta+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('say hello');
  await expect(palette.getByRole('option', { name: /Say hello/ })).toBeVisible();
  await snap(page, 'palette');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/level/${LEVELS[1]}$`));
  await expect(vis(page, 'level-screen')).toHaveAttribute('data-level', LEVELS[1]);

  // ---- a Redis command in the lesson goes to the terminal: the workbench opens its Terminal tab and the command
  // waits on the line, not run (the chip needs the server's command list, so this also proves the E-06 names).
  await openStage(page, 4);
  await vis(page, 'tab-editor').click();
  await expect(vis(page, 'terminal')).toHaveCount(0);
  const chip = vis(page, 'stage-4')
    .getByRole('button', { name: 'Send PING to the terminal' })
    .first();
  await chip.locator('..').hover();
  await chip.click();
  await expect(vis(page, 'tab-terminal')).toHaveAttribute('aria-selected', 'true');
  await expect(termText(page)).toContainText(/> PING\s*$/m);
  await expect(termText(page)).not.toContainText('PONG');

  // ---- a legacy hash URL lands on the real path, without a history entry for the hash -----------------------------
  await page.goto('/#/terminal');
  await expect(page).toHaveURL(/\/terminal$/);

  // ---- the terminal helps, from the running Redis's own command docs (E-06 endpoints, nothing intercepted) --------
  const health = (await (await page.request.get('/health')).json()) as { commandDocs?: boolean };
  expect(health.commandDocs, 'GET /health advertises the command-docs endpoints').toBe(true);
  const popup = vis(page, 'terminal-popup');
  await vis(page, 'terminal').first().click();
  await page.keyboard.type('ZA');
  await expect(popup).toBeVisible({ timeout: 15_000 });
  const zadd = popup.getByTestId('terminal-option').filter({ hasText: /zadd/i }).first();
  await expect(zadd).toBeVisible();
  // The summary is the server's own (COMMAND DOCS zadd), not text written into the game.
  await expect(zadd).toContainText('Adds one or more members to a sorted set');
  await snap(page, 'terminal-popup');
  await page.keyboard.press('Tab');
  await expect(popup).toBeHidden();
  await expect(termText(page)).toContainText(/zadd/i);
  const syntax = vis(page, 'terminal-syntax');
  await expect(syntax).toBeVisible();
  await expect(syntax).toContainText('key');
  await expect(syntax).toContainText('score');
  await expect(syntax).toContainText('member');
  // A fresh key per run, so a second run against the same stack still adds one member.
  await page.keyboard.type(`quest:e2e:z:${Date.now()} 1 a`);
  await snap(page, 'terminal-syntax');
  await page.keyboard.press('Enter');
  await expect(termText(page)).toContainText('(integer) 1');
  // Enter sends exactly what was typed, even while the popup offers something longer.
  await page.keyboard.type('PIN');
  await expect(
    popup.getByTestId('terminal-option').filter({ hasText: /ping/i }).first(),
  ).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(termText(page)).toContainText(/unknown command 'PIN'/i);
  await expect(termText(page)).not.toContainText('PONG');

  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);

  // ---- rain delay: the engine and its socket go away, the strip says how to bring them back ------------------------
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page.getByTestId('chapter-map')).toBeVisible();
  stackDown = true;
  await page.route(/\/(api\/|health$)/, (route) => route.abort());
  for (const s of sockets) await s.close();
  const rain = page.getByTestId('rain-delay');
  await expect(rain).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('rain-command')).toContainText('./scripts/start');
  await expect(page.getByTestId('conn-state')).toHaveText(/reconnecting/);
  await snap(page, 'rain-delay');
  // Navigation keeps working while it rains.
  await page.getByRole('link', { name: 'Metrics', exact: true }).click();
  await expect(page).toHaveURL(/\/metrics$/);
  await expect(rain).toBeVisible();
  // The stack comes back: "Play resumes", then the strip leaves on its own.
  stackDown = false;
  await page.unroute(/\/(api\/|health$)/);
  await expect(page.getByTestId('play-resumes')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('conn-state')).toHaveText(/live/);
  await expect(page.getByTestId('play-resumes')).toBeHidden({ timeout: 10_000 });
});
