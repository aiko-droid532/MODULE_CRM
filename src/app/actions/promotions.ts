'use server';

import { db as prisma, Prisma } from '@/lib/db';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { logAction } from '@/lib/logger';
import { requireRole, canCreatePromotions, canApprovePromotions } from '@/lib/roles';
import { formatEffectSummary } from '@/lib/promotionCalculator';

// Таблицы: "Promotion" (сама акция) и "PromotionUnit" (связующая, аналог их flat_promotions).
// Названия ТАБЛИЦ не меняем — только 4 поля в "Promotion" выровнены под БД сайта заказчика:
// discount, discount_type ('percent' | 'amount'), condition_label, updated_at.

function toCustomerDiscountType(effectValueType: string): 'percent' | 'amount' {
  return effectValueType === 'PERCENT' ? 'percent' : 'amount';
}

// ── Подбор помещений по фильтру (шаг 1 конструктора) ────────────────────────
// Помещение может входить в несколько акций одновременно (пересечение периодов
// разрешено) — какая из них реально действует в конкретный момент решает
// getLivePromotionForUnit/getLivePromotionsMap по правилу приоритета "чья акция
// началась раньше — та и действует до конца своего периода, затем в силу
// вступает следующая". Поэтому здесь фильтр НЕ исключает помещения, уже
// состоящие в другой акции — только реально занятые (не FREE) помещения.
export async function getFilteredUnitsForPromotion(filters: {
  organizationId: string;
  projectId?: string;
  blockId?: string;
  floorFrom?: number;
  floorTo?: number;
  areaMin?: number;
  areaMax?: number;
  type?: string;
  rooms?: number;
}) {
  try {
    const units: any[] = await prisma.$queryRaw`
      SELECT
        u.id, u.number, u.floor, u.area, u.price, u.rooms, u.type, u."pricePerSqmVAT",
        b.number as "blockNumber", p.name as "projectName", p.id as "projectId"
      FROM "Unit" u
      JOIN "Block" b ON u."blockId" = b.id
      JOIN "Project" p ON b."projectId" = p.id
      WHERE u."organizationId" = ${filters.organizationId}
        AND u.status::text = 'FREE'
        ${filters.projectId ? Prisma.sql`AND p.id = ${filters.projectId}` : Prisma.empty}
        ${filters.blockId ? Prisma.sql`AND b.id = ${filters.blockId}` : Prisma.empty}
        ${filters.floorFrom != null ? Prisma.sql`AND u.floor >= ${filters.floorFrom}` : Prisma.empty}
        ${filters.floorTo != null ? Prisma.sql`AND u.floor <= ${filters.floorTo}` : Prisma.empty}
        ${filters.areaMin != null ? Prisma.sql`AND u.area >= ${filters.areaMin}` : Prisma.empty}
        ${filters.areaMax != null ? Prisma.sql`AND u.area <= ${filters.areaMax}` : Prisma.empty}
        ${filters.type ? Prisma.sql`AND u.type = ${filters.type}` : Prisma.empty}
        ${filters.rooms != null ? Prisma.sql`AND u.rooms = ${filters.rooms}` : Prisma.empty}
      ORDER BY p.name, b.number, u.floor, u.number
      LIMIT 500
    `;
    return units;
  } catch (error) {
    console.error('getFilteredUnitsForPromotion error:', error);
    return [];
  }
}

// ── Создание черновика акции ─────────────────────────────────────────────────
export async function createPromotionDraft(data: {
  name: string;
  effectType: string;
  effectValueType: string;
  effectValue: number;
  nbgRate: number;
  startAt: string;
  endAt: string;
  unitIds: string[];
  organizationId: string;
  createdById: string;
  totalLimit?: number | null;
  perClientLimit?: number | null;
  perUnitLimit?: number | null;
}) {
  try {
    await requireRole(canCreatePromotions, 'создание акции');

    if (!data.unitIds || data.unitIds.length === 0) {
      return { success: false, error: 'Список помещений пуст' };
    }

    const id = crypto.randomUUID();
    const conditionLabel = formatEffectSummary({
      effectType: data.effectType as any,
      effectValueType: data.effectValueType as any,
      effectValue: data.effectValue,
    });
    const discountType = toCustomerDiscountType(data.effectValueType);

    await prisma.$executeRaw`
      INSERT INTO "Promotion" (
        "id", "name", "effectType", "effectValueType", "effectValue", "nbgRate",
        "startAt", "endAt", "status", "createdById", "organizationId",
        discount, discount_type, condition_label,
        "totalLimit", "perClientLimit", "perUnitLimit",
        "createdAt", updated_at
      ) VALUES (
        ${id}, ${data.name}, ${data.effectType}, ${data.effectValueType}, ${data.effectValue}, ${data.nbgRate},
        ${new Date(data.startAt)}, ${new Date(data.endAt)}, 'DRAFT', ${data.createdById}, ${data.organizationId},
        ${data.effectValue}, ${discountType}, ${conditionLabel},
        ${data.totalLimit ?? null}, ${data.perClientLimit ?? null}, ${data.perUnitLimit ?? null},
        NOW(), NOW()
      )
    `;

    await Promise.all(
      data.unitIds.map(unitId =>
        prisma.$executeRaw`
          INSERT INTO "PromotionUnit" ("id", "promotionId", "unitId", "createdAt")
          VALUES (${crypto.randomUUID()}, ${id}, ${unitId}, NOW())
        `
      )
    );

    logAction('Создан черновик акции', { promotionId: id, name: data.name, units: data.unitIds.length });
    revalidatePath('/pricing');
    return { success: true, id };
  } catch (error) {
    console.error('createPromotionDraft error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// ── Список акций (реестр) ────────────────────────────────────────────────────
export async function getPromotions(organizationId: string) {
  noStore();
  try {
    const list: any[] = await prisma.$queryRaw`
      SELECT
        pr.*,
        (SELECT COUNT(*)::int FROM "PromotionUnit" WHERE "promotionId" = pr.id) as "unitsCount",
        cm.name as "createdByName",
        am.name as "approvedByName"
      FROM "Promotion" pr
      LEFT JOIN "Manager" cm ON pr."createdById" = cm.id
      LEFT JOIN "Manager" am ON pr."approvedById" = am.id
      WHERE pr."organizationId" = ${organizationId}
      ORDER BY pr."createdAt" DESC
    `;
    return list;
  } catch (error) {
    console.error('getPromotions error:', error);
    return [];
  }
}

// ── Детали одной акции + её список помещений ────────────────────────────────
export async function getPromotionDetail(promotionId: string) {
  noStore();
  try {
    const promos: any[] = await prisma.$queryRaw`
      SELECT * FROM "Promotion" WHERE id = ${promotionId} LIMIT 1
    `;
    const promotion = promos[0];
    if (!promotion) return null;

    const units: any[] = await prisma.$queryRaw`
      SELECT u.id, u.number, u.floor, u.area, u.price, u.rooms, u.type,
        b.number as "blockNumber", p.name as "projectName"
      FROM "PromotionUnit" pu
      JOIN "Unit" u ON pu."unitId" = u.id
      JOIN "Block" b ON u."blockId" = b.id
      JOIN "Project" p ON b."projectId" = p.id
      WHERE pu."promotionId" = ${promotionId}
      ORDER BY p.name, b.number, u.floor, u.number
    `;

    return { ...promotion, units };
  } catch (error) {
    console.error('getPromotionDetail error:', error);
    return null;
  }
}

// ── Редактирование акции (только РОП/админ) ─────────────────────────────────
export async function updatePromotionDraft(data: {
  promotionId: string;
  name: string;
  effectType: string;
  effectValueType: string;
  effectValue: number;
  nbgRate: number;
  startAt: string;
  endAt: string;
  unitIds: string[];
  organizationId: string;
  totalLimit?: number | null;
  perClientLimit?: number | null;
  perUnitLimit?: number | null;
}) {
  try {
    await requireRole(canApprovePromotions, 'редактирование акции');

    const conditionLabel = formatEffectSummary({
      effectType: data.effectType as any,
      effectValueType: data.effectValueType as any,
      effectValue: data.effectValue,
    });
    const discountType = toCustomerDiscountType(data.effectValueType);

    await prisma.$executeRaw`
      UPDATE "Promotion"
      SET "name" = ${data.name},
          "effectType" = ${data.effectType},
          "effectValueType" = ${data.effectValueType},
          "effectValue" = ${data.effectValue},
          "nbgRate" = ${data.nbgRate},
          "startAt" = ${new Date(data.startAt)},
          "endAt" = ${new Date(data.endAt)},
          discount = ${data.effectValue},
          discount_type = ${discountType},
          condition_label = ${conditionLabel},
          "totalLimit" = ${data.totalLimit ?? null},
          "perClientLimit" = ${data.perClientLimit ?? null},
          "perUnitLimit" = ${data.perUnitLimit ?? null},
          updated_at = NOW()
      WHERE id = ${data.promotionId} AND "organizationId" = ${data.organizationId}
    `;

    await prisma.$executeRaw`DELETE FROM "PromotionUnit" WHERE "promotionId" = ${data.promotionId}`;
    await Promise.all(
      data.unitIds.map(unitId =>
        prisma.$executeRaw`
          INSERT INTO "PromotionUnit" ("id", "promotionId", "unitId", "createdAt")
          VALUES (${crypto.randomUUID()}, ${data.promotionId}, ${unitId}, NOW())
        `
      )
    );

    logAction('Отредактирована акция', { promotionId: data.promotionId, units: data.unitIds.length });
    revalidatePath('/pricing');
    revalidatePath('/shakhmatka');
    return { success: true };
  } catch (error) {
    console.error('updatePromotionDraft error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// ── Согласование акции: Draft → Active (только РОП/админ) ───────────────────
export async function approvePromotion(promotionId: string, approvedById: string, organizationId: string) {
  try {
    await requireRole(canApprovePromotions, 'согласование акции');

    await prisma.$executeRaw`
      UPDATE "Promotion"
      SET status = 'ACTIVE', "approvedById" = ${approvedById}, "approvedAt" = NOW(), updated_at = NOW()
      WHERE id = ${promotionId} AND "organizationId" = ${organizationId} AND status = 'DRAFT'
    `;

    const promos: any[] = await prisma.$queryRaw`SELECT name FROM "Promotion" WHERE id = ${promotionId} LIMIT 1`;
    const promoName = promos[0]?.name || '';
    const units: any[] = await prisma.$queryRaw`SELECT "unitId" FROM "PromotionUnit" WHERE "promotionId" = ${promotionId}`;

    await Promise.all(
      units.map((u: any) =>
        prisma.$executeRaw`
          INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "reason", "managerId", "organizationId", "createdAt")
          VALUES (${crypto.randomUUID()}, 'PROMOTION_ADDED', 'Unit', ${u.unitId}, ${`Объект добавлен в акцию: ${promoName}`}, ${approvedById}, ${organizationId}, NOW())
        `
      )
    );

    revalidatePath('/pricing');
    revalidatePath('/shakhmatka');
    return { success: true };
  } catch (error) {
    console.error('approvePromotion error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// ── Отмена акции (только РОП/админ) ──────────────────────────────────────────
export async function cancelPromotion(promotionId: string, organizationId: string) {
  try {
    await requireRole(canApprovePromotions, 'отмена акции');
    await prisma.$executeRaw`
      UPDATE "Promotion" SET status = 'CANCELLED', updated_at = NOW()
      WHERE id = ${promotionId} AND "organizationId" = ${organizationId}
    `;
    revalidatePath('/pricing');
    revalidatePath('/shakhmatka');
    return { success: true };
  } catch (error) {
    console.error('cancelPromotion error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// ── Удаление акции (только РОП/админ, и только пока черновик) ──────────────
export async function deletePromotion(promotionId: string, organizationId: string) {
  try {
    await requireRole(canApprovePromotions, 'удаление акции');
    await prisma.$executeRaw`
      DELETE FROM "Promotion" WHERE id = ${promotionId} AND "organizationId" = ${organizationId} AND status = 'DRAFT'
    `;
    revalidatePath('/pricing');
    return { success: true };
  } catch (error) {
    console.error('deletePromotion error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// ── Возврат к каталожной цене, если акция закончилась, а сделка не дошла до "Договор" ──
// Снапшот цены на сделке: цена фиксируется навсегда только когда сделка доходит до статуса
// "Договор" (Deal.priceLocked = true, см. updateDealStatus в actions/deals.ts). Пока сделка
// не зафиксирована, а акция, под которую она была рассчитана, уже закончилась (и помещение
// сейчас не участвует ни в какой другой активной акции) — сумма и график сделки откатываются
// на изначальную (каталожную) цену. Крон-джобы нет: проверка "ленивая", вызывается при
// каждой загрузке списка сделок (getDeals), поэтому откат происходит практически сразу
// после истечения акции, без ручных действий.
export async function reconcileExpiredPromoDeals(organizationId: string) {
  try {
    const stale: any[] = await prisma.$queryRaw`
      SELECT d.id, d."catalogPriceUSD", d."totalAmount"
      FROM "Deal" d
      WHERE d."organizationId" = ${organizationId}
        AND d."priceLocked" = false
        AND d."catalogPriceUSD" IS NOT NULL
        AND d."basePriceUSD" IS NOT NULL
        AND d."catalogPriceUSD" > d."basePriceUSD" + 0.01
        AND d.status NOT IN ('SUCCESS', 'FAILED', 'CANCELLED')
        AND NOT EXISTS (
          SELECT 1 FROM "Promotion" pr
          JOIN "PromotionUnit" pu ON pu."promotionId" = pr.id
          WHERE pu."unitId" = d."unitId"
            AND pr.status = 'ACTIVE'
            AND NOW() BETWEEN pr."startAt" AND pr."endAt"
        )
    `;

    for (const deal of stale) {
      const oldTotal = Number(deal.totalAmount) || 0;
      const ratio = oldTotal > 0 ? deal.catalogPriceUSD / oldTotal : 1;
      await prisma.$executeRaw`
        UPDATE "Deal"
        SET "totalAmount" = ${deal.catalogPriceUSD},
            "basePriceUSD" = ${deal.catalogPriceUSD},
            "discountPercent" = 0,
            "discountAmountUSD" = 0,
            "discountApprovedById" = NULL,
            "discountApprovedByRole" = NULL,
            "updatedAt" = NOW()
        WHERE id = ${deal.id}
      `;
      if (oldTotal > 0) {
        await prisma.$executeRaw`
          UPDATE "PaymentSchedule"
          SET "amount" = "amount" * ${ratio}, "updatedAt" = NOW()
          WHERE "dealId" = ${deal.id} AND status != 'PAID'
        `;
      }
    }
  } catch (error) {
    console.error('reconcileExpiredPromoDeals error:', error);
  }
}

// ── Карта активных акций по всем помещениям организации (для Шахматки) ──────
// Правило при пересечении акций на одном помещении (задел на будущее, когда
// пересечение станет разрешённым): чья акция началась раньше — та и действует
// до конца своего периода. Поэтому строки идут ORDER BY "startAt" ASC — вызывающая
// сторона должна брать ПЕРВОЕ вхождение на unitId, а не перезаписывать его последующими.
export async function getLivePromotionsMap(organizationId: string) {
  noStore();
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT pr.id as "promotionId", pr.name, pr."effectType", pr."effectValueType", pr."effectValue",
        pr."nbgRate", pr."startAt", pr."endAt", pu."unitId"
      FROM "Promotion" pr
      JOIN "PromotionUnit" pu ON pu."promotionId" = pr.id
      WHERE pr."organizationId" = ${organizationId}
        AND pr.status = 'ACTIVE'
        AND NOW() BETWEEN pr."startAt" AND pr."endAt"
      ORDER BY pr."startAt" ASC
    `;
    return rows;
  } catch (error) {
    console.error('getLivePromotionsMap error:', error);
    return [];
  }
}

// ── Активная акция для одного конкретного помещения (для карточки лида) ────
// См. комментарий у getLivePromotionsMap — при пересечении выигрывает та акция,
// что стартовала раньше (ORDER BY "startAt" ASC + LIMIT 1), детерминированно.
export async function getLivePromotionForUnit(unitId: string) {
  noStore();
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT pr.id as "promotionId", pr.name, pr."effectType", pr."effectValueType", pr."effectValue",
        pr."nbgRate", pr."startAt", pr."endAt"
      FROM "Promotion" pr
      JOIN "PromotionUnit" pu ON pu."promotionId" = pr.id
      WHERE pu."unitId" = ${unitId}
        AND pr.status = 'ACTIVE'
        AND NOW() BETWEEN pr."startAt" AND pr."endAt"
      ORDER BY pr."startAt" ASC
      LIMIT 1
    `;
    return rows[0] || null;
  } catch (error) {
    console.error('getLivePromotionForUnit error:', error);
    return null;
  }
}

// ── Лимиты применения акции (Общий / на клиента / на объект) ────────────────
// "Применение" = сделка (Deal), к которой привязана эта акция (Deal.promotionId, проставляется
// при сохранении графика в saveInstallmentPlanAction/savePaymentScheduleAction). Расторгнутые
// и провальные сделки (CANCELLED/FAILED) в счёт лимита не идут — место освобождается.
// excludeDealId — при пересохранении УЖЕ существующей сделки не считаем её саму.
export async function checkPromotionLimits(
  promotionId: string,
  unitId: string,
  leadId: string,
  excludeDealId?: string
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const promoRows: any[] = await prisma.$queryRaw`
      SELECT "totalLimit", "perClientLimit", "perUnitLimit" FROM "Promotion" WHERE id = ${promotionId} LIMIT 1
    `;
    const promo = promoRows[0];
    if (!promo) return { ok: true };

    if (promo.totalLimit != null) {
      const rows: any[] = await prisma.$queryRaw`
        SELECT COUNT(*)::int as cnt FROM "Deal"
        WHERE "promotionId" = ${promotionId} AND status NOT IN ('CANCELLED', 'FAILED')
          ${excludeDealId ? Prisma.sql`AND id != ${excludeDealId}` : Prisma.empty}
      `;
      if (rows[0].cnt >= promo.totalLimit) {
        return { ok: false, reason: `Общий лимит применений акции исчерпан (${promo.totalLimit})` };
      }
    }

    if (promo.perClientLimit != null && leadId) {
      const rows: any[] = await prisma.$queryRaw`
        SELECT COUNT(*)::int as cnt FROM "Deal"
        WHERE "promotionId" = ${promotionId} AND "leadId" = ${leadId} AND status NOT IN ('CANCELLED', 'FAILED')
          ${excludeDealId ? Prisma.sql`AND id != ${excludeDealId}` : Prisma.empty}
      `;
      if (rows[0].cnt >= promo.perClientLimit) {
        return { ok: false, reason: `Клиент уже использовал эту акцию максимальное число раз (${promo.perClientLimit})` };
      }
    }

    if (promo.perUnitLimit != null && unitId) {
      const rows: any[] = await prisma.$queryRaw`
        SELECT COUNT(*)::int as cnt FROM "Deal"
        WHERE "promotionId" = ${promotionId} AND "unitId" = ${unitId} AND status NOT IN ('CANCELLED', 'FAILED')
          ${excludeDealId ? Prisma.sql`AND id != ${excludeDealId}` : Prisma.empty}
      `;
      if (rows[0].cnt >= promo.perUnitLimit) {
        return { ok: false, reason: `Это помещение уже использовало данную акцию максимальное число раз (${promo.perUnitLimit})` };
      }
    }

    return { ok: true };
  } catch (error) {
    console.error('checkPromotionLimits error:', error);
    // Технический сбой проверки не должен блокировать сохранение сделки
    return { ok: true };
  }
}

// ── Аналитика по акциям (раздел 7 ТЗ) ────────────────────────────────────────
// Число и объём сделок с акцией, влияние на маржу (сумма скидки), использование лимитов.
export async function getPromotionAnalytics(organizationId: string) {
  noStore();
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        pr.id, pr.name, pr.status, pr."startAt", pr."endAt",
        pr."totalLimit", pr."perClientLimit", pr."perUnitLimit",
        (SELECT COUNT(*)::int FROM "PromotionUnit" WHERE "promotionId" = pr.id) as "unitsCount",
        (SELECT COUNT(*)::int FROM "Deal" WHERE "promotionId" = pr.id AND status NOT IN ('CANCELLED', 'FAILED')) as "activeDealsCount",
        (SELECT COUNT(*)::int FROM "Deal" WHERE "promotionId" = pr.id AND status = 'SUCCESS') as "wonDealsCount",
        (SELECT COUNT(*)::int FROM "Deal" WHERE "promotionId" = pr.id AND status IN ('CANCELLED', 'FAILED')) as "lostDealsCount",
        (SELECT COALESCE(SUM(d."catalogPriceUSD" - d."totalAmount"), 0)
           FROM "Deal" d
           WHERE d."promotionId" = pr.id AND d.status NOT IN ('CANCELLED', 'FAILED')
             AND d."catalogPriceUSD" IS NOT NULL AND d."totalAmount" IS NOT NULL) as "totalDiscountUSD",
        (SELECT COALESCE(SUM(d."totalAmount"), 0)
           FROM "Deal" d
           WHERE d."promotionId" = pr.id AND d.status NOT IN ('CANCELLED', 'FAILED')) as "totalRevenueUSD"
      FROM "Promotion" pr
      WHERE pr."organizationId" = ${organizationId}
      ORDER BY pr."createdAt" DESC
    `;
    return rows;
  } catch (error) {
    console.error('getPromotionAnalytics error:', error);
    return [];
  }
}
