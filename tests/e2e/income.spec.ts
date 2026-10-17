import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('Доход: валидация → создание категории → 120000 → выбранный месяц → повторное использование категории', async ({
  page,
}, info) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Доход');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`income-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Счета личного пространства' }).click();
  const account = page.getByRole('form', { name: 'Новый счёт' });
  await account.getByLabel('Название').fill('Банк');
  await account.getByLabel('Начальный остаток').fill('100000');
  await account.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(
    page.getByRole('heading', { name: 'Банк', exact: true }),
  ).toBeVisible();
  const form = page.getByRole('form', { name: 'Новый доход' });
  await form.getByRole('button', { name: 'Добавить доход' }).click();
  await expect(form.getByLabel('Счёт дохода')).toBeFocused();
  await form.getByLabel('Счёт дохода').selectOption({ label: 'Банк · RUB' });
  await form.getByLabel('Сумма дохода').fill('20000');
  await form.getByLabel('Финансовая дата').fill('2026-10-17');
  await form
    .getByLabel('Категория дохода', { exact: true })
    .selectOption('new');
  await form.getByLabel('Название категории дохода').fill('Зарплата');
  await form.getByLabel('Описание дохода').fill('Поступление');
  // The server commits, but the browser loses the response. Retry must reuse its key.
  await page.route(
    page.url(),
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await form.getByRole('button', { name: 'Добавить доход' }).click();
  await expect(form.getByRole('alert')).toContainText('Не удалось сохранить');
  await expect(form.getByLabel('Сумма дохода')).toHaveValue('20000');
  await form.getByRole('button', { name: 'Добавить доход' }).click();
  await expect(form.getByRole('status')).toHaveText('Доход сохранён.');
  await expect(
    page.getByText('Текущий баланс: 120 000,00 RUB', { exact: true }),
  ).toBeVisible();
  const period = page.getByRole('form', { name: 'Период доходов' });
  await period.getByLabel('Месяц доходов').fill('2026-10');
  await period.getByRole('button', { name: 'Показать доходы' }).click();
  await page.waitForURL('**/accounts?month=2026-10', { waitUntil: 'load' });
  await expect(
    page.getByText('Доход за месяц: 20 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await period.getByLabel('Месяц доходов').fill('2026-09');
  await period.getByRole('button', { name: 'Показать доходы' }).click();
  await page.waitForURL('**/accounts?month=2026-09', { waitUntil: 'load' });
  await expect(page.getByText('Доходов за месяц нет.')).toBeVisible();
  await form.getByLabel('Счёт дохода').selectOption({ label: 'Банк · RUB' });
  await form.getByLabel('Сумма дохода').fill('0');
  await form
    .getByLabel('Категория дохода', { exact: true })
    .selectOption({ label: 'Зарплата' });
  await form.getByRole('button', { name: 'Добавить доход' }).click();
  await expect(form.getByLabel('Сумма дохода')).toBeFocused();
  await expect(
    form.getByLabel('Категория дохода', { exact: true }),
  ).toHaveValue(/.+/);
  await form.getByLabel('Сумма дохода').fill('1');
  await form.getByRole('button', { name: 'Добавить доход' }).click();
  await expect(
    page.getByText('Текущий баланс: 120 001,00 RUB', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('income.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
