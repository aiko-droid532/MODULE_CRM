'use server';

// Пороги согласования скидки — БЫЛИ хардкодом в коде (roles.ts), теперь
// настройка коммерческой политики, которую меняет администратор через
// интерфейс без релиза (Ролевая модель, фаза 4, BR-B05).

import { db as prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { logAction } from '@/lib/logger';
import { requireRole, canManageSystem, DEFAULT_DISCOUNT_THRESHOLDS, UserRole } from '@/lib/roles';

export async function initDiscountThresholdTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "DiscountThreshold" (
      "organizationId" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "maxPercent" DOUBLE PRECISION NOT NULL,
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedById" TEXT,
      PRIMARY KEY ("organizationId", "role")
    )
  `;
}

// Пороги организации, наложенные поверх дефолтов из roles.ts — роль, которую
// администратор ещё не настраивал явно, продолжает работать со старым
// значением (безопасный рллаут, как и в предыдущих фазах: ничего не меняется,
// пока админ не тронет настройку).
export async function getDiscountThresholds(organizationId: string): Promise<Record<UserRole, number>> {
  await initDiscountThresholdTable();
  const result = { ...DEFAULT_DISCOUNT_THRESHOLDS };
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT "role", "maxPercent" FROM "DiscountThreshold" WHERE "organizationId" = ${organizationId}
    `;
    for (const r of rows) {
      result[r.role as UserRole] = Number(r.maxPercent);
    }
    return result;
  } catch (error) {
    console.error('getDiscountThresholds error:', error);
    return result;
  }
}

// RACI "Изменение порогов скидок": R = Админ, C = РОП (консультируется вне системы).
export async function setDiscountThreshold(role: UserRole, maxPercent: number, organizationId: string, initiatorId: string) {
  await initDiscountThresholdTable();
  try {
    await requireRole(canManageSystem, 'изменение порога скидки');
    await prisma.$executeRaw`
      INSERT INTO "DiscountThreshold" ("organizationId", "role", "maxPercent", "updatedAt", "updatedById")
      VALUES (${organizationId}, ${role}, ${maxPercent}, NOW(), ${initiatorId})
      ON CONFLICT ("organizationId", "role") DO UPDATE SET
        "maxPercent" = ${maxPercent}, "updatedAt" = NOW(), "updatedById" = ${initiatorId}
    `;
    logAction('Изменение порога скидки', { role, maxPercent, organizationId, initiatorId });
    revalidatePath('/departments');
    revalidatePath('/pricing');
    return { success: true };
  } catch (error: any) {
    console.error('setDiscountThreshold error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}
