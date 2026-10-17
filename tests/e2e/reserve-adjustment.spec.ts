import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('Изменение резерва: КУ-009, валидация, ноль и восстановление', async ({
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
  await account.getByLabel('Начальный остаток').fill('220000');
  await account.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(
    page.getByText('Текущий баланс: 220 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Цели и резервы' }).click();
  await expect(
    page.getByText('Целей пока нет.', { exact: true }),
  ).toBeVisible();
  const create = page.getByRole('form', { name: 'Новая цель' });
  await create.getByLabel('Название цели').fill('Ипотечная подушка');
  await create.getByLabel('Счёт цели').selectOption({ label: 'Подушка · RUB' });
  await create.getByLabel('Тип цели').selectOption('reserve');
  await create.getByLabel('Ежемесячное обязательство').fill('50000');
  await create.getByLabel('Месяцы покрытия').fill('12');
  await create.getByRole('button', { name: 'Создать цель' }).click();
  const card = page.getByRole('region', { name: 'Цель Ипотечная подушка' });
  await expect(
    card.getByText('Требуемая сумма: 600 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Накоплено: 220 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Недостаёт: 380 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Прогресс: 36,67%', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Покрытие: 4,4 из 12 месяцев', { exact: true }),
  ).toBeVisible();
  const edit = card.getByRole('form', { name: 'Настройки резерва' });
  await edit.getByLabel('Ежемесячное обязательство').fill('-1');
  await edit
    .getByRole('button', { name: 'Сохранить настройки резерва' })
    .click();
  await expect(edit.getByRole('status')).toContainText('Проверьте');
  let dropped = false;
  await page.route('**/w/*/goals', async (route) => {
    if (
      !dropped &&
      route.request().method() === 'POST' &&
      route.request().postData()?.includes('adjustReserve')
    ) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await edit.getByLabel('Ежемесячное обязательство').fill('55000');
  await edit
    .getByRole('button', { name: 'Сохранить настройки резерва' })
    .click();
  await expect(edit.getByRole('status')).toContainText('Не удалось сохранить');
  await page.unroute('**/w/*/goals');
  await edit
    .getByRole('button', { name: 'Сохранить настройки резерва' })
    .click();
  await expect(
    card.getByText('Недостаёт: 440 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Покрытие: 4 из 12 месяцев', { exact: true }),
  ).toBeVisible();
  await edit.getByLabel('Ежемесячное обязательство').fill('0');
  await edit
    .getByRole('button', { name: 'Сохранить настройки резерва' })
    .click();
  await expect(
    card.getByText('Обязательство отсутствует', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Недостаёт: 0,00 RUB', { exact: true }),
  ).toBeVisible();
  await edit.getByLabel('Ежемесячное обязательство').fill('55000');
  await edit
    .getByRole('button', { name: 'Сохранить настройки резерва' })
    .click();
  await expect(
    card.getByText('Требуемая сумма: 660 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('reserve.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  page.once('dialog', (d) => d.accept());
  await card.getByRole('button', { name: 'Архивировать цель' }).click();
  await expect(card.getByText('Архивная цель', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Счета и история накоплений' }).click();
  await expect(
    page.getByText('Текущий баланс: 220 000,00 RUB', { exact: true }),
  ).toBeVisible();
});
