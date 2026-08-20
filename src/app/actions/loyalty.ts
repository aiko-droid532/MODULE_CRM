'use server';

import { db as prisma } from '@/lib/db';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { canApprovePromotions } from '@/lib/roles';
import { requireRole } from '@/lib/serverAuth';

// Модуль "Накопительная скидка" (Этап 2.2) — каркас.
// Уровни настраиваются вручную (админ/РОП), реальные % пока не заданы заказчиком —
// таблица уровней просто пуста по умолчанию, ничего не ломается и не применяется,
// пока хотя бы один уровень не будет добавлен.
//
// Логика: считаем количество предыдущих сделок клиента (по Lead.id, без учёта связанных
// лиц — по вашему решению пока не учитываем), берём НАИБОЛЬШИЙ подходящий порог.

// ── Настройка уровней (админ/РОП) ────────────────────────────────────────────
export async function getCumulativeDiscountTiers(organizationId: string) {
  noStore();
  try {
    const tiers: any[] = await prisma.$queryRaw`
      SELECT * FROM "CumulativeDiscountTier"
      WHERE "organizationId" = ${organizationId}
      ORDER BY "minPurchases" ASC
    `;
    return tiers;
  } catch (error) {
    console.error('getCumulativeDiscountTiers error:', error);
    return [];
  }
}

export async function upsertCumulativeDiscountTier(data: {
  id?: string;
  minPurchases: number;
  discountPercent: number;
  organizationId: string;
}) {
  try {
    await requireRole(canApprovePromotions, 'настройка уровней накопительной скидки');

    if (data.id) {
      await prisma.$executeRaw`
        UPDATE "CumulativeDiscountTier"
        SET "minPurchases" = ${data.minPurchases}, "discountPercent" = ${data.discountPercent}, "updatedAt" = NOW()
        WHERE id = ${data.id} AND "organizationId" = ${data.organizationId}
      `;
    } else {
      await prisma.$executeRaw`
        INSERT INTO "CumulativeDiscountTier" ("id", "minPurchases", "discountPercent", "organizationId", "createdAt", "updatedAt")
        VALUES (${crypto.randomUUID()}, ${data.minPurchases}, ${data.discountPercent}, ${data.organizationId}, NOW(), NOW())
      `;
    }

    revalidatePath('/pricing');
    return { success: true };
  } catch (error) {
    console.error('upsertCumulativeDiscountTier error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

export async function deleteCumulativeDiscountTier(id: string, organizationId: string) {
  try {
    await requireRole(canApprovePromotions, 'удаление уровня накопительной скидки');
    await prisma.$executeRaw`
      DELETE FROM "CumulativeDiscountTier" WHERE id = ${id} AND "organizationId" = ${organizationId}
    `;
    revalidatePath('/pricing');
    return { success: true };
  } catch (error) {
    console.error('deleteCumulativeDiscountTier error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// ── Применение (автоматически, для калькулятора) ────────────────────────────
// Применимый уровень накопительной скидки для клиента прямо сейчас (или null, если уровней нет / не набрал)
export async function getApplicableCumulativeDiscount(leadId: string, organizationId: string) {
  noStore();
  try {
    const countRows: any[] = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count FROM "Deal"
      WHERE "leadId" = ${leadId} AND "organizationId" = ${organizationId} AND status != 'CANCELLED'
    `;
    const purchaseCount = countRows[0]?.count || 0;

    const tiers: any[] = await prisma.$queryRaw`
      SELECT * FROM "CumulativeDiscountTier"
      WHERE "organizationId" = ${organizationId} AND "minPurchases" <= ${purchaseCount}
      ORDER BY "minPurchases" DESC
      LIMIT 1
    `;

    if (!tiers[0]) return null;
    return { discountPercent: tiers[0].discountPercent, minPurchases: tiers[0].minPurchases, purchaseCount };
  } catch (error) {
    console.error('getApplicableCumulativeDiscount error:', error);
    return null;
  }
}