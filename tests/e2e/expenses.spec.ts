import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('Расход и категории: создание, минус, отмена, подтверждение, переименование и архив', async ({
  page,
}, info) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Расход');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`expense-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Счета личного пространства' }).click();
  const account = page.getByRole('form', { name: 'Новый счёт' });
  await account.getByLabel('Название').fill('Банк');
  await account.getByLabel('Начальный остаток').fill('120000');
  await account.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(
    page.getByText('Текущий баланс: 120 000,00 RUB', { exact: true }),
  ).toBeVisible();
  const form = page.getByRole('form', { name: 'Новый расход' });
  await form.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(form.getByLabel('Счёт расхода')).toBeFocused();
  await form.getByLabel('Счёт расхода').selectOption({ label: 'Банк · RUB' });
  await form.getByLabel('Сумма расхода').fill('3000');
  await form.getByLabel('Финансовая дата').fill('2026-10-17');
  await form
    .getByLabel('Категория расхода', { exact: true })
    .selectOption('new');
  await form.getByLabel('Название категории расхода').fill('Продукты');
  await form.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(form.getByRole('status')).toHaveText('Расход сохранён.');
  await expect(
    page.getByText('Текущий баланс: 117 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await form.getByLabel('Сумма расхода').fill('118500');
  await form.getByRole('button', { name: 'Добавить расход' }).click();
  const dialog = form.getByRole('alertdialog');
  await expect(dialog).toContainText('-1 500,00 RUB');
  await dialog.getByRole('button', { name: 'Отменить расход' }).click();
  await expect(
    page.getByText('Текущий баланс: 117 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Добавить расход' }).click();
  await dialog
    .getByRole('button', { name: 'Подтвердить отрицательный остаток' })
    .click();
  await expect(
    page.getByText('Текущий баланс: -1 500,00 RUB', { exact: true }),
  ).toBeVisible();
  const cat = page.getByRole('form', {
    name: 'Категория Продукты',
    exact: true,
  });
  await cat.getByLabel('Название категории').fill('Еда');
  await cat.getByRole('button', { name: 'Переименовать' }).click();
  const renamed = page.getByRole('form', {
    name: 'Категория Еда',
    exact: true,
  });
  await expect(renamed).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await renamed.getByRole('button', { name: 'Архивировать категорию' }).click();
  await expect(renamed.getByText('Расход · Архивная')).toBeVisible();
  await expect(
    form
      .getByLabel('Категория расхода', { exact: true })
      .getByRole('option', { name: 'Еда', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('expenses.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
