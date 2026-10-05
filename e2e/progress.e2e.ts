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

/** Picks the squat from the lift picker, rather than lean on which lift opens first. */
async function pickSquat(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /^(Low-Bar Squat|Bench Press|Conventional Deadlift)/ })
    .first()
    .click();
  await page
    .getByRole('dialog', { name: 'Choose an exercise' })
    .getByRole('button', { name: /^Low-Bar Squat/ })
    .click();
}

test('body shades the statue by working sets and opens a muscle', async ({ page }) => {
  await expect(page).toHaveURL(/#\/progress$/);
  await expect(page.getByRole('figure', { name: 'Front' })).toBeVisible();
  await expect(page.getByRole('figure', { name: 'Back' })).toBeVisible();

  // Nothing lifted this week: every muscle is the untrained shade.
  await expect(page.getByText('No working sets this week yet.')).toBeVisible();
  expect(new Set(await shades(page)).size).toBe(1);

  // The last four weeks have work, so muscles take different shades.
  await page.getByRole('button', { name: 'Last 4 weeks' }).click();
  await expect(page.getByText('No working sets this week yet.')).toBeHidden();
  await expect.poll(async () => new Set(await shades(page)).size).toBeGreaterThan(1);

  // The list beneath names the most worked; one opens the sets behind it.
  const muscle = page.getByRole('button', { name: /sets in the last 4 weeks\. Show the sets$/ });
  await muscle.first().click();
  const sheet = page.getByRole('dialog', { name: /sets in the last 4 weeks$/ });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('list').getByRole('button').first().click();
  await expect(page).toHaveURL(/#\/session\//);
});

test('strength draws the hill and switches range', async ({ page }) => {
  await page.getByRole('button', { name: 'Strength' }).click();
  await expect(page).toHaveURL(/#\/progress\/strength$/);

  await pickSquat(page);
  const chart = page.getByRole('slider', { name: /^Low-Bar Squat, e1RM/ });
  await expect(chart).toBeVisible();
  const days = Number(await chart.getAttribute('aria-valuemax'));
  expect(days).toBeGreaterThan(5);

  // A touch on the hill moves the crosshair off the latest day.
  await expect(chart).toHaveAttribute('aria-valuenow', String(days));
  await chart.tap({ position: { x: 20, y: 60 } });
  await expect(chart).not.toHaveAttribute('aria-valuenow', String(days));

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

  // The same numbers as a table.
  await page.getByRole('button', { name: 'Show as table' }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(days + 1);
});

test('labours lists the best weight at each rep count', async ({ page }) => {
  await page.getByRole('button', { name: 'Labours' }).click();
  await expect(page).toHaveURL(/#\/progress\/labours$/);

  await pickSquat(page);

  // One row for each of 1 to 10 reps; the ones never lifted say so.
  await expect(page.getByRole('group', { name: /^10 reps/ })).toBeVisible();
  await expect(page.getByRole('group', { name: /^9 reps, no record yet/ })).toBeVisible();

  // The single is the hand-entered one, edited under Agora; the five is from a session.
  const single = page.getByRole('button', { name: /^1 rep, 155 kilograms, .*by hand/ });
  const five = page.getByRole('button', { name: /^5 reps, 142\.5 kilograms, .*Open the session$/ });
  await expect(five).toBeVisible();
  await single.click();
  await expect(page).toHaveURL(/#\/more\/lifter$/);
  // The pick is not remembered across a visit elsewhere.
  await page.goBack();
  await pickSquat(page);
  await five.click();
  await expect(page).toHaveURL(/#\/session\//);
});
