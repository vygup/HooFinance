import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('Обязательства: план, факт, пауза, ошибки и доступный интерфейс', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Обязательства');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`payments-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Счета личного пространства' }).click();
  const account = page.getByRole('form', { name: 'Новый счёт' });
  await account.getByLabel('Название').fill('Основной');
  await account.getByLabel('Начальный остаток').fill('220000');
  await account.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(
    page.getByText('Текущий баланс: 220 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Цели и резервы' }).click();
  const goal = page.getByRole('form', { name: 'Новая цель' });
  await goal.getByLabel('Название цели').fill('Ипотечная подушка');
  await goal.getByLabel('Счёт цели').selectOption({ label: 'Основной · RUB' });
  await goal.getByLabel('Тип цели').selectOption('reserve');
  await goal.getByLabel('Ежемесячное обязательство').fill('1');
  await goal.getByLabel('Месяцы покрытия').fill('12');
  await goal.getByRole('button', { name: 'Создать цель' }).click();
  await expect(
    page.getByRole('region', { name: 'Цель Ипотечная подушка' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Счета и история накоплений' }).click();
  await page.getByRole('link', { name: 'Регулярные обязательства' }).click();
  const form = page.getByRole('form', { name: 'Новое обязательство' });
  await form.getByLabel('Название').fill('Ипотека');
  await form.getByLabel('Сумма').fill('50000');
  await form
    .getByLabel('Исходная дата')
    .fill(new Date().toISOString().slice(0, 4) + '-01-31');
  await form.getByLabel('Новая категория расхода').fill('Ипотека');
  await form.getByRole('button', { name: 'Создать обязательство' }).click();
  await expect(
    page.getByRole('heading', { name: 'Ипотека', exact: true }),
  ).toBeVisible();
  const link = page.getByRole('form', {
    name: 'Связь резерва Ипотечная подушка',
  });
  await link
    .getByLabel('Ежемесячное обязательство')
    .selectOption({ label: 'Ипотека · 50 000,00 RUB' });
  await link.getByRole('button', { name: 'Сохранить связь' }).click();
  await expect(link).toContainText('Требуется: 600 000,00 RUB');
  const payment = page.getByRole('form', { name: /Оплата/ }).first();
  await payment.getByLabel('Фактическая сумма').fill('49000');
  await payment.getByRole('button', { name: 'Подтвердить оплату' }).click();
  await expect(payment.getByRole('status')).toContainText(
    'Оплата подтверждена',
  );
  await page.getByRole('button', { name: 'Приостановить' }).click();
  await expect(page.getByText('Приостановлено', { exact: true })).toBeVisible();
  await expect(link.getByLabel('Ежемесячное обязательство')).not.toHaveValue(
    '',
  );
  await page.screenshot({
    path: info.outputPath('obligations.png'),
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
