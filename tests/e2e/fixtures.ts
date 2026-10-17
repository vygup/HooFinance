import { test as base, expect } from '@playwright/test';
import { createMailFixture } from '../helpers/mail';
// Unit mock для тестов без доставки; browser auth использует приватный SMTP fixture.
export const test = base.extend<{ mail: ReturnType<typeof createMailFixture> }>(
  {
    mail: async ({}, provide) => {
      const mail = createMailFixture();
      await provide(mail);
      mail.clear();
    },
  },
);
export { expect };
