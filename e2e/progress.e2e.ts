// Athloi: the statue, the hill, the labours. The seed (e2e/seed.ts) has ten
// weeks of sessions and none yet this week, which the Body test leans on.
import { expect, test, type Page } from '@playwright/test';
import { openSeeded } from './seed.ts';

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
  await page.getByRole('link', { name: /Athloi/ }).click();
});

/** The fill the browser paints on each muscle of the statue, front and back. */
const shades = (page: Page): Promise<string[]> =>
  page
    .getByRole('figure')
    .getByRole('button')
    .evaluateAll((muscles) =>
      muscles.map((muscle) => getComputedStyle(muscle.querySelector('path')!).fill),
    );

/** Picks the squat tab, rather than lean on which lift opens first. */
async function pickSquat(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Low-Bar Squat' }).click();
}

test('body shades the statue by working sets and opens a muscle', async ({ page }) => {
  await expect(page).toHaveURL(/#\/progress$/);
  await expect(page.getByRole('figure', { name: 'Front' })).toBeVisible();
  await expect(page.getByRole('figure', { name: 'Back' })).toBeVisible();

  // Nothing lifted this week yet, so Body opens on the last four weeks, whose
  // work gives the muscles different shades.
  await expect.poll(async () => new Set(await shades(page)).size).toBeGreaterThan(1);

  // This week alone is bare: every muscle is the untrained shade, and the table counts none.
  await page.getByRole('button', { name: 'This week' }).click();
  const table = page.getByRole('table');
  await expect
    .poll(async () => new Set(await table.getByRole('cell').allTextContents()))
    .toEqual(new Set(['0']));
  // The fills ease between shades, so wait for them to settle.
  await expect.poll(async () => new Set(await shades(page)).size).toBe(1);
  await page.getByRole('button', { name: 'Last 4 weeks' }).click();

  // The table lists the most worked first; one muscle opens the sets behind it.
  await table.getByRole('row').nth(1).getByRole('button').click();
  const sheet = page.getByRole('dialog', { name: /sets in the last 4 weeks$/ });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('list').getByRole('button').first().click();
  await expect(page).toHaveURL(/#\/session\//);
});

test('body counts muscles by the chosen preset, which the phone keeps', async ({ page }) => {
  const counting = page.getByRole('group', { name: 'Counting' });
  await expect(counting.getByRole('button', { name: 'Fractional' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(/auxiliary muscles count half/)).toBeVisible();

  // The table is always shown: it has no shade column, and its first row is the most worked muscle.
  const table = page.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText(['Muscle', 'Sets']);
  const total = async (): Promise<number> =>
    (await table.getByRole('cell').allTextContents()).reduce((n, text) => n + Number(text), 0);
  const fractional = await total();

  await counting.getByRole('button', { name: 'Direct' }).click();
  await expect(counting.getByRole('button', { name: 'Direct' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(/only the muscles a lift is for count/)).toBeVisible();
  await expect.poll(total).toBeLessThan(fractional);

  await counting.getByRole('button', { name: '1:1' }).click();
  await expect(page.getByText(/auxiliary muscles count in full/)).toBeVisible();
  await expect.poll(total).toBeGreaterThan(fractional);

  // A preference of this phone: it is still chosen after the app is opened again.
  await page.reload();
  await expect(
    page.getByRole('group', { name: 'Counting' }).getByRole('button', { name: '1:1' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('strength has a tab for each of the four lifts, and an empty one says so', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Strength' }).click();

  const lifts = page.getByRole('tablist', { name: 'Lift' });
  await expect(lifts.getByRole('tab')).toHaveText(['Squat', 'Bench', 'Sumo', 'Conv.']);
  for (const tab of await lifts.getByRole('tab').all()) {
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  // Squat, bench and deadlift are seeded; the sumo deadlift is not.
  await lifts.getByRole('tab', { name: 'Sumo Deadlift' }).click();
  await expect(lifts.getByRole('tab', { name: 'Sumo Deadlift' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('Not enough sessions yet')).toBeVisible();
  await expect(page.getByRole('slider')).toBeHidden();

  // Arrow keys move along the tabs and choose, wrapping at the ends.
  await page.keyboard.press('ArrowRight');
  await expect(lifts.getByRole('tab', { name: 'Conventional Deadlift' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('slider', { name: /^Conventional Deadlift, e1RM/ })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(lifts.getByRole('tab', { name: 'Low-Bar Squat' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Only the four are offered: no sheet of every exercise.
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('strength draws the hill, with every set over it, and picks a day at a time', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Strength' }).click();
  await expect(page).toHaveURL(/#\/progress\/strength$/);

  await pickSquat(page);
  const chart = page.getByRole('slider', { name: /^Low-Bar Squat, e1RM/ });
  await expect(chart).toBeVisible();
  // Each set is a point, so there are more of them than days.
  const days = Number(await chart.getAttribute('aria-valuemax'));
  const summary = (await chart.getAttribute('aria-label'))!;
  const sets = Number(/(\d+) sets/.exec(summary)![1]);
  expect(summary).toContain(`${days} days`);
  expect(days).toBeGreaterThan(5);
  expect(sets).toBeGreaterThan(days);
  await expect(page.getByText('best e1RM', { exact: true })).toBeVisible();
  await expect(page.getByText('sets (e1RM)', { exact: true })).toBeVisible();
  await expect(page.getByText('single', { exact: true })).toBeVisible();
  // Every set is a faint dot, however many there are, and with no day picked none is dimmed.
  const dots = chart.locator('circle.scatter');
  await expect(dots).toHaveCount(sets);
  await expect(chart.locator('circle.scatter.day, circle.scatter.away')).toHaveCount(0);
  await expect(chart.locator('circle.ring')).toHaveCount(0);

  // A touch on the hill picks the nearest day, whatever the height it lands at: the
  // readout leads with the day's best and the set it came from, and ends on the date.
  await expect(chart).toHaveAttribute('aria-valuenow', String(days));
  await chart.tap({ position: { x: 20, y: 60 } });
  await expect(chart).not.toHaveAttribute('aria-valuenow', String(days));
  const tip = chart.locator('.tip');
  await expect(tip).toContainText(/^e1RM \d+\s+from\s+[\d.]+\s+×\s+\d+/);
  await expect(chart.locator('circle.ring')).toHaveCount(1);
  // The day's own sets are dimmed and every other day's are dimmer still.
  const own = await chart.locator('circle.scatter.day').count();
  expect(own).toBeGreaterThan(0);
  await expect(chart.locator('circle.scatter.away')).toHaveCount(sets - own);

  // The arrow keys step through the days, and read each out in a sentence.
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(chart).toHaveAttribute('aria-valuenow', '1');
  await expect(chart).toHaveAttribute('aria-valuetext', /e1RM \d+ from .*, \d+ sets?$/);
  await page.keyboard.press('ArrowRight');
  await expect(chart).toHaveAttribute('aria-valuenow', '2');
  await page.keyboard.press('End');
  await expect(chart).toHaveAttribute('aria-valuenow', String(days));
  await page.keyboard.press('Escape');
  await expect(chart.locator('circle.ring')).toHaveCount(0);

  // The range buttons switch; ten weeks of training fit in all of them.
  const ranges = page.getByRole('group', { name: 'Range' });
  await expect(ranges.getByRole('button', { name: '6M' })).toHaveAttribute('aria-pressed', 'true');
  await ranges.getByRole('button', { name: '3M' }).click();
  await expect(ranges.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true');
  await expect(ranges.getByRole('button', { name: '6M' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('slider', { name: /^Low-Bar Squat, e1RM/ })).toHaveAttribute(
    'aria-valuemax',
    String(days),
  );
  await ranges.getByRole('button', { name: 'All', exact: true }).click();
  await expect(chart).toBeVisible();

  // The same numbers as a table, day first: a row for the day's best, then a row for
  // each of its sets.
  await page.getByRole('button', { name: 'Show as table' }).click();
  const table = page.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(days + sets + 1);
  await expect(table.getByRole('columnheader')).toHaveText(['Day', 'e1RM', 'Set', 'Kind']);
  await expect(table.locator('tbody')).toHaveCount(days);
  await expect(table.getByRole('cell', { name: 'Estimate' }).first()).toBeVisible();
  await expect(table.locator('tr.day').first().getByRole('cell').nth(1)).toHaveText(/× \d+/);
});

test('labours lists the best weight at each rep count', async ({ page }) => {
  await page.getByRole('button', { name: 'Labours' }).click();
  await expect(page).toHaveURL(/#\/progress\/labours$/);

  await pickSquat(page);
  await expect(page.getByRole('tab', { name: 'Low-Bar Squat' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // One row for each of 1 to 10 reps; the ones never lifted say so.
  await expect(page.getByRole('group', { name: /^10 reps/ })).toBeVisible();
  await expect(page.getByRole('group', { name: /^9 reps, no record yet/ })).toBeVisible();

  // The single is the hand-entered one, edited under Records; the five is from a session.
  const single = page.getByRole('link', { name: /^1 rep, 155 kilograms, .*by hand/ });
  const five = page.getByRole('button', { name: /^5 reps, 142\.5 kilograms, .*Open the session$/ });
  await expect(five).toBeVisible();
  await single.click();
  await expect(page).toHaveURL(/#\/more\/records$/);
  // The pick is not remembered across a visit elsewhere.
  await page.goBack();
  await pickSquat(page);
  await five.click();
  await expect(page).toHaveURL(/#\/session\//);
});

test('labours has the same four tabs, and the pick carries over from strength', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Strength' }).click();
  await page.getByRole('tab', { name: 'Bench Press' }).click();
  await page.getByRole('button', { name: 'Labours' }).click();

  const lifts = page.getByRole('tablist', { name: 'Lift' });
  await expect(lifts.getByRole('tab')).toHaveText(['Squat', 'Bench', 'Sumo', 'Conv.']);
  await expect(lifts.getByRole('tab', { name: 'Bench Press' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('group', { name: /^10 reps/ })).toBeVisible();

  // A lift with no record shows the empty state under its tab.
  await lifts.getByRole('tab', { name: 'Sumo Deadlift' }).click();
  await expect(page.getByText('No records yet')).toBeVisible();
  await expect(page.getByRole('group', { name: /^10 reps/ })).toBeHidden();
});
