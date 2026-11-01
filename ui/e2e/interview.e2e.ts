import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// F-12: interview mode. Run by scripts/check/F-12.sh against project quest-p10, whose levels directory holds
// only levels/_examples/example-code and example-interview. The guided levels are passed through the dev
// shortcut (ENGINE_DEV=1) so the interview level is unlocked and the player has XP to spend.

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(here, 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const GUIDED = ['example-code-01-cache-aside', 'example-code-02-token-bucket'] as const;
const IV = 'example-interview-01-cache-aside-rebuild';
const REFERENCE = `const TTL_SECONDS = 30;
export default async function getPlayerStats({ redis, db }, playerId) {
  const key = \`cache:player:\${playerId}\`;
  const cached = await redis.hGetAll(key);
  if (Object.keys(cached).length > 0) return cached;
  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  const row = rows[0];
  if (!row) return null;
  const fields = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)]));
  await redis.multi().hSet(key, fields).expire(key, TTL_SECONDS).exec();
  return fields;
}
`;

async function xpNow(page: Page): Promise<number> {
  const p = (await (await page.request.get('/api/progress')).json()) as { xp: number };
  return p.xp;
}

async function openStage(page: Page, n: number): Promise<void> {
  const head = page.getByTestId(`stage-${n}`).getByRole('button').first();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
}

test('interview level: countdown, no teaching, a hint that costs XP, rebuilt in m:ss', async ({
  page,
  request,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/');
  await page.getByTestId('player-name').fill('Rhea Interview');
  await page.getByTestId('player-submit').click();
  await expect(page.getByTestId('chapter-map')).toBeVisible();
  await expect(page.getByTestId('chapter-example-interview')).toBeVisible();

  for (const id of GUIDED) {
    expect((await request.post(`/api/levels/${id}/start`, { data: {} })).status()).toBe(200);
    expect((await request.post(`/api/levels/${id}/complete`, { data: {} })).status()).toBe(200);
  }
  const xpStart = await xpNow(page);
  expect(xpStart).toBeGreaterThan(20);

  // ---- open the interview level: the clock starts, the teaching is gone ---------------------------------------
  await page.goto(`/#/level/${IV}`);
  await expect(page.getByTestId('level-screen')).toHaveAttribute('data-level', IV);
  await expect(page.getByTestId('level-status')).toHaveText(/in progress/);
  const countdown = page.getByTestId('countdown');
  await expect(countdown).toBeVisible();
  await expect(countdown).toHaveAttribute('data-state', 'running');
  await expect(countdown).toHaveText(/\d+:\d\d left/);
  await expect(page.getByTestId('interview-pill')).toContainText('10 min');
  // The first load is within a second or two of the start, so most of the ten minutes is left.
  const first = (await countdown.textContent()) ?? '';
  const [mm = '0', ss = '0'] = (/(\d+):(\d\d) left/.exec(first) ?? []).slice(1);
  expect(Number(mm) * 60 + Number(ss)).toBeGreaterThan(9 * 60);
  expect(Number(mm) * 60 + Number(ss)).toBeLessThanOrEqual(10 * 60);
  // ...and it ticks.
  await expect.poll(async () => await countdown.textContent(), { timeout: 8000 }).not.toBe(first);
  await page.screenshot({ path: join(SHOTS, 'F-12-countdown.png'), fullPage: true });

  const lv = (await (await request.get(`/api/levels/${IV}`)).json()) as {
    teach: string;
    interview: { minutes: number; hintXpCost: number; startedAt: string | null };
    remainingMs: number;
  };
  expect(lv.teach).toBe('');
  expect(lv.interview).toMatchObject({ minutes: 10, hintXpCost: 10 });
  expect(lv.interview.startedAt).toEqual(expect.any(String));
  expect(lv.remainingMs).toBeGreaterThan(0);

  await openStage(page, 4);
  await expect(page.getByTestId('no-teaching')).toHaveText(
    'No teaching here: this is the interview.',
  );
  await expect(page.getByTestId('stage-4').locator('.codeblock, a[href^="https://"]')).toHaveCount(
    0,
  );

  // ---- a hint costs XP, and asks first ---------------------------------------------------------------------------
  await openStage(page, 5);
  const hintButton = page.getByTestId('hint-button');
  await expect(hintButton).toContainText('costs 10 XP');
  await hintButton.click();
  const prompt = page.getByTestId('hint-confirm');
  await expect(prompt).toBeVisible();
  await expect(page.getByTestId('hint-confirm-text')).toContainText(
    `This hint costs 10 XP. You have ${xpStart} XP, so you would keep ${xpStart - 10}.`,
  );
  await expect(page.getByTestId('hint-confirm-no')).toBeFocused();
  await prompt.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'F-12-hint-cost-prompt.png'), fullPage: true });

  // Declining costs nothing and shows nothing.
  await page.getByTestId('hint-confirm-no').click();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByTestId('hint-0')).toHaveCount(0);
  expect(await xpNow(page)).toBe(xpStart);

  // Accepting shows the hint and drops XP by exactly the cost, in the engine and on the page.
  await hintButton.click();
  await page.getByTestId('hint-confirm-yes').click();
  await expect(page.getByTestId('hint-0')).toBeVisible();
  await expect.poll(() => xpNow(page)).toBe(xpStart - 10);
  await expect(
    page.locator('strong', { hasText: new RegExp(`^${xpStart - 10} XP$`) }),
  ).toBeVisible();
  await expect(page.getByTestId('hints-bought')).toHaveText('Hints bought: 1');
  const afterHint = (await (await request.get('/api/progress')).json()) as {
    levels: Record<string, { hintsBought?: number; interviewStartedAt?: string }>;
  };
  expect(afterHint.levels[IV]?.hintsBought).toBe(1);

  // ---- rebuild it, verify, and read "rebuilt in m:ss" -------------------------------------------------------------
  const put = await request.put('/api/workspace/file?path=ch2/cache.js', {
    data: { content: REFERENCE },
  });
  expect(put.status()).toBe(200);
  await openStage(page, 6);
  await page.getByTestId('verify-button').click();
  await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'right');
  await expect(page.getByTestId('level-screen')).toHaveAttribute('data-status', 'passed');
  await expect(page.getByTestId('rebuilt-in')).toHaveText(/^Rebuilt in \d+:\d\d\.$/);
  await expect(page.getByTestId('rebuilt-in')).not.toContainText('over the');
  await expect(page.getByTestId('countdown')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('countdown')).toHaveText(/Rebuilt in \d+:\d\d$/);
  await expect(page.getByTestId('overtime-note')).toHaveCount(0);
  await page.screenshot({ path: join(SHOTS, 'F-12-rebuilt.png'), fullPage: true });

  // The ideal-way beat points at the guided level's solutions.
  await openStage(page, 7);
  await expect(page.getByTestId('ideal-rebuild-link').first()).toBeVisible();
  await expect(page.getByTestId('ideal-rebuild-link').first().getByRole('link')).toHaveAttribute(
    'href',
    `#/level/${GUIDED[0]}`,
  );

  // "What you built" repeats the time.
  await page.goto('/#/built');
  await expect(page.getByTestId(`built-rebuilt-${IV}`)).toHaveText(/^Rebuilt in \d+:\d\d\.$/);

  const done = (await (await request.get(`/api/levels/${IV}`)).json()) as {
    interview: { elapsedMs: number; overtime: boolean };
    remainingMs: number;
  };
  expect(done.interview.overtime).toBe(false);
  expect(done.interview.elapsedMs).toBeGreaterThan(0);
  expect(done.interview.elapsedMs).toBeLessThan(10 * 60_000);
  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
