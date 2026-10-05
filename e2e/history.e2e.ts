// Historia: the weeks, the exercise filter, the calendar, and a day opening its
// session. The numbers are the seed's (e2e/seed.ts): ten weeks of three
// sessions, bench in two of each, plus today's plan.
import { expect, test } from '@playwright/test';
import { openSeeded } from './seed.ts';

test('history lists the weeks, filters by exercise and opens a day from the calendar', async ({
  page,
}) => {
  await openSeeded(page);
  await page.getByRole('link', { name: /Historia/ }).click();
  await expect(page).toHaveURL(/#\/history$/);

  // Every session by week, with a marker on the one still holding pending sets.
  await expect(page.getByRole('heading', { name: /^Week of/ })).toHaveCount(11);
  const sessions = page.getByRole('listitem');
  await expect(sessions).toHaveCount(31);
  await expect(page.getByText('2 pending')).toBeVisible();

  // Filtered to one exercise, the rows speak of its best set and e1RM.
  await page.getByRole('button', { name: 'All exercises' }).click();
  const picker = page.getByRole('dialog', { name: 'Filter by exercise' });
  await picker.getByRole('searchbox', { name: 'Search exercises' }).fill('bench');
  await picker.getByRole('button', { name: /^Bench Press/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByRole('button', { name: 'Clear Bench Press' })).toBeVisible();
  await expect(sessions).toHaveCount(21);
  await expect(page.getByText(/^e1RM \d/).first()).toBeVisible();

  // The calendar keeps the filter; clearing it shows every session again.
  await page.getByRole('button', { name: 'Calendar' }).click();
  const calendar = page.getByRole('region', { name: 'Calendar' });
  await expect(calendar).toBeVisible();
  await page.getByRole('button', { name: 'Clear Bench Press' }).click();
  await expect(page.getByRole('button', { name: 'All exercises' })).toBeVisible();

  // Today holds the plan (a ring, not a disc); a day with a session opens it.
  await expect(calendar.getByRole('button', { name: /, 1 planned, today$/ })).toBeVisible();
  const previous = calendar.getByRole('button', { name: 'Previous month' });
  const day = calendar.getByRole('button', { name: /, 1 session/ }).first();
  if ((await day.count()) === 0) await previous.click();
  await day.click();
  await expect(page).toHaveURL(/#\/session\//);
  await expect(page.getByRole('button', { name: 'Do this again' })).toBeVisible();

  // Back lands on History, in the view the lifter left.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/#\/history$/);
  await expect(page.getByRole('region', { name: 'Calendar' })).toBeVisible();
});
