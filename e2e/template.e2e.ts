// Building a template: the program label a session copies, a rep range, a
// percentage that resolves against the reference max, and a session planned
// from it.
import { expect, test } from '@playwright/test';
import { openSeeded, savedTemplates } from './seed.ts';

test('a template is edited and a session planned from it', async ({ page }) => {
  await openSeeded(page);
  await page.getByRole('button', { name: /^Squat and bench/ }).click();
  await expect(page).toHaveURL(/#\/template\//);

  // The program label, and how it will read everywhere else.
  const label = page.getByRole('region', { name: 'Program label' });
  await expect(label).toContainText('Rebuild · block 2 · week 6 · day 1 · Mon');
  // A field saves when it loses focus, as a thumb moving on makes it.
  const program = label.getByRole('textbox', { name: 'Program' });
  await program.fill('Offseason');
  await program.blur();
  const week = label.getByRole('textbox', { name: 'Week' });
  await week.fill('7');
  await week.blur();
  await label.getByLabel('Weekday').selectOption({ label: 'Wednesday' });
  await expect(label).toContainText('Offseason · block 2 · week 7 · day 1 · Wed');

  // A rep range on the squat's first set, then that set as a percentage of the
  // squat max (150 kg from the seed, so 80% is 120 kg).
  const squat = page.getByRole('region', { name: 'Low-Bar Squat' });
  const reps = squat.getByRole('textbox', { name: 'Reps' }).first();
  await reps.fill('3-5');
  await reps.blur();
  await expect(reps).toHaveValue('3–5');

  await squat.getByRole('button', { name: '% of max' }).first().click();
  const percent = squat.getByRole('textbox', { name: '% of max' }).first();
  await percent.fill('80');
  await percent.blur();
  await expect(squat.getByText(/80% of 150/)).toContainText('120 kg');

  // What was typed was saved as it went.
  await expect
    .poll(async () => {
      const [template] = await savedTemplates(page);
      return [template.label.week, template.exercises[0].prescribed[0].reps];
    })
    .toEqual([7, [3, 5]]);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Program label' })).toContainText(
    'Offseason · block 2 · week 7 · day 1 · Wed',
  );
  await expect(
    page
      .getByRole('region', { name: 'Low-Bar Squat' })
      .getByRole('textbox', { name: 'Reps' })
      .first(),
  ).toHaveValue('3–5');

  // Planning from it: the plan carries the label and the resolved load.
  await page.getByRole('button', { name: 'Plan one from it' }).click();
  await expect(page).toHaveURL(/#\/session\//);
  await expect(page.getByText('Planned', { exact: true })).toBeVisible();
  await expect(page.getByText('Offseason · block 2 · week 7 · day 1 · Wed')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Low-Bar Squat' })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Low-Bar Squat' })
      .getByRole('textbox', { name: 'Load' })
      .first(),
  ).toHaveAttribute('placeholder', '120');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
});
