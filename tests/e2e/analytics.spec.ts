import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('Аналитика: пустое состояние, произвольный период, точный доход и валидация', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Аналитика');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`analytics-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Счета личного пространства' }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/accounts/);
  const workspaceId = page.url().split('/w/')[1]!.split('/')[0]!;
  const account = page.getByRole('form', { name: 'Новый счёт' });
  await account.getByLabel('Название').fill('Банк');
  await account.getByLabel('Начальный остаток').fill('100000');
  await account.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(
    page.getByRole('heading', { name: 'Банк', exact: true }),
  ).toBeVisible();
  await page.goto(`/w/${workspaceId}/analytics`);
  await expect(
    page.getByText('Операций за выбранный период нет.'),
  ).toBeVisible();
  await page.goto(`/w/${workspaceId}/accounts`);
  const form = page.getByRole('form', { name: 'Новый доход' });
  await form.getByLabel('Счёт дохода').selectOption({ label: 'Банк · RUB' });
  await form.getByLabel('Сумма дохода').fill('25000');
  await form.getByLabel('Финансовая дата').fill('2026-10-01');
  await form
    .getByLabel('Категория дохода', { exact: true })
    .selectOption('new');
  await form.getByLabel('Название категории дохода').fill('Зарплата');
  await form.getByRole('button', { name: 'Добавить доход' }).click();
  await expect(form.getByRole('status')).toHaveText('Доход сохранён.');
  await page.goto(`/w/${workspaceId}/analytics`);
  const period = page.getByRole('form', { name: 'Период аналитики' });
  await period.getByRole('combobox', { name: 'Период', exact: true }).selectOption('custom');
  await period.getByLabel('С даты').fill('2026-10-01');
  await period.getByLabel('По дату').fill('2026-10-01');
  await period.getByRole('button', { name: 'Показать отчёт' }).click();
  await expect(
    page.getByText('Доходы: 25 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await period.getByLabel('По дату').fill('2026-09-30');
  await period.getByRole('button', { name: 'Показать отчёт' }).click();
  await expect(period.getByRole('alert')).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
