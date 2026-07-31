'use server';

import { db as prisma, Prisma } from '@/lib/db';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { requireRole, canManageDeals } from '@/lib/roles';

// Модуль "Подарки" (Этап 2.3): немонетарный бонус (свободный текст, фиксируется на сделке)
// либо конкретный паркинг/кладовая из каталога — с запретом двойного использования
// (при выдаче в подарок помещение резервируется, статус меняется на "Платная бронь",
// чтобы оно не могло попасть в другую сделку).

// ── Свободные паркинги/кладовые для выбора в подарок ────────────────────────
export async function getAvailableGiftUnits(organizationId: string, projectId?: string) {
  noStore();
  try {
    const units: any[] = await prisma.$queryRaw`
      SELECT u.id, u.number, u.floor, u.area, u.type, b.number as "blockNumber", p.name as "projectName"
      FROM "Unit" u
      JOIN "Block" b ON u."blockId" = b.id
      JOIN "Project" p ON b."projectId" = p.id
      WHERE u."organizationId" = ${organizationId}
        AND u.status::text = 'FREE'
        AND u.type IN ('Parking', 'Storage')
        ${projectId ? Prisma.sql`AND p.id = ${projectId}` : Prisma.empty}
      ORDER BY p.name, b.number, u.number
      LIMIT 200
    `;
    return units;
  } catch (error) {
    console.error('getAvailableGiftUnits error:', error);
    return [];
  }
}

// ── Подарки по сделке ────────────────────────────────────────────────────────
export async function getDealGifts(dealId: string) {
  noStore();
  try {
    const gifts: any[] = await prisma.$queryRaw`
      SELECT g.*, u.number as "unitNumber", u.type as "unitType", b.number as "blockNumber", p.name as "projectName"
      FROM "DealGift" g
      LEFT JOIN "Unit" u ON g."unitId" = u.id
      LEFT JOIN "Block" b ON u."blockId" = b.id
      LEFT JOIN "Project" p ON b."projectId" = p.id
      WHERE g."dealId" = ${dealId}
      ORDER BY g."createdAt" DESC
    `;
    return gifts;
  } catch (error) {
    console.error('getDealGifts error:', error);
    return [];
  }
}

export async function addDealGift(data: {
  dealId: string;
  giftType: 'DESCRIPTION' | 'UNIT';
  description?: string;
  unitId?: string;
  organizationId: string;
  initiatorId: string;
}) {
  try {
    await requireRole(canManageDeals, 'добавление подарка к сделке');

    if (data.giftType === 'UNIT' && !data.unitId) {
      return { success: false, error: 'Выберите помещение для подарка' };
    }
    if (data.giftType === 'DESCRIPTION' && !data.description) {
      return { success: false, error: 'Укажите описание подарка' };
    }

    if (data.giftType === 'UNIT' && data.unitId) {
      // Запрет двойного использования: помещение резервируется за этой сделкой
      const check: any[] = await prisma.$queryRaw`SELECT status FROM "Unit" WHERE id = ${data.unitId} LIMIT 1`;
      if (!check[0] || check[0].status !== 'FREE') {
        return { success: false, error: 'Это помещение уже занято/забронировано и не может быть выдано в подарок' };
      }
      await prisma.$executeRaw`UPDATE "Unit" SET status = 'HARD_BOOKED'::"UnitStatus", "updatedAt" = NOW() WHERE id = ${data.unitId}`;
    }

    await prisma.$executeRaw`
      INSERT INTO "DealGift" ("id", "dealId", "giftType", description, "unitId", "organizationId", "createdById", "createdAt")
      VALUES (${crypto.randomUUID()}, ${data.dealId}, ${data.giftType}, ${data.description || null}, ${data.unitId || null}, ${data.organizationId}, ${data.initiatorId}, NOW())
    `;

    revalidatePath('/deals');
    revalidatePath('/shakhmatka');
    return { success: true };
  } catch (error) {
    console.error('addDealGift error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

export async function removeDealGift(giftId: string, organizationId: string) {
  try {
    await requireRole(canManageDeals, 'удаление подарка со сделки');

    const gifts: any[] = await prisma.$queryRaw`SELECT * FROM "DealGift" WHERE id = ${giftId} AND "organizationId" = ${organizationId} LIMIT 1`;
    const gift = gifts[0];
    if (!gift) return { success: false, error: 'Подарок не найден' };

    // Если это было помещение (паркинг/кладовая) — снимаем резерв, освобождаем
    if (gift.giftType === 'UNIT' && gift.unitId) {
      await prisma.$executeRaw`UPDATE "Unit" SET status = 'FREE'::"UnitStatus", "updatedAt" = NOW() WHERE id = ${gift.unitId}`;
    }

    await prisma.$executeRaw`DELETE FROM "DealGift" WHERE id = ${giftId}`;

    revalidatePath('/deals');
    revalidatePath('/shakhmatka');
    return { success: true };
  } catch (error) {
    console.error('removeDealGift error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}