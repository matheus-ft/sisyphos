import { expect, test } from '@playwright/test';

test('opens without sync and reaches every tab', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await page.getByRole('button', { name: /without sync/i }).click();

  for (const [tab, hash] of [
    ['Historia', '#/history'],
    ['Athloi', '#/progress'],
    ['Agora', '#/more'],
    ['Askēsis', '#/train'],
  ] as const) {
    await page.getByRole('link', { name: new RegExp(tab) }).click();
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
  }

  expect(errors).toEqual([]);
});
