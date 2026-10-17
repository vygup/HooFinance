import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';

test('История: исправление, совместные фильтры, аудит, отмена и подтверждение удаления', async ({
  page,
}, info) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('История');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`history-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Счета личного пространства' }).click();
  const account = page.getByRole('form', { name: 'Новый счёт' });
  await account.getByLabel('Название').fill('Банк');
  await account.getByLabel('Начальный остаток').fill('10000');
  await account.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(
    page.getByText('Текущий баланс: 10 000,00 RUB', { exact: true }),
  ).toBeVisible();
  const expense = page.getByRole('form', { name: 'Новый расход' });
  await expense
    .getByLabel('Счёт расхода')
    .selectOption({ label: 'Банк · RUB' });
  await expense.getByLabel('Сумма расхода').fill('1000');
  await expense.getByLabel('Финансовая дата').fill('2026-09-15');
  await expense.getByLabel('Название категории расхода').fill('Еда');
  await expense.getByLabel('Описание расхода').fill('Покупка');
  await expense.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(expense.getByRole('status')).toBeVisible();
  await page
    .getByRole('link', { name: 'История операций', exact: true })
    .click();
  const edit = page.getByRole('form', { name: 'Исправление операции' });
  await edit.getByLabel('Сумма', { exact: true }).fill('1.005');
  await edit.getByRole('button', { name: 'Сохранить исправление' }).click();
  await expect(edit.getByRole('alert')).toBeVisible();
  await edit.getByLabel('Сумма', { exact: true }).fill('1500');
  await edit.getByLabel('Финансовая дата').fill('2026-10-15');
  await edit.getByLabel('Описание', { exact: true }).fill('Исправлено');
  await edit.getByRole('button', { name: 'Сохранить исправление' }).click();
  await expect(page.getByText('Версия 2 · Активна')).toBeVisible();
  const filters = page.getByRole('form', { name: 'Поиск операций' });
  await filters.getByLabel('С даты').fill('2026-10-01');
  await filters.getByLabel('По дату').fill('2026-10-31');
  await filters
    .getByRole('combobox', { name: 'Счёт', exact: true })
    .selectOption({ label: 'Банк' });
  await filters
    .getByRole('combobox', { name: 'Категория', exact: true })
    .selectOption({ label: 'Еда' });
  await filters.getByLabel('Поиск по описанию').fill('Исправлено');
  await filters.getByRole('button', { name: 'Найти' }).click();
  await expect(edit).toBeVisible();
  await page.getByText('История изменений', { exact: true }).click();
  await expect(page.getByText('1000.00 RUB', { exact: false })).toBeVisible();
  await edit.getByLabel('Сумма', { exact: true }).fill('11000');
  await edit.getByRole('button', { name: 'Сохранить исправление' }).click();
  const warning = edit.getByRole('alertdialog');
  await expect(warning).toBeFocused();
  await expect(warning).toContainText('-1 000,00 RUB');
  await warning.getByRole('button', { name: 'Отменить изменение' }).click();
  await expect(edit.getByLabel('Сумма', { exact: true })).toHaveValue('11000');
  await edit.getByRole('button', { name: 'Сохранить исправление' }).click();
  await warning
    .getByRole('button', { name: 'Подтвердить отрицательный остаток' })
    .click();
  await expect(page.getByText('Версия 3 · Активна')).toBeVisible();
  page.once('dialog', (d) => d.dismiss());
  await edit.getByRole('button', { name: 'Удалить операцию' }).click();
  await expect(page.getByText('Версия 3 · Активна')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await edit.getByRole('button', { name: 'Удалить операцию' }).click();
  await expect(page.getByText('Версия 4 · Удалена')).toBeVisible();
  await page.screenshot({
    path: info.outputPath('history.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
