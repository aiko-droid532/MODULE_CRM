import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

// ================================================================
// POST /api/integration/crmasgroup/import-units
// Забирает помещения ЖК Park Boulevard из ERP застройщика (AS Group) и
// импортирует/обновляет их в "Unit". В отличие от sync-units (пуш с сайта),
// здесь МЫ инициируем запрос — вызывается вручную или по расписанию (крон).
// ================================================================

const SOURCE = 'crmasgroup.ge';
const PROJECT_CODE = 'parkboulevard-ge';
const CRM_API_BASE = 'https://crmasgroup.ge/rest/product/getProduct.php';
const DEFAULT_BUILDINGS = [1, 2, 3]; // Полный список зданий пока не подтверждён застройщиком

// Известные статусы AS Group -> наш UnitStatus. Список НЕПОЛНЫЙ — на выборке 700+
// помещений встречены только эти два значения, "продано"/"забронировано" ни разу
// не попались. Незнакомый статус НЕ угадываем — попадает в skippedStatus, а само
// помещение при первом создании временно ставим в EXCLUDED (не "свободно"!), чтобы
// не показать как доступное то, что может быть уже продано.
const STATUS_MAP: Record<string, string> = {
  'თავისუფალი': 'FREE', // "свободно" на грузинском
  'NFS': 'SERVICE',      // Not For Sale — тех. помещения (кладовки, офисы застройщика)
};
const UNKNOWN_STATUS_FALLBACK = 'EXCLUDED';

interface CrmProduct {
  ID: string;
  NAME: string;
  STATUS: string;
  PROJECT: string;
  PRODUCT_TYPE: string;
  FLOOR: string;
  NUMBER: string;
  CORPS: string;
  ENTRANCE: string;
  BUILDING: string;
  FULL_PART: string;
  LIVING_SPACE: string;
  BALCONY_PART: string;
  TERRACE_AREA: string;
  YARDAREA: string;
  NUMBOFROOMS: string;
  NUMBOFBATHROOMS: string;
  NUMOFBEDROOMS: string;
  KVM_PRICE: string;
  KVM_PRICE_GEL: string;
  TOTAL_PRICE: string;
  RETAIL_PRICE: string;
  RETAIL_PRICE_GEL: string;
  CADASTRAL_CODE: string;
  VIEW: string;
  OWNER_DEAL: string;
  OWNER_CONTACT: string;
  OWNER_COMPANY: string;
  DEAL_RESPONSIBLE: string;
  projEndDate: string;
}

function numOrNull(v: string | undefined | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(v: string | undefined | null): string | null {
  return v != null && v !== '' ? v : null;
}

// AS Group отдаёт дату в формате DD/MM/YYYY — обычный new Date() перепутает
// день и месяц (JS по умолчанию считает MM/DD/YYYY).
function parseDDMMYYYY(v: string | undefined | null): Date | null {
  if (!v) return null;
  const parts = v.split('/').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
  const [day, month, year] = parts;
  return new Date(year, month - 1, day);
}

export async function POST(req: NextRequest) {
  const orgId = process.env.DEFAULT_ORGANIZATION_ID || 'default';

  try {
    const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('apiKey');
    const expectedKey = process.env.INTEGRATION_API_KEY || 'pb-secret-token';
    if (apiKey !== expectedKey) {
      return NextResponse.json({ success: false, error: 'Unauthorized. Invalid API Key.' }, { status: 401 });
    }

    const crmToken = process.env.CRMASGROUP_API_TOKEN;
    if (!crmToken) {
      return NextResponse.json({ success: false, error: 'CRMASGROUP_API_TOKEN is not configured on the server.' }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const buildings: number[] = Array.isArray(body?.buildings) && body.buildings.length ? body.buildings : DEFAULT_BUILDINGS;

    // 1. Проект "Park Boulevard"
    let projectId: string;
    const existingProject: any[] = await prisma.$queryRaw`
      SELECT id FROM "Project" WHERE "organizationId" = ${orgId} AND code = ${PROJECT_CODE} LIMIT 1
    `;
    if (existingProject.length > 0) {
      projectId = existingProject[0].id;
    } else {
      const createdProject: any[] = await prisma.$queryRaw`
        INSERT INTO "Project" ("id", "name", "nameKa", "nameRu", "nameEn", "code", "organizationId", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), 'Park Boulevard', 'Park Boulevard', 'Park Boulevard', 'Park Boulevard', ${PROJECT_CODE}, ${orgId}, NOW(), NOW())
        ON CONFLICT ("organizationId", code) DO UPDATE SET "updatedAt" = NOW()
        RETURNING id
      `;
      projectId = createdProject[0].id;
    }

    // 2. Резолвинг корпуса: AS Group режет здание на BUILDING (1,2,3...) + CORPS (A,B,C...).
    // У нас нет отдельной сущности "здание", поэтому кодируем оба уровня в Block.code как "1-A".
    // Дату сдачи (projEndDate) кладём в Block.expectedCommissioningDate — оттуда же на выдаче
    // (georgia/units) считаем статус здания: дата в будущем -> "in progress", в прошлом -> "completed".
    const blockIdByCode = new Map<string, string>();
    async function resolveBlockId(building: string, corps: string, commissioningDate: Date | null): Promise<string> {
      const code = `${building}-${corps || 'A'}`;
      if (blockIdByCode.has(code)) return blockIdByCode.get(code)!;
      const existing: any[] = await prisma.$queryRaw`
        SELECT id FROM "Block" WHERE "projectId" = ${projectId} AND code = ${code} LIMIT 1
      `;
      let blockId: string;
      if (existing.length > 0) {
        blockId = existing[0].id;
        if (commissioningDate) {
          await prisma.$executeRaw`
            UPDATE "Block" SET "expectedCommissioningDate" = ${commissioningDate}, "updatedAt" = NOW() WHERE id = ${blockId}
          `;
        }
      } else {
        const createdBlock: any[] = await prisma.$queryRaw`
          INSERT INTO "Block" ("id", "number", "code", "buildingNumber", "expectedCommissioningDate", "projectId", "organizationId", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), ${corps || 'A'}, ${code}, ${building}, ${commissioningDate}, ${projectId}, ${orgId}, NOW(), NOW())
          ON CONFLICT ("projectId", code) DO UPDATE SET "number" = EXCLUDED."number", "expectedCommissioningDate" = EXCLUDED."expectedCommissioningDate", "updatedAt" = NOW()
          RETURNING id
        `;
        blockId = createdBlock[0].id;
      }
      blockIdByCode.set(code, blockId);
      return blockId;
    }

    let created = 0;
    let updated = 0;
    let fetchedTotal = 0;
    const errors: { id: string; error: string }[] = [];
    const skippedStatus: { id: string; status: string }[] = [];

    for (const building of buildings) {
      let products: CrmProduct[] = [];
      try {
        const res = await fetch(`${CRM_API_BASE}?building=${building}`, {
          headers: { Authorization: `Bearer ${crmToken}` },
          signal: AbortSignal.timeout(20000),
        });
        const data = await res.json();
        if (data?.status !== 200 || !Array.isArray(data?.result)) {
          errors.push({ id: `building-${building}`, error: data?.error || data?.message || 'Unexpected response shape from AS Group API' });
          continue;
        }
        products = data.result;
      } catch (e: any) {
        errors.push({ id: `building-${building}`, error: 'Fetch failed: ' + e.message });
        continue;
      }

      fetchedTotal += products.length;

      for (const p of products) {
        const externalId = String(p.ID);
        try {
          const mappedStatus = STATUS_MAP[p.STATUS];
          if (!mappedStatus) {
            skippedStatus.push({ id: externalId, status: p.STATUS });
          }

          const blockId = await resolveBlockId(p.BUILDING, p.CORPS, parseDDMMYYYY(p.projEndDate));

          // NUMBOFROOMS у них — не всегда число: видели "Storage", "Office", "1".."4".
          const roomsNum = numOrNull(p.NUMBOFROOMS);
          const type = roomsNum != null ? 'Apartment' : (strOrNull(p.NUMBOFROOMS) || 'Apartment');

          const area = numOrNull(p.FULL_PART) ?? 0;
          const floor = numOrNull(p.FLOOR) ?? 0;

          const existingUnit: any[] = await prisma.$queryRaw`
            SELECT id FROM "Unit" WHERE "externalId" = ${externalId} AND "externalSource" = ${SOURCE} LIMIT 1
          `;

          if (existingUnit.length > 0) {
            // Цену/статус, как и у sync-units, НЕ трогаем при обновлении — ими управляет
            // менеджер в CRM (бронь, продажа). AS Group здесь источник только для
            // описательных/административных полей.
            await prisma.$executeRaw`
              UPDATE "Unit" SET
                "number" = ${p.NUMBER},
                "floor" = ${floor},
                "area" = ${area},
                "livingArea" = ${numOrNull(p.LIVING_SPACE)},
                "balconyArea" = ${numOrNull(p.BALCONY_PART)},
                "terraceArea" = ${numOrNull(p.TERRACE_AREA)},
                "yardArea" = ${numOrNull(p.YARDAREA)},
                "rooms" = ${roomsNum},
                "type" = ${type},
                "entrance" = ${numOrNull(p.ENTRANCE)},
                "bathroomsCount" = ${numOrNull(p.NUMBOFBATHROOMS)},
                "bedroomsCount" = ${numOrNull(p.NUMOFBEDROOMS)},
                "pricePerSqm" = ${numOrNull(p.KVM_PRICE)},
                "pricePerSqmGel" = ${numOrNull(p.KVM_PRICE_GEL)},
                "retailPrice" = ${numOrNull(p.RETAIL_PRICE)},
                "retailPriceGel" = ${numOrNull(p.RETAIL_PRICE_GEL)},
                "cadastralCode" = ${strOrNull(p.CADASTRAL_CODE)},
                "viewType" = ${strOrNull(p.VIEW)},
                "ownerDeal" = ${strOrNull(p.OWNER_DEAL)},
                "ownerContact" = ${strOrNull(p.OWNER_CONTACT)},
                "ownerCompany" = ${strOrNull(p.OWNER_COMPANY)},
                "dealResponsible" = ${strOrNull(p.DEAL_RESPONSIBLE)},
                "blockId" = ${blockId},
                "version" = "version" + 1,
                "updatedAt" = NOW()
              WHERE id = ${existingUnit[0].id}
            `;
            updated++;
          } else {
            await prisma.$executeRaw`
              INSERT INTO "Unit" (
                "id", "number", "floor", "area", "livingArea", "balconyArea", "terraceArea", "yardArea",
                "rooms", "type", "entrance", "bathroomsCount", "bedroomsCount",
                "price", "pricePerSqm", "pricePerSqmGel", "retailPrice", "retailPriceGel",
                "status", "cadastralCode", "viewType",
                "ownerDeal", "ownerContact", "ownerCompany", "dealResponsible",
                "blockId", "organizationId", "externalId", "externalSource", "version", "createdAt", "updatedAt"
              ) VALUES (
                gen_random_uuid(), ${p.NUMBER}, ${floor}, ${area}, ${numOrNull(p.LIVING_SPACE)}, ${numOrNull(p.BALCONY_PART)}, ${numOrNull(p.TERRACE_AREA)}, ${numOrNull(p.YARDAREA)},
                ${roomsNum}, ${type}, ${numOrNull(p.ENTRANCE)}, ${numOrNull(p.NUMBOFBATHROOMS)}, ${numOrNull(p.NUMOFBEDROOMS)},
                ${numOrNull(p.TOTAL_PRICE) ?? 0}, ${numOrNull(p.KVM_PRICE)}, ${numOrNull(p.KVM_PRICE_GEL)}, ${numOrNull(p.RETAIL_PRICE)}, ${numOrNull(p.RETAIL_PRICE_GEL)},
                ${(mappedStatus || UNKNOWN_STATUS_FALLBACK)}::"UnitStatus", ${strOrNull(p.CADASTRAL_CODE)}, ${strOrNull(p.VIEW)},
                ${strOrNull(p.OWNER_DEAL)}, ${strOrNull(p.OWNER_CONTACT)}, ${strOrNull(p.OWNER_COMPANY)}, ${strOrNull(p.DEAL_RESPONSIBLE)},
                ${blockId}, ${orgId}, ${externalId}, ${SOURCE}, 1, NOW(), NOW()
              )
            `;
            created++;
          }

          await prisma.$executeRaw`
            INSERT INTO "ExternalIntegration" ("id", "source", "entityType", "externalId", "internalId", "syncStatus", "rawData", "organizationId", "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), ${SOURCE}, 'UNIT', ${externalId}, NULL, 'SYNCED', ${JSON.stringify(p)}::jsonb, ${orgId}, NOW(), NOW())
            ON CONFLICT ("source", "externalId", "entityType") DO UPDATE SET
              "syncStatus" = 'SYNCED', "errorMessage" = NULL, "rawData" = EXCLUDED."rawData", "lastSyncAt" = NOW(), "updatedAt" = NOW()
          `;
        } catch (unitError: any) {
          console.error(`[crmasgroup/import-units] Error processing product ${externalId}:`, unitError);
          errors.push({ id: externalId, error: unitError.message });
        }
      }
    }

    revalidatePath('/shakhmatka');

    return NextResponse.json({
      success: true,
      buildings,
      fetchedTotal,
      created,
      updated,
      skippedStatus,
      errors,
    });
  } catch (error: any) {
    console.error('[integration/crmasgroup/import-units] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error: ' + error.message }, { status: 500 });
  }
}
