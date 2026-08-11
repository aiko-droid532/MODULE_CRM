import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

// ================================================================
// POST /api/integration/georgia/sync-units
// Принимает базу квартир ЖК Park Boulevard (сайт parkboulevard.ge)
// и синхронизирует её с таблицей Unit (upsert по externalId+externalSource)
// ================================================================

const SOURCE = 'parkboulevard.ge';
const PROJECT_CODE = 'parkboulevard-ge';
const ALLOWED_STATUSES = ['FREE', 'SOLD', 'RESERVATION_ORAL', 'RESERVATION_PAID', 'SERVICE'];

interface IncomingFlat {
  id: string | number;
  number: string;
  floor: number;
  area: number;
  living_area?: number;
  balcony_area?: number;
  rooms?: number;
  type?: string;
  price?: number;
  price_gel?: number;
  status?: string;
  block?: string;
  rooms_detail?: { room_type: string; area: number }[];
}

export async function POST(req: NextRequest) {
  const orgId = process.env.DEFAULT_ORGANIZATION_ID || 'default';

  try {
    // 1. Проверка API ключа
    const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('apiKey');
    const expectedKey = process.env.INTEGRATION_API_KEY || 'pb-secret-token';
    if (apiKey !== expectedKey) {
      return NextResponse.json({ success: false, error: 'Unauthorized. Invalid API Key.' }, { status: 401 });
    }

    const rawBody = await req.json();
    const flats: IncomingFlat[] = Array.isArray(rawBody?.flats) ? rawBody.flats : [];

    if (flats.length === 0) {
      return NextResponse.json({ success: false, error: 'Body must contain a non-empty "flats" array.' }, { status: 400 });
    }

    // 2. Находим или создаём проект "Park Boulevard" для этой организации
    let projectId: string;
    const existingProject: any[] = await prisma.$queryRaw`
      SELECT id FROM "Project" WHERE "organizationId" = ${orgId} AND code = ${PROJECT_CODE} LIMIT 1
    `;
    if (existingProject.length > 0) {
      projectId = existingProject[0].id;
    } else {
      const created: any[] = await prisma.$queryRaw`
        INSERT INTO "Project" ("id", "name", "nameKa", "nameRu", "nameEn", "code", "organizationId", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), 'Park Boulevard', 'Park Boulevard', 'Park Boulevard', 'Park Boulevard', ${PROJECT_CODE}, ${orgId}, NOW(), NOW())
        ON CONFLICT ("organizationId", code) DO UPDATE SET "updatedAt" = NOW()
        RETURNING id
      `;
      projectId = created[0].id;
    }

    // 3. Резолвим блоки (кэшируем в рамках запроса, чтобы не дублировать запросы на каждую квартиру)
    const blockIdByCode = new Map<string, string>();
    async function resolveBlockId(blockCode: string): Promise<string> {
      const code = blockCode || 'A';
      if (blockIdByCode.has(code)) return blockIdByCode.get(code)!;

      const existingBlock: any[] = await prisma.$queryRaw`
        SELECT id FROM "Block" WHERE "projectId" = ${projectId} AND code = ${code} LIMIT 1
      `;
      let blockId: string;
      if (existingBlock.length > 0) {
        blockId = existingBlock[0].id;
      } else {
        const createdBlock: any[] = await prisma.$queryRaw`
          INSERT INTO "Block" ("id", "number", "code", "projectId", "organizationId", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), ${code}, ${code}, ${projectId}, ${orgId}, NOW(), NOW())
          ON CONFLICT ("projectId", code) DO UPDATE SET "updatedAt" = NOW()
          RETURNING id
        `;
        blockId = createdBlock[0].id;
      }
      blockIdByCode.set(code, blockId);
      return blockId;
    }

    // 4. Обрабатываем каждую квартиру
    let created = 0;
    let updated = 0;
    const errors: { id: string; error: string }[] = [];

    for (const flat of flats) {
      const externalId = String(flat.id);
      try {
        if (!externalId || !flat.number || flat.floor == null || flat.area == null) {
          throw new Error('Missing required fields: id, number, floor, area.');
        }

        const blockId = await resolveBlockId(String(flat.block || 'A'));
        const status = ALLOWED_STATUSES.includes(flat.status || '') ? flat.status : 'FREE';

        const existingUnit: any[] = await prisma.$queryRaw`
          SELECT id FROM "Unit" WHERE "externalId" = ${externalId} AND "externalSource" = ${SOURCE} LIMIT 1
        `;

        let unitId: string;
        if (existingUnit.length > 0) {
          unitId = existingUnit[0].id;
          await prisma.$executeRaw`
            UPDATE "Unit" SET
              "number" = ${flat.number},
              "floor" = ${flat.floor},
              "area" = ${flat.area},
              "livingArea" = ${flat.living_area ?? null},
              "balconyArea" = ${flat.balcony_area ?? null},
              "rooms" = ${flat.rooms ?? null},
              "type" = ${flat.type || 'Apartment'},
              "price" = ${flat.price ?? 0},
              "priceGel" = ${flat.price_gel ?? null},
              "status" = ${status}::"UnitStatus",
              "blockId" = ${blockId},
              "version" = "version" + 1,
              "updatedAt" = NOW()
            WHERE id = ${unitId}
          `;
          updated++;
        } else {
          const insertedUnit: any[] = await prisma.$queryRaw`
            INSERT INTO "Unit" (
              "id", "number", "floor", "area", "livingArea", "balconyArea", "rooms", "type",
              "price", "priceGel", "status", "blockId", "organizationId",
              "externalId", "externalSource", "version", "createdAt", "updatedAt"
            ) VALUES (
              gen_random_uuid(), ${flat.number}, ${flat.floor}, ${flat.area}, ${flat.living_area ?? null}, ${flat.balcony_area ?? null},
              ${flat.rooms ?? null}, ${flat.type || 'Apartment'},
              ${flat.price ?? 0}, ${flat.price_gel ?? null}, ${status}::"UnitStatus", ${blockId}, ${orgId},
              ${externalId}, ${SOURCE}, 1, NOW(), NOW()
            )
            RETURNING id
          `;
          unitId = insertedUnit[0].id;
          created++;
        }

        // Экспликация комнат: полностью заменяем на актуальную с сайта
        if (Array.isArray(flat.rooms_detail)) {
          await prisma.$executeRaw`DELETE FROM "UnitRoom" WHERE "unitId" = ${unitId}`;
          for (const room of flat.rooms_detail) {
            await prisma.$executeRaw`
              INSERT INTO "UnitRoom" ("id", "unitId", "roomType", "nameRu", "area", "organizationId", "createdAt")
              VALUES (gen_random_uuid(), ${unitId}, ${room.room_type}, ${room.room_type}, ${room.area}, ${orgId}, NOW())
            `;
          }
        }

        await prisma.$executeRaw`
          INSERT INTO "ExternalIntegration" ("id", "source", "entityType", "externalId", "internalId", "syncStatus", "rawData", "organizationId", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), ${SOURCE}, 'UNIT', ${externalId}, ${unitId}, 'SYNCED', ${JSON.stringify(flat)}::jsonb, ${orgId}, NOW(), NOW())
          ON CONFLICT ("source", "externalId", "entityType") DO UPDATE SET
            "internalId" = EXCLUDED."internalId", "syncStatus" = 'SYNCED', "errorMessage" = NULL,
            "rawData" = EXCLUDED."rawData", "lastSyncAt" = NOW(), "updatedAt" = NOW()
        `;
      } catch (flatError: any) {
        console.error(`[sync-units] Error processing flat ${externalId}:`, flatError);
        errors.push({ id: externalId, error: flatError.message });
        try {
          await prisma.$executeRaw`
            INSERT INTO "ExternalIntegration" ("id", "source", "entityType", "externalId", "syncStatus", "errorMessage", "rawData", "organizationId", "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), ${SOURCE}, 'UNIT', ${externalId}, 'ERROR', ${flatError.message}, ${JSON.stringify(flat)}::jsonb, ${orgId}, NOW(), NOW())
            ON CONFLICT ("source", "externalId", "entityType") DO UPDATE SET
              "syncStatus" = 'ERROR', "errorMessage" = EXCLUDED."errorMessage", "lastSyncAt" = NOW(), "updatedAt" = NOW()
          `;
        } catch (_) {}
      }
    }

    revalidatePath('/shakhmatka');

    return NextResponse.json({
      success: true,
      processed: flats.length,
      created,
      updated,
      errors,
    });
  } catch (error: any) {
    console.error('[integration/georgia/sync-units] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error: ' + error.message }, { status: 500 });
  }
}
