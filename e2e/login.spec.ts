import { test, expect } from '@playwright/test';

// Runs without a backend: unauthenticated visitors are sent to login and the form validates.
test('signed-out visitors are redirected to the login page', async ({ page }) => {
  await page.goto('/attendance');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'DIRA LEARN' })).toBeVisible();
});

test('login form requires both fields', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
