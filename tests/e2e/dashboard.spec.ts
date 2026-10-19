import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('Главный дашборд: пустые состояния, точные суммы, резерв, переходы и повтор загрузки', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Обзор');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`dashboard-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Обзор личного пространства' }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+$/);
  const dashboard = page.url();
  await expect(
    page.getByText('Счетов пока нет.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Бюджет на этот месяц не задан.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Активных целей нет.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Активных резервов нет.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Операций пока нет.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Все счета', exact: true }).click();
  const account = page.getByRole('form', { name: 'Новый счёт' });
  await account.getByLabel('Название').fill('Подушка');
  await account.getByLabel('Начальный остаток').fill('220000');
  await account.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(
    page.getByRole('heading', { name: 'Подушка', exact: true }),
  ).toBeVisible();
  const income = page.getByRole('form', { name: 'Новый доход' });
  await income
    .getByLabel('Счёт дохода')
    .selectOption({ label: 'Подушка · RUB' });
  await income.getByLabel('Сумма дохода').fill('0.01');
  await income
    .getByLabel('Категория дохода', { exact: true })
    .selectOption('new');
  await income.getByLabel('Название категории дохода').fill('Пополнение');
  await income.getByRole('button', { name: 'Добавить доход' }).click();
  await expect(income.getByRole('status')).toHaveText('Доход сохранён.');
  await page.getByRole('link', { name: 'Цели и резервы', exact: true }).click();
  const goal = page.getByRole('form', { name: 'Новая цель' });
  await goal.getByLabel('Название цели').fill('Резерв семьи');
  await goal.getByLabel('Счёт цели').selectOption({ label: 'Подушка · RUB' });
  await goal.getByLabel('Тип цели').selectOption('reserve');
  await goal.getByLabel('Ежемесячное обязательство').fill('50000');
  await goal.getByLabel('Месяцы покрытия').fill('12');
  await goal.getByRole('button', { name: 'Создать цель' }).click();
  await expect(
    page.getByRole('region', { name: 'Цель Резерв семьи' }),
  ).toBeVisible();
  await page.goto(dashboard);
  await expect(
    page
      .getByRole('region', { name: 'Общие средства' })
      .getByText('220 000,01 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Доходы: 0,01 RUB', { exact: true }),
  ).toBeVisible();
  const reserve = page.getByRole('region', { name: 'Резервы', exact: true });
  await expect(
    reserve.getByText('Накоплено: 220 000,01 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    reserve.getByText('Недостаёт: 379 999,99 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    reserve.getByText('Покрытие: 4,4 из 12 месяцев', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('dashboard.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await reserve
    .getByRole('link', { name: 'Резерв семьи', exact: true })
    .click();
  await expect(page).toHaveURL(/\/goals#goal-/);
  await page.goto(dashboard);
  const refresh = page.getByRole('form', { name: 'Обновление обзора' });
  await page.route(page.url(), (route) => route.abort('failed'), { times: 1 });
  await refresh.getByRole('button', { name: 'Обновить обзор' }).click();
  await expect(refresh.getByRole('alert')).toBeFocused();
  await expect(refresh.getByRole('alert')).toContainText('Не удалось');
  await refresh.getByRole('button', { name: 'Обновить обзор' }).click();
  await expect(refresh.getByRole('status')).toHaveText('Обзор обновлён.');
  await page.goto(dashboard.replace(/[^/]+$/, randomUUID()));
  await expect(
    page.getByRole('heading', { name: 'Доступ ограничен' }),
  ).toBeVisible();
  await expect(page.getByText('220 000,01 RUB', { exact: true })).toHaveCount(
    0,
  );
});
