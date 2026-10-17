import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { test, expect } from './fixtures';
import { requireTestDatabase } from '../helpers/database';
import type { Page } from '@playwright/test';
const password = 'StrongPassword123!';
async function signup(page: Page, email: string) {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Анна');
  await page.getByLabel('Электронная почта', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
}
async function resetLink(email: string) {
  let link = '';
  await expect
    .poll(async () => {
      try {
        const file = join(
          process.env.E2E_MAIL_DIR!,
          createHash('sha256').update(email).digest('hex') + '.json',
        );
        const { source } = JSON.parse(await readFile(file, 'utf8')) as {
          source: string;
        };
        const [head, ...body] = source.split('\r\n\r\n');
        let text = body.join('\r\n\r\n');
        if (/Content-Transfer-Encoding: base64/i.test(head!))
          text = Buffer.from(text, 'base64').toString('utf8');
        else
          text = text
            .replace(/=\r\n/g, '')
            .replace(/=([A-F0-9]{2})/g, (_, hex: string) =>
              String.fromCharCode(Number.parseInt(hex, 16)),
            );
        link = text.match(/https?:\/\/[^\s]+/)?.[0] ?? '';
        return !!link;
      } catch {
        return false;
      }
    })
    .toBe(true);
  return link;
}
test('Регистрация → профиль → выход → вход → письмо восстановления → новый пароль', async ({
  page,
}, testInfo) => {
  const email = `browser-${randomUUID()}@example.org`;
  await signup(page, email);
  await expect(
    page.getByRole('heading', { name: 'Личное пространство', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Доступные пространства')).toContainText(
    'Доступно только вам',
  );
  await page.getByRole('link', { name: 'Профиль', exact: true }).click();
  await page.getByLabel('Отображаемое имя').fill('Анна Обновлённая');
  await page.getByLabel('Локаль', { exact: true }).fill('en-US');
  await page.getByLabel('Часовой пояс', { exact: true }).fill('Asia/Tokyo');
  await page.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect(page.getByRole('status')).toHaveText('Профиль сохранён.');
  await page.getByLabel('Отображаемое имя').fill('Несохранённое имя');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .getByRole('link', { name: 'Личное пространство', exact: true })
    .click();
  await expect(page).toHaveURL('/profile');
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue(
    'Несохранённое имя',
  );
  await page.getByLabel('Отображаемое имя').fill('Анна Обновлённая');
  await page.screenshot({
    path: testInfo.outputPath('profile.png'),
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue(
    'Анна Обновлённая',
  );
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toHaveValue(
    'Asia/Tokyo',
  );
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await page.goto('/profile');
  await expect(page).toHaveURL('/login');
  await page.goto('/dashboard');
  await expect(page).toHaveURL('/login');
  await page.getByLabel('Электронная почта', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await page.getByRole('link', { name: 'Забыли пароль?' }).click();
  await expect(page).toHaveURL('/forgot-password');
  await page.getByLabel('Электронная почта', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Отправить ссылку' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Если эта почта зарегистрирована',
  );
  const link = await resetLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await page
    .getByLabel('Новый пароль', { exact: true })
    .fill('NewStrongPassword123!');
  await page.getByRole('button', { name: 'Сохранить новый пароль' }).click();
  await expect(page.getByRole('status')).toContainText('Пароль изменён');
  await page.getByRole('link', { name: 'Перейти ко входу' }).click();
  await page.getByLabel('Электронная почта', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Неверная почта или пароль',
  );
  await page
    .getByLabel('Пароль', { exact: true })
    .fill('NewStrongPassword123!');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.goto(link);
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Ссылка недействительна',
  );
});
test('Повторная почта и ошибки формы сохраняют ввод; клавиатура и мобильная ширина', async ({
  page,
}) => {
  const email = `duplicate-${randomUUID()}@example.org`;
  await signup(page, email);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await page.goto('/register');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByLabel('Отображаемое имя')).toBeFocused();
  await page.getByLabel('Отображаемое имя').fill('Повтор');
  await page.getByLabel('Электронная почта', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Не удалось зарегистрироваться',
  );
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Повтор');
  await expect(page.locator('main').getByRole('alert')).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test('Stale profile сохраняет ввод и предлагает явную перезагрузку; expired/invalid reset видимы', async ({
  page,
  context,
}) => {
  const email = `stale-${randomUUID()}@example.org`;
  await signup(page, email);
  await page.goto('/profile');
  const other = await context.newPage();
  await other.goto('/profile');
  await other.getByLabel('Отображаемое имя').fill('Другая вкладка');
  await other.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect(other.getByRole('status')).toContainText('Профиль сохранён');
  await page.getByLabel('Отображаемое имя').fill('Мой несохранённый ввод');
  await page.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Профиль уже изменён',
  );
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue(
    'Мой несохранённый ввод',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Загрузить актуальный профиль' })
    .click();
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue(
    'Другая вкладка',
  );
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await page.goto('/forgot-password');
  await page.getByLabel('Электронная почта', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Отправить ссылку' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  const link = await resetLink(email);
  const pool = new Pool({ connectionString: requireTestDatabase(process.env) });
  try {
    await pool.query(
      'UPDATE verification SET expires_at = now() - interval \'1 second\' WHERE value = (SELECT id FROM "user" WHERE email = $1)',
      [email],
    );
  } finally {
    await pool.end();
  }
  await page.goto(link);
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Ссылка недействительна',
  );
  await page.goto('/reset-password?token=invalid-token');
  await page.getByLabel('Новый пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Сохранить новый пароль' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Ссылка недействительна',
  );
  await expect(
    page.getByRole('link', { name: 'Запросить новую ссылку' }),
  ).toBeVisible();
});

test('Регистрация без JavaScript использует POST, создаёт сессию и открывает кабинет', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await signup(page, `native-${randomUUID()}@example.org`);
    await expect(
      page.getByRole('heading', { name: 'Личное пространство', exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
  } finally {
    await context.close();
  }
});
