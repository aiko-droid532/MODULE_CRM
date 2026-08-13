'use server';

import { db as prisma, Prisma } from '@/lib/db';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { logAction } from '@/lib/logger';
import { requireRole, canManageUnits, canManagePrices } from '@/lib/roles';

// Получить все проекты организации
export async function getProjects(organizationId: string) {
  noStore();
  const projects: any[] = await prisma.$queryRaw`
    SELECT
      p.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', b.id,
            'number', b.number,
            'projectId', b."projectId",
            'organizationId', b."organizationId",
            'units', (
              SELECT COALESCE(
                json_agg(
                  json_build_object(
                    'id', u.id,
                    'number', u.number,
                    'floor', u.floor,
                    'area', u.area,
                    'price', u.price,
                    'status', u.status,
                    'blockId', u."blockId",
                    'organizationId', u."organizationId",
                    'rooms', u.rooms,
                    'type', u.type,
                    'livingArea', u."livingArea",
                    'viewType', u."viewType",
                    'version', u.version,
                    'isVip', u."isVip",
                    'thinkingFlag', u."thinkingFlag",
                    'entrance', u."entrance",
                    'balconyArea', u."balconyArea",
                    'contractNumber', u."contractNumber",
                    'deliveryYear', u."deliveryYear",
                    'deliveryMonth', u."deliveryMonth",
                    'deliveryDate', u."deliveryDate",
                    'registeredInPublicRegistry', u."registeredInPublicRegistry",
                    'availableForSale', u."availableForSale",
                    'pricePerSqmVAT', u."pricePerSqmVAT",
                    'bookingExpiresAt', (
                      SELECT bk."expiresAt"
                      FROM "Booking" bk
                      WHERE bk."unitId" = u.id AND bk.status = 'ACTIVE'
                      LIMIT 1
                    ),
                    'associatedLeadId', COALESCE(
                      (
                        SELECT bk."leadId"
                        FROM "Booking" bk
                        WHERE bk."unitId" = u.id AND bk.status = 'ACTIVE'
                        LIMIT 1
                      ),
                      (
                        SELECT dl."leadId"
                        FROM "Deal" dl
                        WHERE dl."unitId" = u.id AND dl.status::text NOT IN ('FAILED', 'CANCELLED')
                        ORDER BY dl."createdAt" DESC
                        LIMIT 1
                      )
                    ),
                    'associatedLeadName', COALESCE(
                      (
                        SELECT ld.name
                        FROM "Booking" bk
                        JOIN "Lead" ld ON bk."leadId" = ld.id
                        WHERE bk."unitId" = u.id AND bk.status = 'ACTIVE'
                        LIMIT 1
                      ),
                      (
                        SELECT ld.name
                        FROM "Deal" dl
                        JOIN "Lead" ld ON dl."leadId" = ld.id
                        WHERE dl."unitId" = u.id AND dl.status::text NOT IN ('FAILED', 'CANCELLED')
                        ORDER BY dl."createdAt" DESC
                        LIMIT 1
                      )
                    )
                  ) ORDER BY u.floor DESC, u.number ASC
                ),
                '[]'::json
              )
              FROM "Unit" u WHERE u."blockId" = b.id
            )
          ) ORDER BY b.number ASC
        ) FILTER (WHERE b.id IS NOT NULL), '[]'::json
      ) as blocks
    FROM "Project" p
    LEFT JOIN "Block" b ON b."projectId" = p.id
    WHERE p."organizationId" = ${organizationId}
    GROUP BY p.id
  `;
  return projects;
}

// Создать тестовый жилой комплекс для проверки
export async function createDemoProject(organizationId: string) {
  try {
    logAction('Создание тестового ЖК "Астана Тауэр" со всеми блоками и квартирами', { organizationId });
    const projects: any[] = await prisma.$queryRaw`
      INSERT INTO "Project" ("id", "name", "address", "organizationId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'ЖК "Астана Тауэр"', 'пр. Мангилик Ел, 25', ${organizationId}, NOW(), NOW())
      RETURNING id
    `;
    const projectId = projects[0].id;

    const blocks: any[] = await prisma.$queryRaw`
      INSERT INTO "Block" ("id", "number", "projectId", "organizationId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'Блок А', ${projectId}, ${organizationId}, NOW(), NOW())
      RETURNING id
    `;
    const blockId = blocks[0].id;

    // 3 этажа по 4 квартиры
    const units = [
      { number: '101', floor: 1, area: 45.5, price: 180000, status: 'FREE' },
      { number: '102', floor: 1, area: 65.2, price: 250000, status: 'RESERVATION_PAID' },
      { number: '103', floor: 1, area: 45.5, price: 180000, status: 'FREE' },
      { number: '104', floor: 1, area: 85.0, price: 350000, status: 'SOLD' },
      
      { number: '201', floor: 2, area: 45.5, price: 185000, status: 'FREE' },
      { number: '202', floor: 2, area: 65.2, price: 255000, status: 'FREE' },
      { number: '203', floor: 2, area: 45.5, price: 185000, status: 'RESERVATION_ORAL' },
      { number: '204', floor: 2, area: 85.0, price: 355000, status: 'FREE' },
      
      { number: '301', floor: 3, area: 45.5, price: 190000, status: 'SOLD' },
      { number: '302', floor: 3, area: 65.2, price: 260000, status: 'FREE' },
      { number: '303', floor: 3, area: 45.5, price: 190000, status: 'FREE' },
      { number: '304', floor: 3, area: 85.0, price: 360000, status: 'FREE' }
    ];

    for (const unit of units) {
      await prisma.$executeRaw`
        INSERT INTO "Unit" ("id", "number", "floor", "area", "price", "status", "blockId", "organizationId", "createdAt", "updatedAt", "rooms", "type")
        VALUES (gen_random_uuid(), ${unit.number}, ${unit.floor}, ${unit.area}, ${unit.price}, ${unit.status}, ${blockId}, ${organizationId}, NOW(), NOW(), 1, 'Apartment')
      `;
    }

    revalidatePath('/shakhmatka');
    return { success: true, project: { id: projectId } };
  } catch (error) {
    console.error('Seed error:', error);
    return { success: false, error: 'Failed to create demo project' };
  }
}

// Массовое изменение цен на квартиры (CAT-007)
export async function massUpdatePrices(data: {
  projectId: string;
  blockId?: string;
  rooms?: string;
  changeType: 'PERCENT' | 'FIXED';
  changeValue: number;
  reason: string;
  organizationId: string;
  initiatorId: string;
}) {
  try {
    await requireRole(canManagePrices, 'массовое изменение цен');
    logAction('Массовое изменение цен на квартиры', { projectId: data.projectId, blockId: data.blockId, changeType: data.changeType, changeValue: data.changeValue, reason: data.reason });
    const { projectId, blockId, rooms, changeType, changeValue, reason, organizationId, initiatorId } = data;

    // 1. Получаем список квартир, соответствующих фильтрам
    let selectQuery = `
      SELECT u.id, u.price 
      FROM "Unit" u
      JOIN "Block" b ON u."blockId" = b.id
      WHERE b."projectId" = $1 AND u."organizationId" = $2 AND u."status" != 'SOLD'::"UnitStatus"
    `;
    const params: any[] = [projectId, organizationId];

    if (blockId) {
      params.push(blockId);
      selectQuery += ` AND u."blockId" = $${params.length}`;
    }
    if (rooms && rooms !== 'ALL') {
      params.push(parseInt(rooms));
      selectQuery += ` AND u."rooms" = $${params.length}`;
    }

    const { pool } = require('@/lib/db');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const res = await client.query(selectQuery, params);
      const units = res.rows;

      if (units.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: 'Не найдено подходящих квартир для обновления' };
      }

      // 2. Для каждой квартиры обновляем цену и вносим запись в PriceHistory
      for (const unit of units) {
        const oldPrice = unit.price;
        let newPrice = oldPrice;

        if (changeType === 'PERCENT') {
          newPrice = Math.round(oldPrice * (1 + changeValue / 100));
        } else {
          newPrice = oldPrice + changeValue;
        }

        if (newPrice < 0) newPrice = 0;

        // Обновляем Unit
        await client.query(
          `UPDATE "Unit" SET "price" = $1, "updatedAt" = NOW(), "version" = "version" + 1 WHERE "id" = $2`,
          [newPrice, unit.id]
        );

        // Пишем лог
        const historyId = crypto.randomUUID();
        await client.query(
          `INSERT INTO "PriceHistory" ("id", "unitId", "oldPrice", "newPrice", "currency", "initiatorId", "reason", "organizationId", "createdAt")
           VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7, NOW())`,
          [historyId, unit.id, oldPrice, newPrice, initiatorId, reason, organizationId]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    revalidatePath('/shakhmatka');
    return { success: true, count: data.changeValue };
  } catch (error) {
    console.error('Mass price update error:', error);
    return { success: false, error: 'SERVER_ERROR', message: 'Ошибка при массовом обновлении цен в БД' };
  }
}

// Получить историю цен для квартиры (CAT-006)
export async function getPriceHistory(unitId: string) {
  try {
    const history: any[] = await prisma.$queryRaw`
      SELECT ph.*, m.name as "initiatorName"
      FROM "PriceHistory" ph
      LEFT JOIN "Manager" m ON ph."initiatorId" = m.id
      WHERE ph."unitId" = ${unitId}
      ORDER BY ph."createdAt" DESC
    `;
    return history;
  } catch (error) {
    console.error('getPriceHistory error:', error);
    return [];
  }
}

// ========== CAT-004: CRUD для Помещения ==========

// Создание новой квартиры
export async function createUnit(data: {
  number: string;
  floor: number;
  area: number;
  rooms: number;
  price: number;
  type: string;
  viewType?: string;
  livingArea?: number;
  layoutUrl?: string;
  layout3dUrl?: string;
  balconyArea?: number;
  contractNumber?: string;
  deliveryYear?: number;
  deliveryMonth?: number;
  deliveryDate?: string;
  registeredInPublicRegistry?: boolean;
  availableForSale?: boolean;
  pricePerSqmVAT?: number;
  blockId: string;
  organizationId: string;
  createdById: string;
}) {
  try {
    await requireRole(canManageUnits, 'создание квартиры');
    logAction('Создание новой квартиры', { number: data.number, floor: data.floor, price: data.price });
    // Проверяем, не существует ли уже квартира с таким номером
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Unit" 
      WHERE number = ${data.number} AND "blockId" = ${data.blockId}
      LIMIT 1
    `;
    
    if (existing.length > 0) {
      return { success: false, error: 'Квартира с таким номером уже существует в этом корпусе' };
    }
    
    const unitId = crypto.randomUUID();
    
    await prisma.$executeRaw`
      INSERT INTO "Unit" (
        id, number, floor, area, rooms, price, status, type, "viewType", "livingArea", "layoutUrl", "layout3dUrl",
        "balconyArea", "contractNumber", "deliveryYear", "deliveryMonth", "deliveryDate",
        "registeredInPublicRegistry", "availableForSale", "pricePerSqmVAT",
        "blockId", "organizationId", "createdAt", "updatedAt", version
      )
      VALUES (
        ${unitId}, ${data.number}, ${data.floor}, ${data.area}, ${data.rooms}, ${data.price},
        'FREE', ${data.type}, ${data.viewType || null}, ${data.livingArea || null}, ${data.layoutUrl || null}, ${data.layout3dUrl || null},
        ${data.balconyArea ?? null}, ${data.contractNumber || null}, ${data.deliveryYear ?? null}, ${data.deliveryMonth ?? null}, ${data.deliveryDate || null},
        ${data.registeredInPublicRegistry ?? false}, ${data.availableForSale ?? true}, ${data.pricePerSqmVAT ?? null},
        ${data.blockId}, ${data.organizationId}, NOW(), NOW(), 1
      )
    `;
    
    revalidatePath('/shakhmatka');
    return { success: true, unit: { id: unitId } };
  } catch (error) {
    console.error('Create unit error:', error);
    return { success: false, error: 'Ошибка при создании квартиры' };
  }
}

// Обновление квартиры (все поля)
export async function updateUnit(data: {
  unitId: string;
  number?: string;
  floor?: number;
  area?: number;
  rooms?: number;
  price?: number;
  type?: string;
  viewType?: string;
  livingArea?: number;
  layoutUrl?: string;
  layout3dUrl?: string;
  status?: string;
  balconyArea?: number;
  contractNumber?: string;
  deliveryYear?: number;
  deliveryMonth?: number;
  deliveryDate?: string;
  registeredInPublicRegistry?: boolean;
  availableForSale?: boolean;
  pricePerSqmVAT?: number;
  reason: string;
  organizationId: string;
  initiatorId: string;
}) {
  try {
    await requireRole(canManageUnits, 'редактирование квартиры');
    logAction('Обновление характеристик квартиры', { unitId: data.unitId, reason: data.reason });
    // Получаем старые данные
    const oldUnit: any[] = await prisma.$queryRaw`
      SELECT number, floor, area, rooms, price, type, "viewType", "livingArea", status, "layoutUrl", "layout3dUrl",
        "balconyArea", "contractNumber", "deliveryYear", "deliveryMonth", "deliveryDate",
        "registeredInPublicRegistry", "availableForSale", "pricePerSqmVAT"
      FROM "Unit" WHERE id = ${data.unitId} LIMIT 1
    `;
    
    if (oldUnit.length === 0) {
      return { success: false, error: 'Квартира не найдена' };
    }
    
    const old = oldUnit[0];
    const updates: any[] = [];
    const changes: string[] = [];
    
    // Собираем изменения
    if (data.number !== undefined && data.number !== old.number) {
      updates.push(Prisma.sql`"number" = ${data.number}`);
      changes.push(`номер: ${old.number} → ${data.number}`);
    }
    if (data.floor !== undefined && data.floor !== old.floor) {
      updates.push(Prisma.sql`"floor" = ${data.floor}`);
      changes.push(`этаж: ${old.floor} → ${data.floor}`);
    }
    if (data.area !== undefined && data.area !== old.area) {
      updates.push(Prisma.sql`"area" = ${data.area}`);
      changes.push(`площадь: ${old.area}м² → ${data.area}м²`);
    }
    if (data.rooms !== undefined && data.rooms !== old.rooms) {
      updates.push(Prisma.sql`"rooms" = ${data.rooms}`);
      changes.push(`комнат: ${old.rooms} → ${data.rooms}`);
    }
    if (data.price !== undefined && data.price !== old.price) {
      updates.push(Prisma.sql`"price" = ${data.price}`);
      changes.push(`цена: $${old.price.toLocaleString()} → $${data.price.toLocaleString()}`);
      
      // Записываем в историю цен
      await prisma.$executeRaw`
        INSERT INTO "PriceHistory" (
          id, "unitId", "oldPrice", "newPrice", currency, 
          "initiatorId", reason, "organizationId", "createdAt"
        )
        VALUES (
          ${crypto.randomUUID()}, ${data.unitId}, ${old.price}, ${data.price}, 'USD',
          ${data.initiatorId}, ${data.reason}, ${data.organizationId}, NOW()
        )
      `;
    }
    if (data.type !== undefined && data.type !== old.type) {
      updates.push(Prisma.sql`"type" = ${data.type}`);
      changes.push(`тип: ${old.type} → ${data.type}`);
    }
    if (data.viewType !== undefined && data.viewType !== old.viewType) {
      updates.push(Prisma.sql`"viewType" = ${data.viewType}`);
      changes.push(`вид: ${old.viewType || '—'} → ${data.viewType}`);
    }
    if (data.livingArea !== undefined && data.livingArea !== old.livingArea) {
      updates.push(Prisma.sql`"livingArea" = ${data.livingArea}`);
      changes.push(`жилая площадь: ${old.livingArea || '—'}м² → ${data.livingArea}м²`);
    }
    if (data.layoutUrl !== undefined && data.layoutUrl !== old.layoutUrl) {
      updates.push(Prisma.sql`"layoutUrl" = ${data.layoutUrl || null}`);
      changes.push(`планировка: ${old.layoutUrl || '—'} → ${data.layoutUrl || '—'}`);
    }
    if (data.layout3dUrl !== undefined && data.layout3dUrl !== old.layout3dUrl) {
      updates.push(Prisma.sql`"layout3dUrl" = ${data.layout3dUrl || null}`);
      changes.push(`3D планировка: ${old.layout3dUrl || '—'} → ${data.layout3dUrl || '—'}`);
    }
    if (data.status !== undefined && data.status !== old.status) {
      updates.push(Prisma.sql`"status" = ${data.status}::"UnitStatus"`);
      changes.push(`статус: ${old.status} → ${data.status}`);
    }
    if (data.balconyArea !== undefined && data.balconyArea !== old.balconyArea) {
      updates.push(Prisma.sql`"balconyArea" = ${data.balconyArea}`);
      changes.push(`балкон: ${old.balconyArea || '—'}м² → ${data.balconyArea}м²`);
    }
    if (data.contractNumber !== undefined && data.contractNumber !== old.contractNumber) {
      updates.push(Prisma.sql`"contractNumber" = ${data.contractNumber || null}`);
      changes.push(`номер контракта: ${old.contractNumber || '—'} → ${data.contractNumber || '—'}`);
    }
    if (data.deliveryYear !== undefined && data.deliveryYear !== old.deliveryYear) {
      updates.push(Prisma.sql`"deliveryYear" = ${data.deliveryYear}`);
      changes.push(`год сдачи: ${old.deliveryYear || '—'} → ${data.deliveryYear}`);
    }
    if (data.deliveryMonth !== undefined && data.deliveryMonth !== old.deliveryMonth) {
      updates.push(Prisma.sql`"deliveryMonth" = ${data.deliveryMonth}`);
      changes.push(`месяц сдачи: ${old.deliveryMonth || '—'} → ${data.deliveryMonth}`);
    }
    if (data.deliveryDate !== undefined && data.deliveryDate !== old.deliveryDate) {
      updates.push(Prisma.sql`"deliveryDate" = ${data.deliveryDate || null}`);
      changes.push(`дата сдачи: ${old.deliveryDate || '—'} → ${data.deliveryDate || '—'}`);
    }
    if (data.registeredInPublicRegistry !== undefined && data.registeredInPublicRegistry !== old.registeredInPublicRegistry) {
      updates.push(Prisma.sql`"registeredInPublicRegistry" = ${data.registeredInPublicRegistry}`);
      changes.push(`регистрация в реестре: ${old.registeredInPublicRegistry ? 'Да' : 'Нет'} → ${data.registeredInPublicRegistry ? 'Да' : 'Нет'}`);
    }
    if (data.availableForSale !== undefined && data.availableForSale !== old.availableForSale) {
      updates.push(Prisma.sql`"availableForSale" = ${data.availableForSale}`);
      changes.push(`доступна к продаже: ${old.availableForSale ? 'Да' : 'Нет'} → ${data.availableForSale ? 'Да' : 'Нет'}`);
    }
    if (data.pricePerSqmVAT !== undefined && data.pricePerSqmVAT !== old.pricePerSqmVAT) {
      updates.push(Prisma.sql`"pricePerSqmVAT" = ${data.pricePerSqmVAT}`);
      changes.push(`цена м² с НДС: ${old.pricePerSqmVAT || '—'} → ${data.pricePerSqmVAT}`);
    }
    
    if (updates.length === 0) {
      return { success: true, message: 'Нет изменений' };
    }
    
    updates.push(Prisma.sql`"version" = "version" + 1`);
    updates.push(Prisma.sql`"updatedAt" = NOW()`);
    
    await prisma.$executeRaw`
      UPDATE "Unit" 
      SET ${Prisma.join(updates, ', ')}
      WHERE id = ${data.unitId}
    `;
    
    // Логируем изменения
    if (changes.length > 0) {
      await prisma.$executeRaw`
        INSERT INTO "ChangeLog" (
          id, "leadId", "managerId", field, "oldValue", "newValue", "createdAt"
        )
        VALUES (
          ${crypto.randomUUID()}, NULL, ${data.initiatorId}, 'UNIT_UPDATE',
          ${JSON.stringify({ changes })}, ${data.reason}, NOW()
        )
      `;
    }
    
    revalidatePath('/shakhmatka');
    return { success: true, changes };
  } catch (error) {
    console.error('Update unit error:', error);
    return { success: false, error: 'Ошибка при обновлении квартиры' };
  }
}

// Мягкое удаление квартиры (статус EXCLUDED)
// Удаление квартиры (мягкое) - ИСПРАВЛЕННАЯ ВЕРСИЯ
// Удаление квартиры (мягкое) - ИСПРАВЛЕННАЯ ВЕРСИЯ
export async function deleteUnit(unitId: string, reason: string, organizationId: string, initiatorId: string) {
  try {
    await requireRole(canManageUnits, 'удаление квартиры');
    // Проверяем, есть ли активные сделки по этой квартире
    const activeDeals = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Deal" 
      WHERE "unitId" = ${unitId} 
      AND status NOT IN ('SUCCESS', 'CANCELLED', 'FAILED')
      LIMIT 1
    `;
    
    if (activeDeals.length > 0) {
      return { success: false, error: 'Невозможно удалить квартиру с активными сделками' };
    }
    
    // Меняем статус на EXCLUDED (мягкое удаление)
    await prisma.$executeRaw`
      UPDATE "Unit" 
      SET status = 'EXCLUDED'::"UnitStatus", "updatedAt" = NOW(), version = version + 1
      WHERE id = ${unitId}
    `;
    
    //  ИСПРАВЛЕННЫЙ INSERT — убираем leadId, так как это не связано с лидом
    await prisma.$executeRaw`
      INSERT INTO "ChangeLog" (
        id, "managerId", field, "oldValue", "newValue", "createdAt"
      )
      VALUES (
        ${crypto.randomUUID()}, ${initiatorId}, 'UNIT_DELETED',
        ${unitId}, ${reason}, NOW()
      )
    `;
    
    revalidatePath('/shakhmatka');
    return { success: true };
  } catch (error) {
    console.error('Delete unit error:', error);
    return { success: false, error: 'Ошибка при удалении квартиры: ' + (error instanceof Error ? error.message : 'Неизвестная ошибка') };
  }
}

// Расторжение договора (см. "Расторжение договора.pdf") — узкая точечная операция:
// - Unit: "Продано" -> "Свободна", больше ничего на юните не меняется (FR-10).
// - Deal: НЕ меняется вообще — ни статус, ни другие поля (FR-20).
// - PaymentSchedule: неоплаченные (PENDING/OVERDUE) записи графика ОСНОВНОГО объекта
//   сделки переводятся в PAUSED с причиной "Расторжение" и меткой времени (FR-30/32/33).
//   Уже оплаченные записи не трогаются (FR-31). Денежных операций/возвратов нет.
// - Если расторгается дополнительный (не основной) объект сделки — у него своего
//   графика платежей нет (график считается по основному объекту), поэтому график
//   вообще не трогается — см. Сценарий 4 ТЗ.
// - Идемпотентно: повторный вызов на не-"Продано" объекте отклоняется без изменений (FR-03, раздел 5).
// - Атомарно: смена статуса юнита и приостановка платежей проходят в одной транзакции.
export async function terminateUnitContract(unitId: string, organizationId: string, initiatorId: string) {
  try {
    await requireRole(canManageUnits, 'расторжение договора');

    // Самомиграция схемы (по аналогии с другими self-migrating таблицами в проекте) —
    // отдельными выполнениями, не в общей транзакции ниже (ALTER TYPE ADD VALUE нельзя
    // использовать в той же транзакции, где он выполнен).
    await prisma.$executeRaw`ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "pausedReason" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP WITH TIME ZONE`;
    await prisma.$executeRaw`ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PAUSED'`;

    // FR-01/FR-03: действие доступно только для помещения в статусе "Продано"
    const unitRows: any[] = await prisma.$queryRaw`
      SELECT status::text as status FROM "Unit" WHERE id = ${unitId} AND "organizationId" = ${organizationId} LIMIT 1
    `;
    const unit = unitRows[0];
    if (!unit) {
      return { success: false, error: 'UNIT_NOT_FOUND', message: 'Помещение не найдено.' };
    }
    if (unit.status !== 'SOLD') {
      return {
        success: false,
        error: 'NOT_SOLD',
        message: 'Расторжение возможно только для помещения в статусе "Продано". Возможно, оно уже расторгнуто или ещё не было продано.',
      };
    }

    // FR-02: сделка и график определяются автоматически по действующей привязке
    // Unit -> Deal -> PaymentSchedule, без ручного выбора сделки.
    const primaryDealRows: any[] = await prisma.$queryRaw`
      SELECT id FROM "Deal"
      WHERE "unitId" = ${unitId} AND status::text NOT IN ('SUCCESS', 'FAILED', 'CANCELLED')
      ORDER BY "createdAt" DESC LIMIT 1
    `;
    const isPrimaryUnit = primaryDealRows.length > 0;
    let relatedDealId: string | null = isPrimaryUnit ? primaryDealRows[0].id : null;

    // Для аудита (FR-40) фиксируем, какой была связанная сделка на момент операции,
    // даже если это дополнительный объект (график у него не считается отдельно).
    if (!relatedDealId) {
      const additionalDealRows: any[] = await prisma.$queryRaw`
        SELECT "dealId" FROM "DealUnit" WHERE "unitId" = ${unitId} AND "isDeleted" = false LIMIT 1
      `;
      relatedDealId = additionalDealRows[0]?.dealId || null;
    }

    const { pool } = require('@/lib/db');
    const client = await pool.connect();
    let pausedPaymentsCount = 0;
    try {
      await client.query('BEGIN');

      // Повторная проверка статуса внутри транзакции (блокировка строки) — защита от гонки
      // при одновременном повторном вызове (идемпотентность, раздел 5 ТЗ).
      const lockRows = await client.query(
        `SELECT status::text as status FROM "Unit" WHERE id = $1 FOR UPDATE`,
        [unitId]
      );
      if (!lockRows.rows.length || lockRows.rows[0].status !== 'SOLD') {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'NOT_SOLD',
          message: 'Расторжение возможно только для помещения в статусе "Продано".',
        };
      }

      // FR-10: единственное изменение на Unit — статус "Продано" -> "Свободна"
      await client.query(
        `UPDATE "Unit" SET status = 'FREE'::"UnitStatus", "updatedAt" = NOW() WHERE id = $1`,
        [unitId]
      );

      // FR-30/FR-21/Сценарий 4: график приостанавливается только если расторгаемый
      // объект — основной объект сделки (у дополнительных объектов своего графика нет).
      if (isPrimaryUnit && relatedDealId) {
        const paused = await client.query(
          `UPDATE "PaymentSchedule"
           SET status = 'PAUSED'::"PaymentStatus", "pausedReason" = 'Расторжение', "pausedAt" = NOW(), "updatedAt" = NOW()
           WHERE "dealId" = $1 AND status::text IN ('PENDING', 'OVERDUE')
           RETURNING id`,
          [relatedDealId]
        );
        pausedPaymentsCount = paused.rows.length;
      }

      // FR-20: сделку (Deal) эта операция не трогает вообще — ни статус, ни другие поля.

      // FR-40: журнал аудита — помещение, связанная сделка на момент операции, инициатор, время.
      await client.query(
        `INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "managerId", "fieldName", "oldValue", "newValue", "reason", "organizationId", "createdAt")
         VALUES ($1, 'TERMINATE', 'Unit', $2, $3, 'status', 'SOLD', 'FREE', $4, $5, NOW())`,
        [
          crypto.randomUUID(),
          unitId,
          initiatorId || 'system',
          relatedDealId ? `Расторжение договора (сделка на момент операции: ${relatedDealId})` : 'Расторжение договора',
          organizationId,
        ]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    revalidatePath('/shakhmatka');
    return { success: true, pausedPaymentsCount };
  } catch (error: any) {
    console.error('Terminate unit contract error:', error);
    return { success: false, error: 'SERVER_ERROR', message: error?.message || 'Ошибка при расторжении договора' };
  }
}

// Получить все блоки для выбора при создании
export async function getBlocksForSelect(organizationId: string) {
  try {
    const blocks = await prisma.$queryRaw<{ id: string; number: string; projectName: string }[]>`
      SELECT b.id, b.number, p.name as "projectName"
      FROM "Block" b
      JOIN "Project" p ON b."projectId" = p.id
      WHERE b."organizationId" = ${organizationId}
      ORDER BY p.name, b.number
    `;
    return blocks;
  } catch (error) {
    console.error('Get blocks error:', error);
    return [];
  }
}

// Получить историю действий (активности) квартиры
export async function getUnitActionHistory(unitId: string) {
  try {
    // 1. Получаем все бронирования
    const bookings: any[] = await prisma.$queryRaw`
      SELECT b.id, b.status, b.type, b."createdAt", b."expiresAt", b."updatedAt", ld.name as "leadName"
      FROM "Booking" b
      JOIN "Lead" ld ON b."leadId" = ld.id
      WHERE b."unitId" = ${unitId}
    `;

    // 2. Получаем все сделки с причиной расторжения из ChangeLog
    const deals: any[] = await prisma.$queryRaw`
      SELECT d.id, d.status, d."createdAt", d."updatedAt", ld.name as "leadName",
        (
          SELECT cl."newValue"
          FROM "ChangeLog" cl
          WHERE cl."leadId" = d."leadId"
            AND cl.field = 'STATUS_CANCELLED'
          ORDER BY cl."createdAt" DESC
          LIMIT 1
        ) as "cancelReason"
      FROM "Deal" d
      JOIN "Lead" ld ON d."leadId" = ld.id
      WHERE d."unitId" = ${unitId}
    `;

    // 3. Получаем историю цен
    const prices: any[] = await prisma.$queryRaw`
      SELECT ph.id, ph."oldPrice", ph."newPrice", ph.reason, ph."createdAt"
      FROM "PriceHistory" ph
      WHERE ph."unitId" = ${unitId}
    `;

    // 4. Получаем события добавления в акции
    const promoEvents: any[] = await prisma.$queryRaw`
      SELECT id, reason, "createdAt"
      FROM "AuditLog"
      WHERE "entityType" = 'Unit' AND "entityId" = ${unitId} AND action = 'PROMOTION_ADDED'
    `;

    // 5. Формируем единый массив событий
    const events: any[] = [];

    bookings.forEach(b => {
      const typeLabel = b.type === 'SOFT' ? 'Стандартная бронь' : b.type === 'HARD' ? 'Хард бронь' : 'Служебная';
      
      // Событие создания брони
      events.push({
        id: `book-create-${b.id}`,
        date: b.createdAt,
        type: 'BOOKING_CREATE',
        title: `Создана бронь: ${typeLabel}`,
        description: `Клиент: ${b.leadName}. Срок до: ${new Date(b.expiresAt).toLocaleString('ru-RU')}`,
        icon: ''
      });

      // Событие снятия/истечения брони
      if (b.status === 'EXPIRED') {
        events.push({
          id: `book-expired-${b.id}`,
          date: b.expiresAt,
          type: 'BOOKING_EXPIRED',
          title: `Бронь истекла`,
          description: `Срок действия брони клиента ${b.leadName} закончился.`,
          icon: '⏳'
        });
      } else if (b.status === 'CANCELLED') {
        events.push({
          id: `book-cancelled-${b.id}`,
          date: b.updatedAt,
          type: 'BOOKING_CANCELLED',
          title: `Бронь снята менеджером`,
          description: `Бронь клиента ${b.leadName} была вручную снята в шахматке.`,
          icon: ''
        });
      }
    });

    deals.forEach(d => {
      let statusText = d.status;
      if (d.status === 'CONTRACT') statusText = 'Договор сформирован';
      else if (d.status === 'SUCCESS') statusText = 'Успешно закрыта';
      else if (d.status === 'FAILED') statusText = 'Отказ';
      else if (d.status === 'CANCELLED') statusText = 'Расторгнута';
      
      events.push({
        id: `deal-create-${d.id}`,
        date: d.createdAt,
        type: 'DEAL_CREATE',
        title: `Оформлена сделка`,
        description: `Клиент: ${d.leadName}. Текущий статус: ${statusText}`,
        icon: ''
      });
      
      if (new Date(d.updatedAt).getTime() !== new Date(d.createdAt).getTime()) {
        const isCancelled = d.status === 'CANCELLED' || d.status === 'FAILED';
        events.push({
          id: `deal-update-${d.id}`,
          date: d.updatedAt,
          type: 'DEAL_UPDATE',
          title: isCancelled ? `Сделка расторгнута` : `Статус сделки изменен`,
          description: isCancelled
            ? `Клиент: ${d.leadName}. Причина: ${d.cancelReason || 'не указана'}`
            : `Сделка клиента ${d.leadName} переведена в статус: ${statusText}`,
          icon: isCancelled ? '' : ''
        });
      }
    });

    prices.forEach(p => {
      events.push({
        id: `price-${p.id}`,
        date: p.createdAt,
        type: 'PRICE_CHANGE',
        title: `Изменение цены`,
        description: `Цена изменена с $${Math.round(p.oldPrice).toLocaleString()} на $${Math.round(p.newPrice).toLocaleString()}. Причина: ${p.reason || 'не указана'}`,
        icon: ''
      });
    });

    promoEvents.forEach(pe => {
      events.push({
        id: `promo-${pe.id}`,
        date: pe.createdAt,
        type: 'PROMOTION_ADDED',
        title: pe.reason || 'Объект добавлен в акцию',
        description: '',
        icon: ''
      });
    });

    // Сортируем по дате от самых свежих к самым старым
    events.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
 
    return events;
  } catch (error) {
    console.error('getUnitActionHistory error:', error);
    return [];
  }
}

// Получить связанного клиента (лида) для конкретной квартиры
export async function getUnitAssociatedClient(unitId: string) {
  try {
    // 1. Проверяем активную бронь
    const bookings: any[] = await prisma.$queryRaw`
      SELECT ld.id, ld.name
      FROM "Booking" b
      JOIN "Lead" ld ON b."leadId" = ld.id
      WHERE b."unitId" = ${unitId} AND b.status = 'ACTIVE'
      LIMIT 1
    `;
    if (bookings.length > 0) {
      return { leadId: bookings[0].id, leadName: bookings[0].name };
    }

    // 2. Проверяем сделки
    const deals: any[] = await prisma.$queryRaw`
      SELECT ld.id, ld.name
      FROM "Deal" d
      JOIN "Lead" ld ON d."leadId" = ld.id
      WHERE d."unitId" = ${unitId} AND d.status::text NOT IN ('FAILED', 'CANCELLED')
      ORDER BY d."createdAt" DESC
      LIMIT 1
    `;
    if (deals.length > 0) {
      return { leadId: deals[0].id, leadName: deals[0].name };
    }

    return null;
  } catch (error) {
    console.error('getUnitAssociatedClient error:', error);
    return null;
  }
}

// Создать новый проект (ЖК)
export async function createProjectAction(data: {
  name: string;
  code: string;
  address?: string;
  description?: string;
  expectedCompletionDate?: string;
  organizationId: string;
}) {
  try {
    await requireRole(canManageUnits, 'создание проекта (ЖК)');
    logAction('Создание нового ЖК (Проекта)', { name: data.name, code: data.code, address: data.address });
    const projectId = crypto.randomUUID();
    const completionDate = data.expectedCompletionDate ? new Date(data.expectedCompletionDate) : null;
    
    await prisma.$executeRaw`
      INSERT INTO "Project" (
        "id", "code", "nameKa", "nameRu", "nameEn", "address", "description", 
        "expectedCompletionDate", "organizationId", "createdAt", "updatedAt"
      )
      VALUES (
        ${projectId}, ${data.code}, ${data.name}, ${data.name}, ${data.name}, 
        ${data.address || null}, ${data.description || null}, ${completionDate}, 
        ${data.organizationId}, NOW(), NOW()
      )
    `;
    revalidatePath('/shakhmatka');
    return { success: true, projectId };
  } catch (error) {
    console.error('createProjectAction error:', error);
    return { success: false, error: 'Ошибка при создании ЖК: ' + (error instanceof Error ? error.message : 'Неизвестная ошибка') };
  }
}

// Создать новый корпус и автоматически сгенерировать квартиры (шахматку)
export async function generateBlockAndUnitsAction(data: {
  projectId: string;
  blockNumber: string;
  floorCount: number;
  entranceCount: number;
  unitsPerFloorPerEntrance: number;
  defaultArea: number;
  defaultPricePerSqm: number;
  defaultRooms: number;
  expectedCommissioningDate?: string;
  organizationId: string;
  // Кастомные параметры по позициям (индекс = позиция на этаже, начиная с 0)
  unitTemplates?: { area: number; pricePerSqm: number; rooms: number }[];
}) {
  try {
    await requireRole(canManageUnits, 'генерация корпуса и квартир');
    logAction('Автоматическая генерация корпуса и квартир', { projectId: data.projectId, blockNumber: data.blockNumber, floorCount: data.floorCount, entranceCount: data.entranceCount, unitsPerFloor: data.unitsPerFloorPerEntrance });
    const blockId = crypto.randomUUID();
    const commissioningDate = data.expectedCommissioningDate ? new Date(data.expectedCommissioningDate) : null;
    const blockCode = `${data.blockNumber}_${Date.now()}`;
    
    // 1. Создаем корпус
    await prisma.$executeRaw`
      INSERT INTO "Block" (
        "id", "projectId", "code", "number", "floorCount", "entranceCount",
        "expectedCommissioningDate", "organizationId", "createdAt", "updatedAt"
      )
      VALUES (
        ${blockId}, ${data.projectId}, ${blockCode}, ${data.blockNumber}, 
        ${data.floorCount}, ${data.entranceCount}, ${commissioningDate}, 
        ${data.organizationId}, NOW(), NOW()
      )
    `;
    
    // 2. Генерируем квартиры
    for (let f = 1; f <= data.floorCount; f++) {
      for (let ent = 1; ent <= data.entranceCount; ent++) {
        for (let idx = 1; idx <= data.unitsPerFloorPerEntrance; idx++) {
          const unitId = crypto.randomUUID();
          const numVal = (f * 100) + ((ent - 1) * data.unitsPerFloorPerEntrance) + idx;
          const unitNumber = String(numVal);

          // Берём параметры из шаблона позиции если есть, иначе дефолт
          const tpl = data.unitTemplates?.[idx - 1];
          const area = tpl?.area ?? data.defaultArea;
          const pricePerSqm = tpl?.pricePerSqm ?? data.defaultPricePerSqm;
          const rooms = tpl?.rooms ?? data.defaultRooms;
          const priceVal = area * pricePerSqm;
          
          await prisma.$executeRaw`
            INSERT INTO "Unit" (
              "id", "number", "floor", "area", "rooms", "price", "status", 
              "blockId", "organizationId", "createdAt", "updatedAt", "version", 
              "type", "entrance"
            )
            VALUES (
              ${unitId}, ${unitNumber}, ${f}, ${area}, ${rooms}, 
              ${priceVal}, 'FREE', ${blockId}, ${data.organizationId}, NOW(), NOW(), 1, 
              'Apartment', ${ent}
            )
          `;
        }
      }
    }
    
    revalidatePath('/shakhmatka');
    return { success: true, blockId };
  } catch (error) {
    console.error('generateBlockAndUnitsAction error:', error);
    return { success: false, error: 'Ошибка при генерации шахматки: ' + (error instanceof Error ? error.message : 'Неизвестная ошибка') };
  }
}
// Полные данные объекта для калькулятора рассрочки (карточка лида) —
// lead.interests содержит только id/number/price/projectName, этого недостаточно.
export async function getUnitForCalculator(unitId: string, organizationId: string) {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        u.id, u.number, u.area, u.price, u."pricePerSqmVAT",
        u."deliveryDate", u."deliveryYear", u."deliveryMonth",
        p."expectedCompletionDate" as "projectExpectedCompletionDate"
      FROM "Unit" u
      JOIN "Block" b ON u."blockId" = b.id
      JOIN "Project" p ON b."projectId" = p.id
      WHERE u.id = ${unitId} AND u."organizationId" = ${organizationId}
      LIMIT 1
    `;
    return rows[0] || null;
  } catch (error) {
    console.error('getUnitForCalculator error:', error);
    return null;
  }
}

// Получить детальный разбор комнат для квартиры (экспликация)
export async function getUnitRooms(unitId: string) {
  try {
    const rooms: any[] = await prisma.$queryRaw`
      SELECT id, "roomType", "nameRu", area
      FROM "UnitRoom"
      WHERE "unitId" = ${unitId}
      ORDER BY "area" DESC
    `;
    return rooms;
  } catch (error) {
    console.error('getUnitRooms error:', error);
    return [];
  }
}
