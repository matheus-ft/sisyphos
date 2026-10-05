// A phone app gets reloaded between sets: the session, its sets and the rest
// that is running all have to come back.
import { expect, test } from '@playwright/test';
import { openSeeded } from './seed';

test('a reload mid-session keeps the session open and the rest running', async ({ page }) => {
  await openSeeded(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await page.getByRole('button', { name: 'Enter set 1' }).click();
  const panel = page.getByRole('dialog', { name: 'Low-Bar Squat, Set 1' });
  await panel.getByRole('textbox', { name: 'Load' }).fill('100');
  await panel.getByRole('textbox', { name: 'Reps' }).fill('5');
  await panel.getByRole('button', { name: /^8(,|$)/ }).click();
  await expect(page.getByRole('dialog', { name: 'Rest' })).toBeVisible();
  const session = new URL(page.url()).hash;

  await page.reload();

  // The same session, with its set, and the rest counting on behind the header.
  await expect(page).toHaveURL(new RegExp(`${session}$`));
  await expect(page.getByRole('button', { name: 'Edit set 1' })).toBeVisible();
  const readout = page.getByRole('button', { name: /^Rest, .* of 3:00\. Open the rest timer/ });
  await expect(readout).toBeVisible();
  await readout.click();
  const rest = page.getByRole('dialog', { name: 'Rest' });
  await expect(rest).toContainText('of 3:00');
  await expect(rest.getByRole('timer')).toHaveAccessibleName(/left$/);
  await rest.getByRole('button', { name: 'Back to the log' }).click();
  await expect(readout).toBeVisible();

  // Leaving for Train and relaunching there reopens the running session.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/#\/train$/);
  await expect(page.getByRole('article', { name: 'Session in progress' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${session}$`));
  await expect(page.getByRole('button', { name: /^Rest, .* of 3:00\./ })).toBeVisible();
});
