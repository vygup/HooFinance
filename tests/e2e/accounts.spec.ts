import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { test, expect } from './fixtures';
import { requireTestDatabase } from '../helpers/database';
import { seedAccountHistory } from '../helpers/account-history';
import type { Page } from '@playwright/test';
async function signup(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Владелец');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`accounts-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Счета личного пространства' }).click();
}
async function create(page: Page, name: string, opening: string) {
  const form = page.getByRole('form', { name: 'Новый счёт' });
  await form.getByLabel('Название').fill(name);
  await form.getByLabel('Начальный остаток').fill(opening);
  await form.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
test('Счёт: opening → операции fixture → correction → rename → archive сохраняет деньги/историю', async ({
  page,
}, info) => {
  await signup(page);
  await expect(page.getByText('Счетов пока нет.')).toBeVisible();
  await create(page, 'Банк', '100000');
  let card = page.getByRole('article', { name: 'Банк' });
  await expect(
    card.getByText('Текущий баланс: 100 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(card.getByText('Операций пока нет.')).toBeVisible();
  const scope = page.url().match(/\/w\/([^/]+)/)![1]!;
  const pool = new Pool({ connectionString: requireTestDatabase(process.env) });
  try {
    const { rows } = await pool.query(
      'SELECT a.id,w.personal_owner_id FROM financial_account a JOIN workspace w ON w.id=a.workspace_id WHERE w.id=$1',
      [scope],
    );
    await seedAccountHistory(
      pool,
      scope,
      rows[0].id,
      rows[0].personal_owner_id,
    );
  } finally {
    await pool.end();
  }
  await page.reload();
  await expect(
    card.getByText('Текущий баланс: 117 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await card.getByLabel('Новый начальный остаток').fill('90000');
  page.once('dialog', (d) => d.dismiss());
  await card
    .getByRole('button', { name: 'Исправить начальный остаток', exact: true })
    .click();
  await expect(
    card.getByText('Текущий баланс: 117 000,00 RUB', { exact: true }),
  ).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await card
    .getByRole('button', { name: 'Исправить начальный остаток', exact: true })
    .click();
  await expect(
    card.getByText('Текущий баланс: 107 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(card.getByText('20 000,00 RUB', { exact: false })).toBeVisible();
  await expect(card.getByText('3 000,00 RUB', { exact: false })).toBeVisible();
  await card.getByText('Аудит изменений', { exact: true }).click();
  await expect(
    card.getByText('Исправление начального остатка', { exact: false }),
  ).toBeVisible();
  await card.getByLabel('Название счёта').fill('Переименованный');
  await card.getByRole('button', { name: 'Сохранить описание' }).click();
  card = page.getByRole('article', { name: 'Переименованный' });
  await expect(card).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await card.getByRole('button', { name: 'Архивировать' }).click();
  await expect(card.getByText('Архивный счёт', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Общий остаток: 107 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(card.getByRole('button', { name: 'Архивировать' })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: info.outputPath('accounts.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('Zero/negative, validation, дополнительное предупреждение и чужой URL', async ({
  page,
  browser,
}) => {
  await signup(page);
  const createForm = page.getByRole('form', { name: 'Новый счёт' });
  await createForm.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(createForm.getByLabel('Название')).toBeFocused();
  await create(page, 'Ноль', '0');
  await create(page, 'Минус', '-50');
  const card = page.getByRole('article', { name: 'Ноль' });
  await card.getByLabel('Новый начальный остаток').fill('-1');
  page.once('dialog', (d) => d.accept());
  await card
    .getByRole('button', { name: 'Исправить начальный остаток', exact: true })
    .click();
  await expect(
    card.getByText('Отрицательный остаток: -1,00 RUB'),
  ).toBeVisible();
  await card.getByRole('button', { name: 'Отмена' }).click();
  await expect(
    card.getByText('Текущий баланс: 0,00 RUB', { exact: true }),
  ).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await card
    .getByRole('button', { name: 'Исправить начальный остаток', exact: true })
    .click();
  await card
    .getByRole('button', { name: 'Подтвердить отрицательный остаток' })
    .click();
  await expect(
    card.getByText('Текущий баланс: -1,00 RUB', { exact: true }),
  ).toBeVisible();
  const context = await browser.newContext(),
    guest = await context.newPage();
  await signup(guest);
  await guest.goto(page.url());
  await expect(
    guest.getByText('Нет доступа к этому пространству.'),
  ).toBeVisible();
  await expect(guest.getByRole('article')).toHaveCount(0);
  await context.close();
});
