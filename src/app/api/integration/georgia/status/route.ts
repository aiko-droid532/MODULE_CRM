import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// ================================================================
// GET    /api/integration/georgia/status  — статус интеграции для страницы /integration
// DELETE /api/integration/georgia/status  — очистка журнала WebhookLog
//
// Middleware (src/middleware.ts) не проверяет ERP-токен для путей /api,
// поэтому здесь этот роут отдаёт данные о лидах (имена/телефоны) — проверяем
// ту же куку auth_token, которой уже защищена сама страница /integration.
// ================================================================

const SOURCE = 'parkboulevard.ge';

async function requireErpAuth(req: NextRequest) {
  const token = req.cookies.get('auth_token')?.value;
  if (!token) return false;
  const result = await verifyToken(token);
  return !!result.payload;
}

export async function GET(req: NextRequest) {
  if (!(await requireErpAuth(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = process.env.DEFAULT_ORGANIZATION_ID || 'default';

  try {
    const leadsTotalRows: any[] = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count FROM "Lead"
      WHERE "externalSource" = ${SOURCE} AND "organizationId" = ${orgId}
    `;
    const lastLeadRows: any[] = await prisma.$queryRaw`
      SELECT id, name, phone, "createdAt", status::text as status FROM "Lead"
      WHERE "externalSource" = ${SOURCE} AND "organizationId" = ${orgId}
      ORDER BY "createdAt" DESC LIMIT 1
    `;

    const unitsTotalRows: any[] = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count FROM "Unit"
      WHERE "externalSource" = ${SOURCE} AND "organizationId" = ${orgId}
    `;
    const unitsByStatusRows: any[] = await prisma.$queryRaw`
      SELECT status::text as status, COUNT(*)::int as count FROM "Unit"
      WHERE "externalSource" = ${SOURCE} AND "organizationId" = ${orgId}
      GROUP BY status
    `;
    const lastUnitSyncRows: any[] = await prisma.$queryRaw`
      SELECT "lastSyncAt", "syncStatus" FROM "ExternalIntegration"
      WHERE source = ${SOURCE} AND "entityType" = 'UNIT' AND "organizationId" = ${orgId}
      ORDER BY "lastSyncAt" DESC LIMIT 1
    `;

    const webhookStatsRows: any[] = await prisma.$queryRaw`
      SELECT status, COUNT(*)::int as count FROM "WebhookLog"
      WHERE source = ${SOURCE} AND "organizationId" = ${orgId}
      GROUP BY status
    `;
    const webhookLogsRows: any[] = await prisma.$queryRaw`
      SELECT id, "eventType", status, "errorMessage", "resultLeadId", "createdAt", "ipAddress" FROM "WebhookLog"
      WHERE source = ${SOURCE} AND "organizationId" = ${orgId}
      ORDER BY "createdAt" DESC LIMIT 10
    `;
    const syncLogsRows: any[] = await prisma.$queryRaw`
      SELECT id, "entityType", "externalId", "internalId", "syncStatus", "lastSyncAt", "errorMessage" FROM "ExternalIntegration"
      WHERE source = ${SOURCE} AND "organizationId" = ${orgId}
      ORDER BY "lastSyncAt" DESC LIMIT 10
    `;

    return NextResponse.json({
      ok: true,
      webhookUrl: `${req.nextUrl.origin}/api/webhooks/leads`,
      leads: {
        total: leadsTotalRows[0]?.count || 0,
        last: lastLeadRows[0] || null,
      },
      units: {
        total: unitsTotalRows[0]?.count || 0,
        byStatus: unitsByStatusRows,
        lastSync: lastUnitSyncRows[0] || null,
      },
      webhookStats: webhookStatsRows,
      webhookLogs: webhookLogsRows,
      syncLogs: syncLogsRows,
    });
  } catch (error: any) {
    console.error('[integration/georgia/status] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal Server Error: ' + error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await requireErpAuth(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = process.env.DEFAULT_ORGANIZATION_ID || 'default';
  try {
    await prisma.$executeRaw`
      DELETE FROM "WebhookLog" WHERE source = ${SOURCE} AND "organizationId" = ${orgId}
    `;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[integration/georgia/status] DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error: ' + error.message }, { status: 500 });
  }
}
