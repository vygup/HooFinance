import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('Накопительный счёт: история до цели, предпросмотр и запрет второй активной связи', async ({
  page,
}, info) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Накопления');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`savings-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Счета личного пространства' }).click();
  const account = page.getByRole('form', { name: 'Новый счёт' });
  await account.getByLabel('Название').fill('Подушка');
  await account.getByLabel('Тип счёта').selectOption('accumulation');
  await account.getByLabel('Начальный остаток').fill('200000');
  await account.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(
    page.getByText('Текущий баланс: 200 000,00 RUB', { exact: true }),
  ).toBeVisible();
  const income = page.getByRole('form', { name: 'Новый доход' });
  await income
    .getByLabel('Счёт дохода')
    .selectOption({ label: 'Подушка · RUB' });
  await income.getByLabel('Сумма дохода').fill('20000');
  await income.getByLabel('Финансовая дата').fill('2026-10-17');
  await income.getByLabel('Название категории дохода').fill('До цели');
  await income.getByRole('button', { name: 'Добавить доход' }).click();
  await expect(
    page.getByText('Текущий баланс: 220 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Цели и резервы' }).click();
  const create = page.getByRole('form', { name: 'Новая цель' });
  let previewFailed = false;
  await page.route('**/w/*/goals', (route) => {
    if (!previewFailed && route.request().method() === 'POST') {
      previewFailed = true;
      return route.abort('failed');
    }
    return route.continue();
  });
  await create.getByLabel('Счёт цели').selectOption({ label: 'Подушка · RUB' });
  const preview = create.getByRole('region', {
    name: 'Средства выбранного счёта',
  });
  await expect(preview.getByRole('alert')).toHaveText(
    'Не удалось загрузить историю счёта.',
  );
  await expect(preview.getByRole('alert')).toBeFocused();
  await preview
    .getByRole('button', { name: 'Повторить загрузку истории' })
    .click();
  await expect(
    preview.getByText('Баланс счёта: 220 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByText('Начальный остаток: 200 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(preview.getByRole('listitem')).toContainText(
    'Доход: 20 000,00 RUB',
  );
  await page.unroute('**/w/*/goals');
  await create.getByLabel('Название цели').fill('Ипотека');
  await create.getByLabel('Тип цели').selectOption('reserve');
  await create.getByLabel('Ежемесячное обязательство').fill('50000');
  await create.getByRole('button', { name: 'Создать цель' }).click();
  const card = page.getByRole('region', { name: 'Цель Ипотека', exact: true });
  await expect(
    card.getByText('Накоплено: 220 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    create
      .getByLabel('Счёт цели')
      .getByRole('option', { name: 'Подушка · RUB' }),
  ).toHaveCount(0);
  await expect(
    card
      .getByRole('region', { name: 'Средства выбранного счёта' })
      .getByRole('listitem'),
  ).toContainText('Доход: 20 000,00 RUB');
  await page.screenshot({
    path: info.outputPath('savings-account.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('link', { name: 'Счета и история накоплений' }).click();
  await expect(
    page.getByText('Общий остаток: 220 000,00 RUB', { exact: true }),
  ).toBeVisible();
});
