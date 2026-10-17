import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
import { invitationLink } from '../helpers/invitation-mail';
import type { Page } from '@playwright/test';
async function signup(page: Page, email: string) {
  await page.goto('/register');
  await page.getByLabel('Отображаемое имя').fill('Участник');
  await page.getByLabel('Электронная почта', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL('/dashboard');
}
test('Семья: письмо → регистрация адресата → принятие → передача → выход → удаление и экспорт', async ({
  page,
  browser,
}, testInfo) => {
  await signup(page, `owner-${randomUUID()}@example.org`);
  await page.getByRole('link', { name: 'Семьи', exact: true }).click();
  await page.getByLabel('Название новой семьи').fill('Наша семья');
  await page
    .getByRole('button', { name: 'Создать семью', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Наша семья', exact: true }),
  ).toBeVisible();
  const email = `guest-${randomUUID()}@example.org`;
  await page.getByLabel('Почта приглашённого').fill(email);
  await page.getByRole('button', { name: 'Пригласить', exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const link = await invitationLink(email);
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await signup(guest, email);
  await guest.goto(link);
  await guest
    .getByRole('button', { name: 'Принять приглашение', exact: true })
    .click();
  await expect(guest.getByRole('status')).toContainText('Принято');
  await guest.getByRole('link', { name: 'Перейти к семьям' }).click();
  await expect(
    guest.getByRole('heading', { name: 'Наша семья', exact: true }),
  ).toBeVisible();
  await expect(guest.getByLabel('Почта приглашённого')).toHaveCount(0);
  await page.reload();
  await page.getByLabel('Новый владелец').selectOption({ label: email });
  await page
    .getByRole('button', { name: 'Предложить передачу', exact: true })
    .click();
  await expect(
    page.getByText('Передача владения ожидает подтверждения.'),
  ).toBeVisible();
  await guest.reload();
  await guest
    .getByRole('button', { name: 'Принять владение', exact: true })
    .click();
  await expect(
    guest.getByText('Ваша роль: владелец', { exact: false }),
  ).toBeVisible();
  await page.reload();
  page.once('dialog', (d) => d.accept());
  await page
    .getByRole('button', { name: 'Покинуть семью', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Наша семья', exact: true }),
  ).toHaveCount(0);
  await guest.reload();
  guest.once('dialog', (d) => d.accept());
  await guest
    .getByRole('button', { name: 'Удалить семью', exact: true })
    .click();
  await expect(
    guest.getByRole('heading', { name: 'Удалённые семьи' }),
  ).toBeVisible();
  await guest.getByRole('link', { name: 'Просмотреть историю' }).click();
  await expect(
    guest.getByRole('heading', { name: 'Сохранённая история' }),
  ).toBeVisible();
  await expect(guest.getByText('Операций пока нет.')).toBeVisible();
  const download = guest.waitForEvent('download');
  await guest.getByRole('link', { name: 'Экспорт CSV' }).click();
  expect((await download).suggestedFilename()).toBe('family-history.csv');
  await guest.screenshot({
    path: testInfo.outputPath('deleted-family.png'),
    fullPage: true,
  });
  expect(
    await guest.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await guestContext.close();
});
test('Ошибки создания сохраняют ввод; owner не может выйти, отмена удаления сохраняет семью', async ({
  page,
}) => {
  await signup(page, `family-${randomUUID()}@example.org`);
  await page.goto('/families');
  await page
    .getByRole('button', { name: 'Создать семью', exact: true })
    .click();
  await expect(page.getByLabel('Название новой семьи')).toBeFocused();
  await page.getByLabel('Название новой семьи').fill('Одна семья');
  await page
    .getByRole('button', { name: 'Создать семью', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Одна семья', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Покинуть семью', exact: true }),
  ).toHaveCount(0);
  page.once('dialog', (d) => d.dismiss());
  await page
    .getByRole('button', { name: 'Удалить семью', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Одна семья', exact: true }),
  ).toBeVisible();
});
