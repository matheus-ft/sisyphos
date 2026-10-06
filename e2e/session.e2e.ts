// One session from the plan on Train to Done: every way of saving a set, the
// rest it starts, and the finish screen.
import { expect, test } from '@playwright/test';
import { openSeeded } from './seed.ts';

test('a planned session runs from Start to Done', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSeeded(page);

  // Train shows today's plan, from the template, with its one primary button.
  const plan = page.getByRole('article').filter({ hasText: 'Rebuild' });
  await expect(plan).toContainText('Low-Bar Squat');
  await expect(plan).toContainText('Bench Press');
  await plan.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page).toHaveURL(/#\/session\/[^/]+$/);
  await expect(page.getByRole('group', { name: /^0 of 10 sets done/ })).toBeVisible();

  // The entry panel: load and reps, then one tap on an RPE saves the set.
  const panel = page.getByRole('dialog', { name: 'Low-Bar Squat, Set 1' });
  await page.getByRole('button', { name: 'Enter set 1' }).click();
  await panel.getByRole('textbox', { name: 'Load' }).fill('100');
  await panel.getByRole('textbox', { name: 'Reps' }).fill('5');
  await panel.getByRole('button', { name: /^8(,|$)/ }).click();

  // The undo toast names the set; undoing puts it back to pending and ends the rest.
  const toast = page.getByRole('status');
  await expect(toast).toContainText('Set 1 saved');
  await expect(toast).toContainText('100 × 5 @ 8');
  const rest = page.getByRole('dialog', { name: 'Rest' });
  await expect(rest).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(rest).toBeHidden();
  await expect(page.getByRole('group', { name: /^0 of 10 sets done/ })).toBeVisible();

  // Saved again, the rest takes over with a countdown to the exercise's target.
  await page.getByRole('button', { name: 'Enter set 1' }).click();
  await panel.getByRole('textbox', { name: 'Load' }).fill('100');
  await panel.getByRole('textbox', { name: 'Reps' }).fill('5');
  await panel.getByRole('button', { name: /^8(,|$)/ }).click();
  await expect(rest).toBeVisible();
  await expect(rest.getByRole('timer')).toBeVisible();
  await expect(rest).toContainText('of 3:00');
  await rest.getByRole('button', { name: '+15 s' }).click();
  await expect(rest).toContainText('of 3:15');

  // Log the next set from the rest: the panel opens on it.
  await rest.getByRole('button', { name: 'Log set 2' }).click();
  await expect(rest).toBeHidden();
  const second = page.getByRole('dialog', { name: 'Low-Bar Squat, Set 2' });
  await expect(second).toBeVisible();
  await second.getByRole('textbox', { name: 'Load' }).fill('100');
  await second.getByRole('textbox', { name: 'Reps' }).fill('5');
  await second.getByRole('button', { name: /^8(,|$)/ }).click();
  await expect(rest).toBeVisible();
  await expect(rest).toContainText('of 3:15');
  await rest.getByRole('button', { name: 'Skip rest' }).click();
  await expect(rest).toBeHidden();

  // The third set typed into its row instead: the RPE is what completes it.
  // Tapping a field takes its target, selected, so typing replaces it; wait for
  // that before typing, as a lifter's thumb does.
  const load = page.getByRole('textbox', { name: 'Load', exact: true }).nth(2);
  await load.focus();
  await expect(load).toHaveValue(/\d/);
  await load.fill('100');
  const reps = page.getByRole('textbox', { name: 'Reps', exact: true }).nth(2);
  await reps.focus();
  await expect(reps).toHaveValue('5');
  await reps.fill('6');
  const rpe = page.getByRole('textbox', { name: 'RPE', exact: true }).nth(2);
  await rpe.fill('8');
  await rpe.blur();
  await expect(rest).toBeVisible();
  await rest.getByRole('button', { name: 'Skip rest' }).click();
  await expect(page.getByRole('group', { name: /^3 of 10 sets done/ })).toBeVisible();

  // Finish: the boulder arrives, with the session's numbers.
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/#\/session\/[^/]+\/finish$/);
  await expect(page.getByRole('heading', { name: 'The boulder is at the top.' })).toBeVisible();
  await expect(page.getByText('One must imagine Sisyphos happy.')).toBeVisible();
  const stats = page.getByRole('term').filter({ hasText: /^SETS$/i });
  await expect(stats).toBeVisible();
  await expect(page.getByText(/^1.?600$/)).toBeVisible();
  await expect(page.getByText('100 × 6 @ 8')).toBeVisible();

  // Done returns to Train, with nothing left running.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/#\/train$/);
  await expect(page.getByRole('button', { name: 'Start an empty session' })).toBeVisible();

  expect(errors).toEqual([]);
});
