import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('Перевод: 40000/30000, повтор после потери ответа, минус и dirty guard', async ({
  page,
}, info) => {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Переводы');
  await page
    .getByLabel('Электронная почта', { exact: true })
    .fill(`transfer-${randomUUID()}@example.org`);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Счета личного пространства' }).click();
  const account = page.getByRole('form', { name: 'Новый счёт' });
  for (const [name, balance] of [
    ['Отправитель', '50000'],
    ['Получатель', '20000'],
  ]) {
    await account.getByLabel('Название').fill(name!);
    await account.getByLabel('Начальный остаток').fill(balance!);
    await account.getByRole('button', { name: 'Создать счёт' }).click();
    await expect(
      page.getByRole('heading', { name: name!, exact: true }),
    ).toBeVisible();
  }
  const form = page.getByRole('form', { name: 'Новый перевод' });
  await form.getByRole('button', { name: 'Перевести', exact: true }).click();
  await expect(form.getByLabel('Счёт отправителя')).toBeFocused();
  await form
    .getByLabel('Счёт отправителя')
    .selectOption({ label: 'Личное пространство · Отправитель · RUB' });
  await form
    .getByLabel('Счёт получателя')
    .selectOption({ label: 'Личное пространство · Отправитель · RUB' });
  await form.getByLabel('Сумма списания').fill('10000');
  await form.getByLabel('Сумма зачисления').fill('10000');
  await form.getByLabel('Дата перевода').fill('2026-10-17');
  await form.getByRole('button', { name: 'Перевести', exact: true }).click();
  await expect(form.getByLabel('Счёт получателя')).toBeFocused();
  await form
    .getByLabel('Счёт получателя')
    .selectOption({ label: 'Личное пространство · Получатель · RUB' });
  await page.route(
    page.url(),
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await form.getByRole('button', { name: 'Перевести', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Не удалось сохранить');
  await expect(form.getByLabel('Сумма списания')).toHaveValue('10000');
  await form.getByRole('button', { name: 'Перевести', exact: true }).click();
  await expect(form.getByRole('status')).toHaveText('Перевод сохранён.');
  await expect(
    page.getByText('Текущий баланс: 40 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Текущий баланс: 30 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Общий остаток: 70 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Доходов за месяц нет.')).toBeVisible();
  await expect(page.getByText('Расходов за месяц нет.')).toBeVisible();
  await form.getByLabel('Сумма списания').fill('50000');
  await form.getByLabel('Сумма зачисления').fill('50000');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .getByRole('link', { name: 'Личное пространство · личное' })
    .click();
  await expect(form.getByLabel('Сумма списания')).toHaveValue('50000');
  await form.getByRole('button', { name: 'Перевести', exact: true }).click();
  const warning = form.getByRole('alertdialog');
  await expect(warning).toBeFocused();
  await expect(warning).toContainText('-10 000,00 RUB');
  await warning.getByRole('button', { name: 'Отменить перевод' }).click();
  await expect(
    page.getByText('Текущий баланс: 40 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Перевести', exact: true }).click();
  await warning
    .getByRole('button', { name: 'Подтвердить отрицательный остаток' })
    .click();
  await expect(form.getByRole('status')).toHaveText('Перевод сохранён.');
  await expect(
    page.getByText('Текущий баланс: -10 000,00 RUB', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('transfer.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('Личное ↔ семья: общая история скрывает личные данные, отзыв доступа блокирует открытую форму', async ({
  page,
  browser,
}) => {
  const { invitationLink } = await import('../helpers/invitation-mail');
  const signup = async (p: typeof page, email: string) => {
    await p.goto('/register');
    await p.getByLabel('Отображаемое имя').fill('Участник');
    await p.getByLabel('Электронная почта', { exact: true }).fill(email);
    await p.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
    await p.getByRole('button', { name: 'Создать аккаунт' }).click();
    await expect(p).toHaveURL('/dashboard');
  };
  const add = async (p: typeof page, name: string, balance: string) => {
    const f = p.getByRole('form', { name: 'Новый счёт' });
    await expect(f.getByRole('button', { name: 'Создать счёт' })).toBeEnabled();
    await f.getByLabel('Название').fill(name);
    await f.getByLabel('Начальный остаток').fill(balance);
    await f.getByRole('button', { name: 'Создать счёт' }).click();
    await expect(p.getByRole('heading', { name, exact: true })).toBeVisible();
  };
  await signup(page, `transfer-owner-${randomUUID()}@example.org`);
  await page.goto('/families');
  await page.getByLabel('Название новой семьи').fill('Семья переводов');
  await page
    .getByRole('button', { name: 'Создать семью', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Семья переводов', exact: true }),
  ).toBeVisible();
  const href = await page
    .getByRole('link', { name: 'Семья переводов · семейное' })
    .getAttribute('href');
  const scope = new URL(href!, 'http://127.0.0.1:3100').searchParams.get(
    'workspace',
  )!;
  const email = `transfer-guest-${randomUUID()}@example.org`;
  await page.getByLabel('Почта приглашённого').fill(email);
  await page.getByRole('button', { name: 'Пригласить', exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const link = await invitationLink(email);
  await page.goto(`/w/${scope}/accounts`);
  await add(page, 'Общий счёт', '20000');
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await signup(guest, email);
    await guest
      .getByRole('link', { name: 'Счета личного пространства' })
      .click();
    await add(guest, 'Секретный счёт', '50000');
    const personalUrl = guest.url();
    await guest.goto(link);
    await guest
      .getByRole('button', { name: 'Принять приглашение', exact: true })
      .click();
    await expect(guest.getByRole('status')).toContainText('Принято');
    await guest.goto(personalUrl);
    const form = guest.getByRole('form', { name: 'Новый перевод' });
    await expect(
      form.getByRole('button', { name: 'Перевести', exact: true }),
    ).toBeEnabled();
    await form
      .getByLabel('Счёт отправителя')
      .selectOption({ label: 'Личное пространство · Секретный счёт · RUB' });
    await form
      .getByLabel('Счёт получателя')
      .selectOption({ label: 'Семья переводов · Общий счёт · RUB' });
    await form.getByLabel('Сумма списания').fill('10000');
    await form.getByLabel('Сумма зачисления').fill('10000');
    await form
      .getByLabel('Описание в пространстве отправителя')
      .fill('Личная тайна');
    await form
      .getByLabel('Описание в пространстве получателя')
      .fill('Семейный взнос');
    await form.getByRole('button', { name: 'Перевести', exact: true }).click();
    await expect(form.getByRole('status')).toHaveText('Перевод сохранён.');
    await page.reload();
    await expect(
      page.getByText('Текущий баланс: 30 000,00 RUB', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Семейный взнос', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText('Секретный счёт', { exact: false }),
    ).toHaveCount(0);
    await expect(page.getByText('Личная тайна', { exact: false })).toHaveCount(
      0,
    );
    await expect(
      page
        .getByRole('form', { name: 'Новый перевод' })
        .getByLabel('Счёт отправителя')
        .locator('option')
        .filter({ hasText: 'Секретный счёт' }),
    ).toHaveCount(0);
    await form.getByLabel('Сумма списания').fill('1');
    await form.getByLabel('Сумма зачисления').fill('1');
    await page.goto('/families');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Исключить участника' }).click();
    await expect(
      page.getByText(`${email} · участник`, { exact: true }),
    ).toHaveCount(0);
    await form.getByRole('button', { name: 'Перевести', exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText(
      'Нет доступа к обеим сторонам перевода.',
    );
    await expect(form.getByLabel('Сумма списания')).toHaveValue('1');
    await page.goto(`/w/${scope}/accounts`);
    await expect(
      page.getByText('Текущий баланс: 30 000,00 RUB', { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
