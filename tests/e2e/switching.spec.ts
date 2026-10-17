import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('space selector: explicit context, dirty cancel/confirm, fresh scoped screen and keyboard', async ({
  page,
}, info) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Переключение');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`switch-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Семьи', exact: true }).click();
  const form = page.locator('form').filter({
    has: page.getByRole('heading', { name: 'Новая семья', exact: true }),
  });
  for (const name of ['Семья А', 'Семья Б']) {
    await form.getByLabel('Название новой семьи').fill(name);
    await form.getByRole('button', { name: 'Создать семью' }).click();
    await expect(
      page
        .getByRole('link', { name: `${name} · семейное`, exact: true })
        .first(),
    ).toBeVisible();
  }
  await page.goto('/dashboard');
  const picker = page.getByLabel('Выберите пространство');
  await expect(picker.locator('option')).toHaveCount(4);
  await picker.selectOption({ label: 'Семья А · семейное' });
  await page.getByRole('button', { name: 'Переключить пространство' }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/accounts$/);
  await expect(page.getByLabel('Активное пространство')).toContainText(
    'Семья А · семейное',
  );
  const account = page.getByRole('form', { name: 'Новый счёт' });
  await account
    .getByLabel('Название', { exact: true })
    .fill('Несохранённый счёт');
  await picker.selectOption({ label: 'Семья Б · семейное' });
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Переключить пространство' }).click();
  await expect(account.getByLabel('Название', { exact: true })).toHaveValue(
    'Несохранённый счёт',
  );
  await page.route('**/w/*/accounts', async (route) => {
    if (route.request().method() === 'POST') await route.abort('failed');
    else await route.continue();
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Переключить пространство' }).click();
  await expect(
    page.getByText('Не удалось переключить пространство. Попробуйте ещё раз.'),
  ).toBeVisible();
  await expect(account.getByLabel('Название', { exact: true })).toHaveValue(
    'Несохранённый счёт',
  );
  await page.unroute('**/w/*/accounts');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Переключить пространство' }).click();
  await expect(page.getByLabel('Активное пространство')).toContainText(
    'Семья Б · семейное',
  );
  await expect(account.getByLabel('Название', { exact: true })).toHaveValue('');
  await page.screenshot({
    path: info.outputPath('switching.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await picker.focus();
  await expect(picker).toBeFocused();
  await page
    .getByRole('link', { name: 'Месячный бюджет', exact: true })
    .click();
  await expect(page.getByLabel('Активное пространство')).toContainText(
    'Семья Б · семейное',
  );
});
