import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('Пополнение цели реальным переводом: актуальные прогресс, покрытие и история; потеря ответа не удваивает деньги', async ({
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
    ['Подушка', '220000'],
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
    card.getByText('Накоплено: 220 000,00 RUB', { exact: true }),
  ).toBeVisible();
  const form = card.getByRole('form', { name: 'Пополнение цели Ипотека' });
  await form
    .getByLabel('Счёт отправителя')
    .selectOption({ label: 'Личное пространство · Банк · RUB' });
  await form.getByLabel('Сумма списания').fill('20000');
  await form.getByLabel('Сумма зачисления').fill('20000');
  await form.getByLabel('Дата перевода').fill('2026-10-17');
  let dropped = false;
  await page.route('**/w/*/goals', async (route) => {
    if (
      !dropped &&
      route.request().method() === 'POST' &&
      route.request().postData()?.includes('debitAmount')
    ) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await form.getByRole('button', { name: 'Перевести', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Не удалось сохранить');
  await page.unroute('**/w/*/goals');
  await form.getByRole('button', { name: 'Перевести', exact: true }).click();
  await expect(
    card.getByText('Накоплено: 240 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Недостаёт: 360 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Прогресс: 40,00%', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Покрытие: 4,8 из 12 месяцев', { exact: true }),
  ).toBeVisible();
  const history = card.getByRole('region', {
    name: 'История пополнений и списаний',
  });
  await expect(history.getByRole('listitem')).toContainText(
    'Перевод на счёт: 20 000,00 RUB',
  );
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath('goal-funding.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
