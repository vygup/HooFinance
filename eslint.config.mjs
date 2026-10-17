import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { rules } from './tooling/architecture.mjs';
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'dist/**',
    'build/**',
    'coverage/**',
    'node_modules/**',
    '.agents/**',
    '.specify/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
    '**/*.min.js',
  ]),
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { architecture: { rules } },
    rules: { 'architecture/client-boundary': 'error' },
  },
  {
    files: ['src/modules/*/domain/**/*.ts', 'src/shared/money/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'next',
                'next/**',
                'pg',
                'drizzle-orm',
                'drizzle-orm/**',
                '@/server/**',
                '**/infrastructure/**',
                '**/application/**',
              ],
              message: 'Предметная логика не зависит от UI, HTTP и БД.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSNumberKeyword',
          message:
            'Денежные значения — строки или Decimal; number запрещён в финансовом domain.',
        },
        {
          selector: 'BinaryExpression[operator=/^(\\+|-|\\*|\\/|%|\\*\\*)$/]',
          message:
            'Используйте Decimal для денежных вычислений. Безразмерные календарные вычисления вынесите в shared/calendar.',
        },
        {
          selector:
            'CallExpression[callee.name=/^(Number|parseFloat|parseInt)$/]',
          message: 'Не преобразуйте денежные значения в number.',
        },
        {
          selector: 'CallExpression[callee.property.name="toNumber"]',
          message: 'Не преобразуйте Decimal в number в финансовом domain.',
        },
      ],
    },
  },
]);
