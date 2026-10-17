import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('Месячный бюджет: отсутствие плана, сохранение, редактирование и переключение месяца', async ({
  page,
}, info) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Бюджет');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`budget-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Счета личного пространства' }).click();
  const category = page.getByRole('form', { name: 'Новая категория' });
  await category.getByLabel('Название категории').fill('Продукты');
  await category.getByRole('button', { name: 'Создать категорию' }).click();
  await expect(
    page.getByRole('form', { name: 'Категория Продукты', exact: true }),
  ).toBeVisible();
  for (const name of ['Жильё', 'Транспорт', 'Связь', 'Другое']) {
    await category.getByLabel('Название категории').fill(name);
    await category.getByRole('button', { name: 'Создать категорию' }).click();
    await expect(
      page.getByRole('form', { name: `Категория ${name}`, exact: true }),
    ).toBeVisible();
  }
  const account = page.getByRole('form', { name: 'Новый счёт' });
  await account.getByLabel('Название').fill('Банк');
  await account.getByLabel('Начальный остаток').fill('100000');
  await account.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(
    page.getByText('Текущий баланс: 100 000,00 RUB', { exact: true }),
  ).toBeVisible();
  const expense = page.getByRole('form', { name: 'Новый расход' });
  await expense
    .getByLabel('Счёт расхода')
    .selectOption({ label: 'Банк · RUB' });
  await expense.getByLabel('Сумма расхода').fill('33000');
  await expense.getByLabel('Финансовая дата').fill('2026-10-17');
  await expense
    .getByLabel('Категория расхода', { exact: true })
    .selectOption({ label: 'Продукты' });
  await expense.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(expense.getByRole('status')).toHaveText('Расход сохранён.');
  await page.getByRole('link', { name: 'Месячный бюджет' }).click();
  await page.getByLabel('Месяц бюджета').fill('2026-10');
  await page.getByRole('button', { name: 'Показать бюджет' }).click();
  await expect(
    page.getByText('Бюджет не создан', { exact: true }),
  ).toBeVisible();
  const form = page.getByRole('form', { name: 'План бюджета' });
  await form.getByLabel('Плановый доход').fill('200000');
  await form.getByLabel('Лимит: Продукты').fill('30000');
  for (const [name, amount] of [
    ['Жильё', '50000'],
    ['Транспорт', '10000'],
    ['Связь', '15000'],
    ['Другое', '10000'],
  ] as const)
    await form.getByLabel(`Лимит: ${name}`).fill(amount);
  await form.getByRole('button', { name: 'Сохранить бюджет' }).click();
  await expect(
    page.getByText('План расходов: 115 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Плановый остаток: 85 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Фактические расходы: 33 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Остаток: -3 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Использование: 110,00%', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Превышение лимита', { exact: true }),
  ).toBeVisible();
  for (const name of ['Жильё', 'Транспорт', 'Связь', 'Другое'])
    await form.getByLabel(`Лимит: ${name}`).fill('');
  await form.getByLabel('Лимит: Продукты').fill('0');
  await form.getByRole('button', { name: 'Сохранить бюджет' }).click();
  await expect(
    page.getByText('План расходов: 0,00 RUB', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Месяц бюджета').fill('2026-09');
  await page.getByRole('button', { name: 'Показать бюджет' }).click();
  await expect(
    page.getByText('Бюджет не создан', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('budget.png'),
    fullPage: true,
  });
});
