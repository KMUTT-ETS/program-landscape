import { expect, test } from '@playwright/test';

// Smoke test — dev login → home → theme toggle → logout.
//
// Prerequisites:
//   pnpm db:up && pnpm db:seed
//   pnpm --filter web exec playwright install --with-deps  (one-time)
//   pnpm dev                                                (in another terminal)
//   pnpm --filter web test:e2e

test.describe('dev login smoke', () => {
  test('sign in with dev credentials, toggle theme, sign out', async ({ page }) => {
    await page.goto('/signin');

    // Dev credentials form should be visible; SSO button may be disabled
    // when KKU_SSO_ISSUER is unset.
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email').fill('admin@kku.ac.th');
    await page.getByLabel('Password').fill('kku-dev');
    await page
      .getByRole('button', { name: /Sign in with developer credentials/i })
      .click();

    // Landing on the authenticated home.
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole('heading', { name: /Welcome, Admin/i }),
    ).toBeVisible();

    // Theme toggle round-trip.
    const themeSelect = page.getByLabel('Theme', { exact: true });
    await themeSelect.selectOption('dark');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await themeSelect.selectOption('light');
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    // Sign out.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/signin/);
  });
});
