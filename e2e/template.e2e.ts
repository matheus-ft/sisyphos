// Building a template: the program label a session copies, a rep range, a
// percentage that resolves against the reference max, and a session planned
// from it; the templates in folders by program; and planning ahead from the
// calendar.
import { expect, test } from '@playwright/test';
import { dayFromToday, openSeeded, pickCalendarDay, savedTemplates } from './seed.ts';

test('a template is edited and a session planned from it', async ({ page }) => {
  await openSeeded(page);
  await page.getByRole('button', { name: /^Squat and bench/ }).click();
  await expect(page).toHaveURL(/#\/template\//);

  // Starting and planning are at the top, under the name; deleting is at the bottom.
  const label = page.getByRole('region', { name: 'Program label' });
  const labelTop = (await label.boundingBox())!.y;
  for (const name of ['Start a session from it', 'Plan one from it']) {
    expect((await page.getByRole('button', { name }).boundingBox())!.y).toBeLessThan(labelTop);
  }
  expect(
    (await page.getByRole('button', { name: 'Delete template' }).boundingBox())!.y,
  ).toBeGreaterThan(labelTop);

  // The program label, and how it will read everywhere else.
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

  // Each exercise is a line of what it asks for, closed until tapped.
  const squat = page.getByRole('region', { name: 'Low-Bar Squat' });
  const squatLine = squat.getByRole('button', { name: /^Low-Bar Squat/ });
  await expect(squatLine).toHaveText('Low-Bar Squat · 3×5 @7–8 · 3:00');
  await expect(page.getByRole('button', { name: /^Bench Press/ })).toHaveText(
    'Bench Press · 4×3–5 @8 · 3:00',
  );
  await expect(page.getByRole('textbox', { name: 'Reps' })).toHaveCount(0);
  await squatLine.click();
  await expect(squatLine).toHaveAttribute('aria-expanded', 'true');

  // A rep range on the squat's first set, then that set as a percentage of the
  // squat max (150 kg from the seed, so 80% is 120 kg).
  const reps = squat.getByRole('textbox', { name: 'Reps' }).first();
  await reps.fill('3-5');
  await reps.blur();
  await expect(reps).toHaveValue('3–5');
  await expect(squatLine).toHaveText('Low-Bar Squat · 3 sets @7–8 · 3:00');

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

  // One is open at a time: opening the bench closes the squat.
  const bench = page.getByRole('region', { name: 'Bench Press' });
  await bench.getByRole('button', { name: /^Bench Press/ }).click();
  await expect(bench.getByRole('textbox', { name: 'Reps' }).first()).toBeVisible();
  await expect(squat.getByRole('textbox', { name: 'Reps' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('region', { name: 'Program label' })).toContainText(
    'Offseason · block 2 · week 7 · day 1 · Wed',
  );
  await page
    .getByRole('region', { name: 'Low-Bar Squat' })
    .getByRole('button', { name: /^Low-Bar Squat/ })
    .click();
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

test('closed exercises are reordered, and the open one is followed', async ({ page }) => {
  await openSeeded(page);
  await page.getByRole('button', { name: /^Squat and bench/ }).click();
  const order = async () =>
    (await savedTemplates(page))[0].exercises.map((e) => e.exercise_id).join(' ');

  // Moving a closed exercise needs no opening.
  await page.getByRole('button', { name: 'Move Bench Press up' }).click();
  await expect.poll(order).toBe('bench low_bar_squat romanian_deadlift');

  // Moving the open one carries its editor with it.
  const squat = page.getByRole('region', { name: 'Low-Bar Squat' });
  await squat.getByRole('button', { name: /^Low-Bar Squat/ }).click();
  await squat.getByRole('button', { name: 'Move Low-Bar Squat down' }).click();
  await expect.poll(order).toBe('bench romanian_deadlift low_bar_squat');
  await expect(squat.getByRole('textbox', { name: 'Reps' }).first()).toBeVisible();
  await expect(squat.getByRole('button', { name: 'Move Low-Bar Squat down' })).toBeHidden();
});

test('templates sit in folders by program, which fold', async ({ page }) => {
  await openSeeded(page);
  // The seed's one template is of the program Rebuild, block 2.
  // (Today's plan, from the same template, is a button that starts with the label too.)
  const folder = page.getByRole('button', { name: 'Rebuild 1', exact: true });
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Block 2', { exact: true })).toBeVisible();
  const row = page.getByRole('button', { name: /^Squat and bench/ });
  await expect(row).toBeVisible();

  await folder.click();
  await expect(folder).toHaveAttribute('aria-expanded', 'false');
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ New template' })).toBeVisible();

  // Agora's list is the same folders, and what was folded stays folded.
  await page.goto('/#/more/templates');
  await expect(page.getByRole('button', { name: 'Rebuild 1', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: 'Rebuild 1', exact: true }).click();
  await page.getByRole('button', { name: /^Squat and bench/ }).click();
  await expect(page).toHaveURL(/#\/template\//);

  // A template with no program is under "No program", after the others.
  await page.getByRole('textbox', { name: 'Program' }).fill('');
  await page.getByRole('textbox', { name: 'Program' }).blur();
  await expect.poll(async () => (await savedTemplates(page))[0].label.name).toBeNull();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: /^Squat and bench/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rebuild 1', exact: true })).toHaveCount(0);
});

test('a session planned ahead from Train starts fresh or from a template', async ({ page }) => {
  await openSeeded(page);
  const day = dayFromToday(3);
  const calendar = page.getByRole('dialog', { name: 'Pick a day to plan' });
  const choice = page.getByRole('dialog', { name: /^Plan / });

  // The day first, from the calendar: nothing before today, today ringed and
  // marked as planned; then what the plan starts from.
  await page.getByRole('button', { name: /^Plan one ahead/ }).click();
  await expect(calendar.getByRole('button', { name: 'Previous month' })).toBeHidden();
  await expect(calendar.locator(`[data-date="${dayFromToday(0)}"]`)).toHaveAttribute(
    'aria-label',
    /1 planned, today$/,
  );
  await expect(calendar.getByRole('button', { name: 'Next month' })).toBeVisible();
  await pickCalendarDay(calendar, day, 'Next month');
  await expect(choice.getByRole('button', { name: /^Start fresh/ })).toBeVisible();
  await choice.getByRole('button', { name: /^Squat and bench/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/session/${day}-`));
  await expect(page.getByText('Planned', { exact: true })).toBeVisible();
  await expect(page.getByText('Rebuild · block 2 · week 6 · day 1 · Mon')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Low-Bar Squat' })).toBeVisible();

  // Fresh is an empty plan on the day, which the calendar now shows as planned.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: /^Plan one ahead/ }).click();
  await expect(calendar.locator(`[data-date="${day}"]`)).toHaveAttribute('aria-label', /1 planned/);
  await pickCalendarDay(calendar, day, 'Next month');
  await choice.getByRole('button', { name: /^Start fresh/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/session/${day}-`));
  await expect(page.getByText('Planned', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Low-Bar Squat' })).toHaveCount(0);
});
