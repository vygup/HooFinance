import { expect, test, vi } from 'vitest';
vi.mock('@/server/db/readiness', () => ({ isDatabaseReady: vi.fn() }));
import { isDatabaseReady } from '@/server/db/readiness';
import { GET } from '@/app/api/health/ready/route';
test('Readiness закрыт при недоступной или отставшей схеме и не раскрывает ошибки', async () => {
  vi.mocked(isDatabaseReady).mockResolvedValue(false);
  expect((await GET()).status).toBe(503);
  vi.mocked(isDatabaseReady).mockRejectedValue(
    new Error('secret connection string'),
  );
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: 'unavailable' });
  vi.mocked(isDatabaseReady).mockResolvedValue(true);
  expect((await GET()).status).toBe(200);
});
