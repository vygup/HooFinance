import { isDatabaseReady } from '@/server/db/readiness';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    if (await isDatabaseReady())
      return Response.json(
        { status: 'ready' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
  } catch {
    /* Публичный endpoint не раскрывает конфигурацию и ошибки БД. */
  }
  return Response.json(
    { status: 'unavailable' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
