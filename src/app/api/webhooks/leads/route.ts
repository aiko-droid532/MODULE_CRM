import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';
import { addToWaitingListAction } from '@/app/actions/booking';

export const dynamic = 'force-dynamic';

// ================================================================
// POST /api/webhooks/leads
// Принимает заявки с сайта parkboulevard.ge
// Формы: "Запросить звонок", "Получить консультацию", "Book a Tour"
// Поддерживает: прямой JSON, Elementor Forms, Contact Form 7
// ================================================================

export async function POST(req: NextRequest) {
  const orgId = process.env.DEFAULT_ORGANIZATION_ID || 'default';
  let rawBody: any = null;

  try {
    // 1. Проверка API ключа
    const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('apiKey');
    const expectedKey = process.env.INTEGRATION_API_KEY || 'pb-secret-token';

    if (apiKey !== expectedKey) {
      await logWebhook({ source: 'parkboulevard.ge', eventType: 'LEAD_CREATED', status: 'ERROR', errorMessage: 'Unauthorized: Invalid API Key', ipAddress: req.headers.get('x-forwarded-for') || 'unknown', organizationId: orgId });
      return NextResponse.json({ success: false, error: 'Unauthorized. Invalid API Key.' }, { status: 401 });
    }

    // 2. Парсим тело — поддержка разных форматов
    rawBody = await req.json();

    // Универсальный разбор полей (Elementor, CF7, прямой JSON)
    const name     = rawBody.name     || rawBody.fields?.name     || rawBody['your-name']    || rawBody.full_name    || '';
    const phone    = rawBody.phone    || rawBody.fields?.phone    || rawBody['your-phone']   || rawBody.phone_number || '';
    const email    = rawBody.email    || rawBody.fields?.email    || rawBody['your-email']   || null;
    const comment  = rawBody.comment  || rawBody.fields?.message  || rawBody['your-message'] || rawBody.message      || null;
    const language = rawBody.language || 'RU';
    const externalId = rawBody.submission_id ? String(rawBody.submission_id) : (rawBody.id ? String(rawBody.id) : null);

    // Интерес к конкретной квартире (если клиент смотрел квартиру на сайте)
    const flatExternalId = rawBody.flat_id || rawBody.unit_external_id || null;

    if (!name || !phone) {
      await logWebhook({ source: 'parkboulevard.ge', eventType: 'LEAD_CREATED', rawPayload: rawBody, status: 'ERROR', errorMessage: 'Missing required fields: name, phone', ipAddress: req.headers.get('x-forwarded-for') || 'unknown', organizationId: orgId });
      return NextResponse.json({ success: false, error: 'Missing required fields: name, phone.' }, { status: 400 });
    }

    // 3. Проверяем дубль по телефону
    const existingByPhone: any[] = await prisma.$queryRaw`
      SELECT id, name FROM "Lead"
      WHERE phone = ${phone} AND "organizationId" = ${orgId}
      LIMIT 1
    `;
    if (existingByPhone.length > 0) {
      await logWebhook({ source: 'parkboulevard.ge', eventType: 'LEAD_CREATED', rawPayload: rawBody, resultLeadId: existingByPhone[0].id, status: 'DUPLICATE', errorMessage: `Дубль: ${existingByPhone[0].name}`, ipAddress: req.headers.get('x-forwarded-for') || 'unknown', organizationId: orgId });
      return NextResponse.json({ success: true, message: 'Lead already exists (duplicate by phone)', leadId: existingByPhone[0].id, isDuplicate: true });
    }

    // 4. Проверяем дубль по externalId
    if (externalId) {
      const existingByExt: any[] = await prisma.$queryRaw`
        SELECT id FROM "Lead"
        WHERE "externalId" = ${externalId} AND "externalSource" = 'parkboulevard.ge'
        LIMIT 1
      `;
      if (existingByExt.length > 0) {
        await logWebhook({ source: 'parkboulevard.ge', eventType: 'LEAD_CREATED', rawPayload: rawBody, resultLeadId: existingByExt[0].id, status: 'DUPLICATE', errorMessage: `Дубль по externalId: ${externalId}`, ipAddress: req.headers.get('x-forwarded-for') || 'unknown', organizationId: orgId });
        return NextResponse.json({ success: true, message: 'Lead already exists (duplicate by externalId)', leadId: existingByExt[0].id, isDuplicate: true });
      }
    }

    // 5. Ищем квартиру в нашей БД по external flat_id
    let internalUnitId: string | null = null;
    if (flatExternalId) {
      const units: any[] = await prisma.$queryRaw`
        SELECT id FROM "Unit"
        WHERE "externalId" = ${String(flatExternalId)} AND "externalSource" = 'parkboulevard.ge'
        LIMIT 1
      `;
      if (units.length > 0) internalUnitId = units[0].id;
    }

    // 6. Создаём лида напрямую через SQL
    const leadId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "Lead" (
        "id", "name", "phone", "email", "source", "managerNotes",
        "organizationId", "status", "callAttempts", "type",
        "externalId", "externalSource", "language", "comment",
        "createdAt", "updatedAt"
      ) VALUES (
        ${leadId}, ${name}, ${phone}, ${email},
        'parkboulevard.ge',
        ${'Заявка с сайта ЖК Park Boulevard. ' + (comment || '')},
        ${orgId}, 'NEW', 0, 'LEAD',
        ${externalId}, 'parkboulevard.ge',
        ${language}, ${comment},
        NOW(), NOW()
      )
    `;

    // 7. Если знаем квартиру — добавляем в лист ожидания
    if (internalUnitId) {
      try {
        await addToWaitingListAction({ unitId: internalUnitId, leadId, organizationId: orgId });
      } catch (_) {}
    }

    // 8. Логируем в ExternalIntegration (для страницы /integration)
    if (externalId) {
      try {
        await prisma.$executeRaw`
          INSERT INTO "ExternalIntegration" ("id","source","entityType","externalId","internalId","syncStatus","rawData","organizationId","createdAt","updatedAt")
          VALUES (${crypto.randomUUID()},'parkboulevard.ge','LEAD',${externalId},${leadId},'SYNCED',${JSON.stringify(rawBody)}::jsonb,${orgId},NOW(),NOW())
          ON CONFLICT ("source","externalId","entityType") DO UPDATE SET "internalId"=EXCLUDED."internalId","syncStatus"='SYNCED',"lastSyncAt"=NOW(),"updatedAt"=NOW()
        `;
      } catch (_) {}
    }

    // 9. Логируем webhook
    await logWebhook({ source: 'parkboulevard.ge', eventType: 'LEAD_CREATED', rawPayload: rawBody, processedData: { leadId, name, phone }, resultLeadId: leadId, status: 'SUCCESS', ipAddress: req.headers.get('x-forwarded-for') || 'unknown', organizationId: orgId });

    return NextResponse.json({ success: true, message: 'Lead successfully created!', leadId });

  } catch (error: any) {
    console.error('[webhook/leads] Error:', error);
    try {
      await logWebhook({ source: 'parkboulevard.ge', eventType: 'LEAD_CREATED', rawPayload: rawBody, status: 'ERROR', errorMessage: error.message, ipAddress: req.headers.get('x-forwarded-for') || 'unknown', organizationId: orgId });
    } catch (_) {}
    return NextResponse.json({ success: false, error: 'Internal Server Error: ' + error.message }, { status: 500 });
  }
}

// GET — health check / статистика
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('apiKey');
  if (apiKey !== (process.env.INTEGRATION_API_KEY || 'pb-secret-token')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const orgId = process.env.DEFAULT_ORGANIZATION_ID || 'default';
  const stats: any[] = await prisma.$queryRaw`
    SELECT status, COUNT(*) as count FROM "WebhookLog"
    WHERE source='parkboulevard.ge' AND "organizationId"=${orgId} GROUP BY status
  `;
  const last: any[] = await prisma.$queryRaw`
    SELECT "createdAt",status,"eventType","errorMessage" FROM "WebhookLog"
    WHERE source='parkboulevard.ge' AND "organizationId"=${orgId}
    ORDER BY "createdAt" DESC LIMIT 1
  `;
  return NextResponse.json({ ok: true, endpoint: 'POST /api/webhooks/leads', stats, lastActivity: last[0] || null });
}

// ── helpers ──────────────────────────────────────────────────────────────────
async function logWebhook(data: {
  source: string; eventType: string; rawPayload?: any; processedData?: any;
  resultLeadId?: string; status: string; errorMessage?: string;
  ipAddress?: string; organizationId: string;
}) {
  try {
    await prisma.$executeRaw`
      INSERT INTO "WebhookLog"("id","source","eventType","rawPayload","processedData","resultLeadId","status","errorMessage","ipAddress","organizationId","createdAt")
      VALUES(${crypto.randomUUID()},${data.source},${data.eventType},
        ${data.rawPayload ? JSON.stringify(data.rawPayload) : null}::jsonb,
        ${data.processedData ? JSON.stringify(data.processedData) : null}::jsonb,
        ${data.resultLeadId||null},${data.status},${data.errorMessage||null},
        ${data.ipAddress||null},${data.organizationId},NOW())
    `;
  } catch (e) { console.error('[logWebhook]', e); }
}
