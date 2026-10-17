import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';
loadEnvConfig(process.cwd());
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/*.ts',
  out: './src/server/db/migrations',
  strict: true,
  verbose: false,
});
