import { test, expect } from './fixtures';
test('Русский каркас доступен с клавиатуры и не выходит за экран', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(
    page.getByRole('heading', { name: 'Finance Manager' }),
  ).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Перейти к содержимому' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test('Liveness не раскрывает конфигурацию', async ({ request }) => {
  const response = await request.get('/api/health/live');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
  expect(response.headers()['cache-control']).toBe('no-store');
});

test('Auth Route Handler не кеширует сессии и закрывает прямое создание организации', async ({
  request,
}) => {
  const session = await request.get('/api/auth/get-session');
  expect(session.status()).toBe(200);
  expect(await session.json()).toBeNull();
  expect(session.headers()['cache-control']).toBe('private, no-store');
  const creation = await request.post('/api/auth/organization/create', {
    headers: { origin: 'http://127.0.0.1:3100' },
    data: { name: 'Обход', slug: 'must-not-exist' },
  });
  expect(creation.status()).toBe(403);
  expect(creation.headers()['cache-control']).toBe('private, no-store');
});
