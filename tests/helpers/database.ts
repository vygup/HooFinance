export function requireTestDatabase(
  env: Record<string, string | undefined>,
): string {
  const raw = env.TEST_DATABASE_URL;
  if (!raw)
    throw new Error('Задайте TEST_DATABASE_URL для отдельной тестовой БД');
  const url = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]', 'db-test'].includes(url.hostname) ||
    !/^\/finance_test(?:_[a-z0-9_]+)?$/.test(url.pathname)
  )
    throw new Error('Разрешена только отдельная локальная БД finance_test');
  if (env.DATABASE_URL) {
    const app = new URL(env.DATABASE_URL);
    if (
      app.pathname === url.pathname &&
      (app.port || '5432') === (url.port || '5432')
    )
      throw new Error('Тестовая и рабочая БД должны различаться');
  }
  return raw;
}
