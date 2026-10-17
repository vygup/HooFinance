import {
  todayInTimezone,
  occurrenceDate,
  formatFinancialDate,
} from '@/shared/calendar/calendar';
import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('План накоплений: сохранение и прогноз без операций', async ({
  page,
}, info) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Резерв');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`reserve-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Счета личного пространства' }).click();
  const account = page.getByRole('form', { name: 'Новый счёт' });
  await account.getByLabel('Название').fill('Подушка');
  await account.getByLabel('Начальный остаток').fill('240000');
  await account.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(
    page.getByText('Текущий баланс: 240 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Цели и резервы' }).click();
  await expect(
    page.getByText('Целей пока нет.', { exact: true }),
  ).toBeVisible();
  const today = todayInTimezone('Europe/Moscow');
  const deadline = occurrenceDate(today, 11, 'month');
  const create = page.getByRole('form', { name: 'Новая цель' });
  await create.getByLabel('Название цели').fill('Ипотечная подушка');
  await create.getByLabel('Счёт цели').selectOption({ label: 'Подушка · RUB' });
  await create.getByLabel('Тип цели').selectOption('reserve');
  await create.getByLabel('Ежемесячное обязательство').fill('50000');
  await create.getByLabel('Месяцы покрытия').fill('12');
  await create.getByLabel('Желаемая дата (необязательно)').fill(deadline);
  await create.getByRole('button', { name: 'Создать цель' }).click();
  const card = page.getByRole('region', { name: 'Цель Ипотечная подушка' });
  await expect(
    card.getByText('Требуемая сумма: 600 000,00 RUB', { exact: true }),
  ).toBeVisible();
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
  const plan = card.getByRole('form', { name: 'План накоплений' });
  await expect(
    plan.getByText('Осталось взносов до срока: 12', { exact: true }),
  ).toBeVisible();
  await expect(
    plan.getByText('Рекомендуемое пополнение: 30 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await plan.getByLabel('Ежемесячное пополнение').fill('-1');
  await plan.getByRole('button', { name: 'Сохранить план' }).click();
  await expect(plan.getByRole('status')).toContainText('Проверьте');
  await plan.getByLabel('Ежемесячное пополнение').fill('30000');
  await expect(
    plan.getByText(`Прогноз достижения: ${formatFinancialDate(deadline)}`, {
      exact: true,
    }),
  ).toBeVisible();
  let dropped = false;
  await page.route('**/w/*/goals', async (route) => {
    if (
      !dropped &&
      route.request().method() === 'POST' &&
      route.request().postData()?.includes('configureSavings')
    ) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await plan.getByRole('button', { name: 'Сохранить план' }).click();
  await expect(plan.getByRole('status')).toContainText('Не удалось сохранить');
  await page.unroute('**/w/*/goals');
  await plan.getByRole('button', { name: 'Сохранить план' }).click();
  await expect(
    plan.getByText('Осталось взносов до срока: 12', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Накоплено: 240 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(plan.getByLabel('Ежемесячное пополнение')).toHaveValue(
    '30000.00',
  );
  await plan
    .getByLabel('Первый предстоящий взнос')
    .fill(occurrenceDate(today, 12, 'month'));
  await expect(
    plan.getByText('Осталось взносов до срока: 0', { exact: true }),
  ).toBeVisible();
  await expect(
    plan.getByText('Нет допустимых дат взносов.', { exact: false }),
  ).toBeVisible();
  await expect(
    plan.getByText('позже желаемого срока', { exact: false }),
  ).toBeVisible();
  await plan.getByLabel('Ежемесячное пополнение').fill('0');
  await expect(
    plan.getByText('Прогнозная дата отсутствует.', { exact: true }),
  ).toBeVisible();
  await plan.getByRole('button', { name: 'Сохранить план' }).click();
  const editGoal = card.getByRole('form', { name: 'Изменить цель' });
  await editGoal.getByLabel('Желаемая дата (необязательно)').fill('2000-01-01');
  await editGoal.getByRole('button', { name: 'Сохранить цель' }).click();
  await expect(
    plan.getByText('Срок цели истёк.', { exact: true }),
  ).toBeVisible();
  const anchor31 = occurrenceDate(`${today.slice(0, 4)}-01-31`, 24, 'month');
  const march31 = occurrenceDate(anchor31, 2, 'month');
  await editGoal.getByLabel('Желаемая дата (необязательно)').fill(march31);
  await editGoal.getByRole('button', { name: 'Сохранить цель' }).click();
  await plan.getByLabel('Первый предстоящий взнос').fill(anchor31);
  await plan.getByLabel('Ежемесячное пополнение').fill('120000');
  await expect(
    plan.getByText(`Прогноз достижения: ${formatFinancialDate(march31)}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    plan.getByText('Осталось взносов до срока: 3', { exact: true }),
  ).toBeVisible();
  await plan.getByRole('button', { name: 'Сохранить план' }).click();
  const reserveSettings = card.getByRole('form', { name: 'Настройки резерва' });
  await reserveSettings.getByLabel('Ежемесячное обязательство').fill('10000');
  await reserveSettings
    .getByRole('button', { name: 'Сохранить настройки резерва' })
    .click();
  await expect(
    plan.getByText('Рекомендуемое пополнение: 0,00 RUB', { exact: true }),
  ).toBeVisible();
  await reserveSettings.getByLabel('Ежемесячное обязательство').fill('0');
  await reserveSettings
    .getByRole('button', { name: 'Сохранить настройки резерва' })
    .click();
  await expect(
    plan.getByText('Обязательство отсутствует — пополнение не требуется.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    card.getByText('Накоплено: 240 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('savings-plan.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
