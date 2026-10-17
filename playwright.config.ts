import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import nextEnv from '@next/env';
import { requireTestDatabase } from './tests/helpers/database';
nextEnv.loadEnvConfig(process.cwd(), true);
const testDatabaseUrl = requireTestDatabase(process.env);
process.env.E2E_MAIL_DIR ??= mkdtempSync(join(tmpdir(), 'finance-e2e-mail-'));
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  webServer: {
    env: {
      FINANCE_E2E: 'true',
      DATABASE_URL: testDatabaseUrl,
      APP_ORIGIN: 'http://127.0.0.1:3100',
      BETTER_AUTH_URL: 'http://127.0.0.1:3100',
      E2E_MAIL_DIR: process.env.E2E_MAIL_DIR,
      AUTH_RESET_IP_LIMIT: '100',
      TRUST_PROXY: 'false',
    },
    command: 'node --import tsx tests/helpers/e2e-server.ts',
    url: 'http://127.0.0.1:3100/api/health/live',
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    {
      name: 'desktop-light',
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' },
    },
    {
      name: 'mobile-dark',
      use: { ...devices['Pixel 7'], colorScheme: 'dark' },
    },
  ],
});
