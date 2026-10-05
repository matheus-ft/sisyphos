// Agora: the lifter's own data, and the settings that belong to the device.
import { expect, test } from '@playwright/test';
import { openSeeded, savedSettings } from './seed.ts';

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
  await page.getByRole('link', { name: /Agora/ }).click();
});

test('a weigh-in is added and a reference max filled from the suggestion', async ({ page }) => {
  await page.getByRole('link', { name: /^Bodyweight/ }).click();
  await expect(page).toHaveURL(/#\/more\/lifter$/);

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

  await page
    .getByRole('group', { name: 'Kilogram plate increment' })
    .getByRole('button', { name: '1.25' })
    .click();
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
      .getByRole('button', { name: '1.25' }),
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
  await expect(panel.getByRole('textbox', { name: 'Load' })).toHaveValue('101.25');
});
