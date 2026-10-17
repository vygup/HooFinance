import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('shared family grants no personal access; revoked open form and anonymous export fail closed', async ({
  page,
  browser,
}, info) => {
  const { invitationLink } = await import('../helpers/invitation-mail');
  const signup = async (p: typeof page, email: string) => {
    await p.goto('/register');
    await p.getByLabel('Отображаемое имя').fill('Приватность');
    await p.getByLabel('Электронная почта', { exact: true }).fill(email);
    await p.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
    await p.getByRole('button', { name: 'Создать аккаунт' }).click();
    await expect(p).toHaveURL('/dashboard');
  };
  await signup(page, `privacy-owner-${randomUUID()}@example.org`);
  await page.getByRole('link', { name: 'Счета личного пространства' }).click();
  const account = page.getByRole('form', { name: 'Новый счёт' });
  await account.getByLabel('Название').fill('Скрытый личный счёт');
  await account.getByLabel('Начальный остаток').fill('12345.67');
  await account.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(
    page.getByRole('heading', { name: 'Скрытый личный счёт', exact: true }),
  ).toBeVisible();
  const personalUrl = page.url();
  await page.goto('/families');
  await page.getByLabel('Название новой семьи').fill('Семья приватности');
  await page
    .getByRole('button', { name: 'Создать семью', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Семья приватности', exact: true }),
  ).toBeVisible();
  const href = await page
    .getByRole('link', { name: 'Семья приватности · семейное', exact: true })
    .getAttribute('href');
  const familyId = new URL(href!, 'http://127.0.0.1:3100').searchParams.get(
    'workspace',
  )!;
  const email = `privacy-member-${randomUUID()}@example.org`;
  await page.getByLabel('Почта приглашённого').fill(email);
  await page.getByRole('button', { name: 'Пригласить', exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const link = await invitationLink(email);
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:3100',
    viewport: info.project.use.viewport ?? null,
    colorScheme: info.project.use.colorScheme ?? 'light',
    isMobile: info.project.use.isMobile ?? false,
  });
  try {
    const guest = await context.newPage();
    await signup(guest, email);
    await guest.goto(link);
    await guest
      .getByRole('button', { name: 'Принять приглашение', exact: true })
      .click();
    await expect(guest.getByRole('status')).toContainText('Принято');
    for (const section of ['accounts', 'budget', 'goals']) {
      await guest.goto(personalUrl.replace(/accounts$/, section));
      await expect(guest.locator('main').getByRole('alert')).toHaveText(
        'Нет доступа к этому пространству.',
      );
      await expect(guest.locator('main')).not.toContainText(
        'Скрытый личный счёт',
      );
      await expect(guest.locator('main')).not.toContainText('12 345,67');
    }
    await guest.getByRole('button', { name: 'Проверить доступ снова' }).click();
    await expect(guest.locator('main').getByRole('alert')).toBeFocused();
    await guest.screenshot({
      path: info.outputPath('access-denied.png'),
      fullPage: true,
    });
    const personalId = new URL(personalUrl).pathname.split('/')[2];
    const csv = await context.request.get(
      `/api/workspaces/${personalId}/csv/export`,
    );
    expect(csv.status()).toBe(403);
    expect(await csv.json()).toEqual({ status: 'forbidden' });
    expect(csv.headers()['cache-control']).toContain('no-store');
    await guest.goto(`/w/${familyId}/accounts`);
    const form = guest.getByRole('form', { name: 'Новый счёт' });
    await form.getByLabel('Название').fill('Запрещённое изменение');
    await page.goto(`/families?workspace=${familyId}`);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Исключить участника' }).click();
    await expect(
      page.getByText(`${email} · участник`, { exact: true }),
    ).toHaveCount(0);
    await form.getByRole('button', { name: 'Создать счёт' }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    await expect(form.getByLabel('Название')).toHaveValue(
      'Запрещённое изменение',
    );
    page.once('dialog', (d) => d.accept());
    await page.goto(`/w/${familyId}/accounts`);
    await expect(
      page.getByRole('heading', { name: 'Запрещённое изменение', exact: true }),
    ).toHaveCount(0);
    guest.once('dialog', (d) => d.accept());
    await guest.goto(`/w/${familyId}/accounts`);
    await expect(guest.locator('main').getByRole('alert')).toHaveText(
      'Нет доступа к этому пространству.',
    );
  } finally {
    await context.close();
  }
  const anonymous = await browser.newContext({
    baseURL: 'http://127.0.0.1:3100',
  });
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto(personalUrl);
    await expect(visitor).toHaveURL(/\/login/);
    const csv = await anonymous.request.get(
      `/api/workspaces/${familyId}/csv/export`,
    );
    expect(csv.status()).toBe(401);
    expect(await csv.json()).toEqual({ status: 'unauthorized' });
  } finally {
    await anonymous.close();
  }
});
