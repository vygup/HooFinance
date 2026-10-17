import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('Снятие резерва переводом снимает достижение и показывает 11 месяцев', async ({
  page,
}, info) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Пополнение');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`fund-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Счета личного пространства' }).click();
  const a = page.getByRole('form', { name: 'Новый счёт' });
  for (const [name, balance] of [
    ['Банк', '100000'],
    ['Подушка', '600000'],
  ] as const) {
    await a.getByLabel('Название').fill(name);
    await a.getByLabel('Начальный остаток').fill(balance);
    await a.getByRole('button', { name: 'Создать счёт' }).click();
    await expect(
      page.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('link', { name: 'Цели и резервы' }).click();
  const create = page.getByRole('form', { name: 'Новая цель' });
  await create.getByLabel('Название цели').fill('Ипотека');
  await create.getByLabel('Счёт цели').selectOption({ label: 'Подушка · RUB' });
  await create.getByLabel('Тип цели').selectOption('reserve');
  await create.getByLabel('Ежемесячное обязательство').fill('50000');
  await create.getByRole('button', { name: 'Создать цель' }).click();
  const card = page.getByRole('region', { name: 'Цель Ипотека', exact: true });
  await expect(
    card.getByText('Накоплено: 600 000,00 RUB', { exact: true }),
  ).toBeVisible();
  const form = card.getByRole('form', { name: 'Снятие резерва Ипотека' });
  await form
    .getByLabel('Счёт получателя')
    .selectOption({ label: 'Личное пространство · Банк · RUB' });
  await form.getByLabel('Сумма списания').fill('50000');
  await form.getByLabel('Сумма зачисления').fill('50000');
  await form.getByRole('button', { name: 'Перевести', exact: true }).click();
  await expect(
    card.getByText('Накоплено: 550 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Недостаёт: 50 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Покрытие: 11 из 12 месяцев', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Цель ещё не достигнута', { exact: true }),
  ).toBeVisible();
  const expense = card.getByRole('form', { name: 'Новый расход', exact: true });
  await expense.getByLabel('Сумма расхода').fill('555000');
  await expense.getByLabel('Название категории расхода').fill('Платёж');
  await expense
    .getByRole('button', { name: 'Добавить расход', exact: true })
    .click();
  await expect(
    expense.getByLabel('Подтверждение отрицательного остатка'),
  ).toBeVisible();
  await expect(
    card.getByText('Накоплено: 550 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expense
    .getByRole('button', { name: 'Подтвердить отрицательный остаток' })
    .click();
  await expect(
    card.getByText('Накоплено: -5 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Недостаёт: 605 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Дефицит средств', { exact: true }),
  ).toBeVisible();
  await expect(card.getByText('Покрытие:', { exact: false })).toHaveCount(0);
  const edit = card.getByRole('form', { name: 'Изменить цель' });
  await edit.getByLabel('Ежемесячное обязательство').fill('0');
  await edit.getByRole('button', { name: 'Сохранить цель' }).click();
  await expect(
    card.getByText('Обязательство отсутствует', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Дефицит средств на счёте', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Недостаёт: 0,00 RUB', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('reserve-withdrawal.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
