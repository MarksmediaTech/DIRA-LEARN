import { test, expect, type Page } from '@playwright/test';

// Full password recovery in a real browser against the LOCAL Supabase and its test inbox (Mailpit).
// Run by TEST-PASSWORD-RECOVERY.bat (it sets VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY to the local stack and refuses anything else).
// Uses the local test accounts learner2@ and coordinator@dira-test.local and puts their password back to DiraTest!2026 afterwards.
// Never prints codes or passwords.
const API = (process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const MAIL = (process.env.LOCAL_MAIL_URL || 'http://127.0.0.1:54324').replace(/\/$/, '');
const TEST_PASSWORD = 'DiraTest!2026';
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(API);
test.skip(!isLocal || !KEY, 'needs the local Supabase (run TEST-PASSWORD-RECOVERY.bat)');
test.describe.configure({ mode: 'serial', timeout: 240_000 });

async function latestCode(email: string, since: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}&limit=5`);
    if (r.ok) {
      const j = (await r.json()) as { messages?: { ID: string; Created: string }[] };
      const m = (j.messages ?? []).filter((x) => new Date(x.Created).getTime() >= since).sort((a, b) => b.Created.localeCompare(a.Created))[0];
      if (m) {
        const full = (await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json()) as { Text?: string; HTML?: string };
        const c = `${full.Text ?? ''} ${full.HTML ?? ''}`.match(/\b(\d{6,10})\b/);
        if (c) return c[1]!;
      }
    }
    await new Promise((res) => setTimeout(res, 700));
  }
  throw new Error('no recovery email arrived in the local test inbox');
}
async function api(path: string, body: unknown, method = 'POST', token?: string) {
  const r = await fetch(`${API}/auth/v1${path}`, { method, headers: { apikey: KEY, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as { access_token?: string } };
}
async function restore(email: string) {
  await new Promise((res) => setTimeout(res, 61_000));                 // Supabase sends at most one code a minute per address
  const since = Date.now() - 2000;
  await api('/recover', { email });
  const v = await api('/verify', { type: 'recovery', email, token: await latestCode(email, since) });
  await api('/user', { password: TEST_PASSWORD }, 'PUT', v.json.access_token);
  expect((await api('/token?grant_type=password', { email, password: TEST_PASSWORD })).status).toBe(200);
}
async function startRecovery(page: Page, email: string): Promise<number> {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  const since = Date.now() - 2000;
  await page.getByRole('button', { name: 'Send reset code' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  return since;
}

test('an unknown address gets the same confirmation as a registered one', async ({ page }) => {
  await startRecovery(page, 'nobody-e2e@dira-test.local');
  await expect(page.getByRole('status').first()).toContainText('If an account exists for this email address');
});

for (const [who, email, newPassword] of [['learner', 'learner2@dira-test.local', 'learner2-2026-new'], ['staff (coordinator)', 'coordinator@dira-test.local', 'coordinator-2026-new']] as const) {
  test(`${who}: code, password rules, new password, sign-in`, async ({ page }) => {
    const since = await startRecovery(page, email);
    const code = await latestCode(email, since);
    await expect(page.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled();
    await page.getByLabel('Reset code').fill(code === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: 'Verify code' }).click();
    await expect(page.getByRole('alert')).toContainText('not correct or has expired');
    await page.getByLabel('Reset code').fill(code);
    await page.getByRole('button', { name: 'Verify code' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

    await page.goto('/');                                                   // the recovery session cannot open DIRA LEARN
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

    await page.locator('#fp-password').fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword + 'x');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByRole('alert')).toContainText('do not match');
    await page.locator('#fp-password').fill('short1'); await page.getByLabel('Confirm new password').fill('short1');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByRole('alert')).toContainText('at least 10');
    await page.locator('#fp-password').fill(newPassword); await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Save new password' }).click();

    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await expect(page.getByRole('status').first()).toContainText('Your password has been changed');
    await page.getByLabel('Email address').fill(email);
    await page.locator('#login-password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();                   // old password no longer works
    await page.locator('#login-password').fill(newPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).not.toHaveURL(/\/login$/);

    // a used code cannot be used again
    expect((await api('/verify', { type: 'recovery', email, token: code })).status).toBeGreaterThanOrEqual(400);
    await restore(email);
  });
}
