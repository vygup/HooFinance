import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  'server-only': fileURLToPath(
    new URL('./tests/helpers/server-only.ts', import.meta.url),
  ),
};
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          clearMocks: true,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 15000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});
