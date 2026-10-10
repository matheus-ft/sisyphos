// Agora: the lifter's own data, and the settings that belong to the device.
import { expect, test } from '@playwright/test';
import { dayFromToday, openSeeded, savedSettings } from './seed.ts';

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
  await page.getByRole('link', { name: /Agora/ }).click();
});

test('each of the lifter’s data has its own page, linked from the index', async ({ page }) => {
  for (const [name, route] of [
    [/^Bodyweight/, 'bodyweight'],
    [/^Reference maxes/, 'maxes'],
    [/^Meets/, 'meets'],
    [/^Records/, 'records'],
  ] as const) {
    await page.getByRole('link', { name }).click();
    await expect(page).toHaveURL(new RegExp(`#/more/${route}$`));
    // Back to the index: the page is a route, so back is back.
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page).toHaveURL(/#\/more$/);
  }
  // The one Lifter page is gone: its old address lands on the index.
  await page.goto('/#/more/lifter');
  await expect(page.getByRole('heading', { name: 'Agora' })).toBeVisible();
});

test('a weigh-in is added', async ({ page }) => {
  await page.getByRole('link', { name: /^Bodyweight/ }).click();
  await expect(page).toHaveURL(/#\/more\/bodyweight$/);

  const weighIns = page.getByRole('region', { name: 'Bodyweight' });
  await weighIns.getByRole('button', { name: 'Add weigh-in' }).click();
  await weighIns.getByRole('textbox', { name: 'Weight, kg' }).fill('82.6');
  await weighIns.getByRole('button', { name: 'Save weigh-in' }).click();
  await expect(page.getByRole('status')).toContainText('Weigh-in saved');
  await expect(page.getByRole('status')).toContainText('82.6 kg');
  await expect(weighIns.getByRole('listitem').first()).toContainText('82.6');

  // It is in the log, not only on screen.
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Bodyweight' }).getByRole('listitem').first(),
  ).toContainText('82.6');
});

test('Edit max opens on the max in force, today, and a suggestion fills the form', async ({
  page,
}) => {
  await page.getByRole('link', { name: /^Reference maxes/ }).click();
  await expect(page).toHaveURL(/#\/more\/maxes$/);

  // The seeded squat max is 150, set on the first of August.
  const squat = page.locator('.max').first();
  await expect(squat).toContainText('150');
  await squat.getByRole('button', { name: 'Edit max' }).click();
  await expect(page.getByRole('textbox', { name: 'Max, kg' })).toHaveValue('150');
  await expect(page.getByLabel('From')).toHaveValue(dayFromToday(0));
  await page.getByRole('button', { name: 'Cancel' }).click();

  // "Use" only fills the form with the recent best e1RM; saving is the lifter's.
  const use = page.getByRole('button', { name: /^Use \d/ }).first();
  const suggested = (await use.innerText()).replace('Use ', '');
  await use.click();
  const max = page.getByRole('textbox', { name: 'Max, kg' });
  await expect(max).toHaveValue(suggested);
  await page.getByRole('button', { name: /^Save \w+ max$/ }).click();
  await expect(page.getByRole('status')).toContainText(/max saved/);
  await expect(page.getByRole('status')).toContainText(`${suggested} kg`);
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  await expect(page.getByText(`set ${today}`)).toBeVisible();

  // Edit max now opens on the new one.
  await page.reload();
  await page.locator('.max').first().getByRole('button', { name: 'Edit max' }).click();
  await expect(page.getByRole('textbox', { name: 'Max, kg' })).toHaveValue(suggested);
});

test('a meet is entered, stands beside the reference max and in Labours, and is changed and deleted', async ({
  page,
}) => {
  await page.getByRole('link', { name: /^Meets/ }).click();
  await expect(page).toHaveURL(/#\/more\/meets$/);
  const meets = page.getByRole('region', { name: 'Meets' });
  await expect(page.getByText('No meets yet')).toBeVisible();

  await meets.getByRole('button', { name: 'Add a meet' }).click();
  await meets.getByRole('textbox', { name: 'Name' }).fill('Regionals');
  await meets.getByLabel('Date', { exact: true }).fill(dayFromToday(-20));
  await meets.getByRole('textbox', { name: 'Location' }).fill('Lisbon');
  await meets.getByRole('textbox', { name: 'Bodyweight, kg' }).fill('82.6');

  // A 3 x 3 grid: a row for each lift, with its exercise to choose.
  await expect(meets.getByRole('combobox', { name: 'Squat' })).toHaveValue('low_bar_squat');
  await expect(meets.getByRole('combobox', { name: 'Deadlift' })).toHaveValue(
    'conventional_deadlift',
  );
  // Only that lift's competition exercises are offered.
  expect(
    (
      await meets.getByRole('combobox', { name: 'Squat' }).locator('option').allTextContents()
    ).sort(),
  ).toEqual(['High-Bar Squat', 'Low-Bar Squat']);
  await meets.getByRole('combobox', { name: 'Deadlift' }).selectOption({ label: 'Sumo Deadlift' });
  const weight = (lift: string, n: number) =>
    meets.getByRole('textbox', { name: `${lift} attempt ${n}, kg` });
  const verdict = (lift: string, n: number) =>
    meets.getByRole('switch', { name: `${lift} attempt ${n} good` });

  await weight('Squat', 1).fill('200');
  await weight('Squat', 2).fill('210');
  await weight('Squat', 3).fill('207.5');
  await weight('Bench', 1).fill('130');
  await weight('Bench', 2).fill('137.5');
  await weight('Deadlift', 1).fill('240');
  await weight('Deadlift', 2).fill('250');
  // An attempt with no weight cannot be marked; one with a weight starts good.
  await expect(verdict('Bench', 3)).toBeDisabled();
  await expect(verdict('Squat', 2)).toHaveAttribute('aria-checked', 'true');
  await verdict('Squat', 2).click();
  await expect(verdict('Squat', 2)).toHaveAttribute('aria-checked', 'false');
  await expect(verdict('Squat', 2)).toHaveText('Missed');

  await meets.getByRole('button', { name: 'Add meet' }).click();
  await expect(page.getByRole('status')).toContainText('Meet added');
  // 207.5 + 137.5 + 250: the heaviest good attempt of each lift.
  const row = meets.getByRole('listitem').first();
  await expect(row).toContainText('Regionals');
  await expect(row).toContainText('Lisbon');
  await expect(row).toContainText('595 kg');
  await expect(meets.getByRole('table')).toContainText('207.5');

  // It is in the log, not only on screen.
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Meets' }).getByRole('listitem').first(),
  ).toContainText('595 kg');

  // Beside the reference max, apart from the best single in training.
  await page.getByRole('link', { name: 'Back' }).click();
  await page.getByRole('link', { name: /^Reference maxes/ }).click();
  const squat = page.locator('.max').first();
  await expect(squat).toContainText(/Best single\s*155/);
  await expect(squat).toContainText(/At a meet\s*207\.5/);

  // In Labours it stands above the table, and the one-rep record is still training's.
  await page.getByRole('link', { name: /Athloi/ }).click();
  await page.getByRole('button', { name: 'Labours' }).click();
  await page.getByRole('tab', { name: 'Low-Bar Squat' }).click();
  const atMeet = page.getByRole('link', { name: /^At a meet, 207\.5 kilograms/ });
  await expect(atMeet).toBeVisible();
  await expect(page.getByRole('link', { name: /^1 rep, 155 kilograms/ })).toBeVisible();
  await atMeet.click();
  await expect(page).toHaveURL(/#\/more\/meets$/);

  // Changed in the editor: the grid holds what was entered.
  await page.getByRole('button', { name: /^Regionals/ }).click();
  await expect(weight('Squat', 3)).toHaveValue('207.5');
  await expect(verdict('Squat', 2)).toHaveAttribute('aria-checked', 'false');
  await expect(meets.getByRole('combobox', { name: 'Deadlift' })).toHaveValue('sumo_deadlift');
  await meets.getByRole('textbox', { name: 'Placing' }).fill('2');
  await weight('Squat', 3).fill('212.5');
  await meets.getByRole('button', { name: 'Save meet' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Meet saved' })).toBeVisible();
  await expect(meets.getByRole('listitem').first()).toContainText('600 kg');

  // Said when it is wrong, and nothing is written.
  await page.getByRole('button', { name: /^Regionals/ }).click();
  await weight('Bench', 1).fill('heavy');
  await meets.getByRole('button', { name: 'Save meet' }).click();
  await expect(meets.getByRole('alert')).toContainText('Bench 1');
  await meets.getByRole('button', { name: 'Cancel' }).click();

  // Deleted once confirmed, and the deletion can be undone.
  await page.getByRole('button', { name: /^Regionals/ }).click();
  await meets.getByRole('button', { name: 'Delete meet' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete meet' }).click();
  const deleted = page.getByRole('status').filter({ hasText: 'Meet deleted' });
  await expect(deleted).toBeVisible();
  await expect(page.getByText('No meets yet')).toBeVisible();
  await deleted.getByRole('button', { name: 'Undo' }).click();
  await expect(meets.getByRole('listitem').first()).toContainText('Regionals');
});

test('records are a table of reps by lift: a cell edits its hand-entered value in place', async ({
  page,
}) => {
  await page.getByRole('link', { name: /^Records/ }).click();
  await expect(page).toHaveURL(/#\/more\/records$/);

  const table = page.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText([
    'Reps',
    'Squat',
    'Bench',
    'Sumo',
    'Conv.',
  ]);
  await expect(table.getByRole('rowheader')).toHaveText(
    Array.from({ length: 10 }, (_, i) => String(i + 1)),
  );

  // It fits the phone: nothing scrolls sideways.
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(fits).toBe(true);

  // The seeded single is entered by hand; the five is logged, and its date opens the session.
  const single = table.getByRole('button', { name: /^Low-Bar Squat, 1 rep, 155 kilograms/ });
  await expect(single).toHaveText('155');
  const five = table.getByRole('button', { name: /^Low-Bar Squat, 5 reps, 142\.5 kilograms/ });
  await expect(five).toHaveText('142.5');
  await expect(
    table.getByRole('link', { name: /^Low-Bar Squat, 5 reps: open the session/ }),
  ).toBeVisible();

  // A tap edits the hand-entered value: weight and date, in place.
  await single.click();
  const edit = table.getByRole('textbox', { name: 'Weight, kg' });
  await expect(edit).toHaveValue('155');
  await edit.fill('160');
  await table.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText('Record changed');
  await expect(
    table.getByRole('button', { name: /^Low-Bar Squat, 1 rep, 160 kilograms/ }),
  ).toHaveText('160');

  // It is in the log, and clearing it takes the cell back to nothing.
  await page.reload();
  await page
    .getByRole('table')
    .getByRole('button', { name: /^Low-Bar Squat, 1 rep, 160/ })
    .click();
  await page.getByRole('table').getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('status')).toContainText('Hand-entered record cleared');
  await expect(
    page.getByRole('table').getByRole('button', { name: /^Low-Bar Squat, 1 rep, no record/ }),
  ).toHaveText('–');

  // An empty cell takes a value.
  await page
    .getByRole('table')
    .getByRole('button', { name: /^Bench Press, 3 reps, no record/ })
    .click();
  await page.getByRole('table').getByRole('textbox', { name: 'Weight, kg' }).fill('110');
  await page.getByRole('table').getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('table').getByRole('button', { name: /^Bench Press, 3 reps, 110 kilograms/ }),
  ).toHaveText('110');

  // A logged value links to its session.
  await page
    .getByRole('table')
    .getByRole('link', { name: /^Low-Bar Squat, 5 reps: open the session/ })
    .click();
  await expect(page).toHaveURL(/#\/session\//);
});

test('the library starts a blank new exercise, and filters by variation', async ({ page }) => {
  await page.getByRole('link', { name: /^Library/ }).click();
  await expect(page).toHaveURL(/#\/more\/library$/);

  await page.getByRole('button', { name: '+ New exercise' }).click();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/#\/more\/library$/);

  await page.getByRole('button', { name: 'Tier', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Tier' })
    .getByRole('button', { name: 'Variation' })
    .click();
  const tiers = page.locator('.tier');
  await expect(tiers.first()).toHaveText('Variation');
  await expect(tiers.last()).toHaveText('Variation');
});

test('settings survive a reload', async ({ page }) => {
  await page.getByRole('link', { name: /^Settings/ }).click();
  await expect(page).toHaveURL(/#\/more\/settings$/);

  const awake = page.getByRole('switch', { name: /^Keep screen on/ });
  const chime = page.getByRole('switch', { name: /^Chime at zero/ });
  await expect(awake).toHaveAttribute('aria-checked', 'false');
  await expect(chime).toHaveAttribute('aria-checked', 'false');
  await awake.click();
  await chime.click();

  // A step the choices do not offer is typed in: fractional plates make 0.5 kg.
  await page
    .getByRole('group', { name: 'Kilogram plate increment' })
    .getByRole('button', { name: 'Other' })
    .click();
  await page.getByRole('alertdialog').getByRole('textbox', { name: 'Step, kg' }).fill('0,5');
  await page.getByRole('button', { name: 'Save step' }).click();
  await page
    .getByRole('group', { name: 'Pound plate increment' })
    .getByRole('button', { name: '10' })
    .click();

  await page.getByRole('button', { name: /^Device name/ }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('textbox', { name: 'Device name' })
    .fill('Bench phone');
  await page.getByRole('button', { name: 'Save name' }).click();

  // Saved a moment after it shows: wait for the last of them before reloading.
  await expect.poll(async () => (await savedSettings(page)).deviceName).toBe('Bench phone');
  await page.reload();
  await expect(page.getByRole('switch', { name: /^Keep screen on/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('switch', { name: /^Chime at zero/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    page
      .getByRole('group', { name: 'Kilogram plate increment' })
      .getByRole('button', { name: '0.5' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('group', { name: 'Pound plate increment' }).getByRole('button', { name: '10' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Device name/ })).toContainText('Bench phone');

  // The increment is what the entry panel's + steps by.
  await page.getByRole('link', { name: /Askēsis/ }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Enter set 1' }).click();
  const panel = page.getByRole('dialog', { name: 'Low-Bar Squat, Set 1' });
  await panel.getByRole('textbox', { name: 'Load' }).fill('100');
  await panel.getByRole('button', { name: 'More load' }).click();
  await expect(panel.getByRole('textbox', { name: 'Load' })).toHaveValue('100.5');
});
