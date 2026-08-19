'use server';

import { db as prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import {
  requireRole,
  canManageDeals,
  canViewAllDeals,
  canApprovePromotions,
  getCurrentManagerId,
  getCurrentRole,
  ForbiddenError,
} from '@/lib/roles';
import { getVisibleManagerIds } from './departments';
import type { DebtRowStatus } from '@/lib/debtStatus';

const DEFAULT_GRACE_PERIOD_DAYS = 5;

// Реестр задолженности клиентов — таблицы создаются лениво при первом обращении
// (тот же приём, что и initContractTables в contracts.ts), чтобы не требовать
// отдельного шага миграции на проде.
export async function initDebtTables() {
  try {
    await prisma.$executeRaw`ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0`;
    await prisma.$executeRaw`ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP WITH TIME ZONE`;
    await prisma.$executeRaw`ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "confirmedById" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "confirmationBasis" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "exemptionReasonId" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "exemptionComment" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "exemptedById" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "exemptedAt" TIMESTAMP WITH TIME ZONE`;
    // Ставится при расторжении договора, если на строке была непогашенная задолженность (UC-4) —
    // строка не удаляется вместе с остальным планом рассрочки, а остаётся в истории реестра.
    await prisma.$executeRaw`ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "debtFrozenReason" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "gracePeriodDaysOverride" INTEGER`;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "DebtExemptionReason" (
        "id" TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "label" TEXT NOT NULL,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
    // Литерал вместо параметра: Postgres не позволяет плейсхолдеры в DEFAULT DDL-выражении.
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "DebtSettings" (
        "organizationId" TEXT PRIMARY KEY,
        "gracePeriodDays" INTEGER NOT NULL DEFAULT 5,
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
    return { success: true };
  } catch (error: any) {
    console.error('initDebtTables error:', error);
    return { success: false, error: error.message };
  }
}

// ─── Льготный период ────────────────────────────────────────────────────────

export async function getGracePeriodDays(organizationId: string): Promise<number> {
  await initDebtTables();
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT "gracePeriodDays" FROM "DebtSettings" WHERE "organizationId" = ${organizationId} LIMIT 1
    `;
    return rows[0]?.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS;
  } catch (error) {
    console.error('getGracePeriodDays error:', error);
    return DEFAULT_GRACE_PERIOD_DAYS;
  }
}

// Настройка льготного периода — по ТЗ (2.3 Роли) это зона администратора,
// РОП добавлен туда же по аналогии с остальными настроечными справочниками модуля.
export async function updateGracePeriodDays(organizationId: string, days: number) {
  await initDebtTables();
  try {
    await requireRole(canApprovePromotions, 'изменение льготного периода');
    await prisma.$executeRaw`
      INSERT INTO "DebtSettings" ("organizationId", "gracePeriodDays", "updatedAt")
      VALUES (${organizationId}, ${days}, NOW())
      ON CONFLICT ("organizationId") DO UPDATE SET "gracePeriodDays" = ${days}, "updatedAt" = NOW()
    `;
    revalidatePath('/debts');
    return { success: true };
  } catch (error: any) {
    if (error instanceof ForbiddenError) return { success: false, error: error.message };
    console.error('updateGracePeriodDays error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// Переопределение льготного периода на уровне конкретного договора (см. FR-CD-03)
export async function updateDealGracePeriodOverride(dealId: string, days: number | null, organizationId: string) {
  await initDebtTables();
  try {
    await requireRole(canApprovePromotions, 'изменение льготного периода по договору');
    await prisma.$executeRaw`
      UPDATE "Deal" SET "gracePeriodDaysOverride" = ${days}, "updatedAt" = NOW()
      WHERE id = ${dealId} AND "organizationId" = ${organizationId}
    `;
    revalidatePath('/debts');
    return { success: true };
  } catch (error: any) {
    if (error instanceof ForbiddenError) return { success: false, error: error.message };
    console.error('updateDealGracePeriodOverride error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// ─── Справочник причин освобождения от долга (FR-CD-09, BR-07) ────────────────

export async function getExemptionReasons(organizationId: string, includeInactive?: boolean) {
  await initDebtTables();
  try {
    const rows: any[] = includeInactive
      ? await prisma.$queryRaw`SELECT * FROM "DebtExemptionReason" WHERE "organizationId" = ${organizationId} ORDER BY "createdAt" ASC`
      : await prisma.$queryRaw`SELECT * FROM "DebtExemptionReason" WHERE "organizationId" = ${organizationId} AND "active" = true ORDER BY "createdAt" ASC`;
    return rows;
  } catch (error) {
    console.error('getExemptionReasons error:', error);
    return [];
  }
}

export async function createExemptionReason(organizationId: string, label: string) {
  await initDebtTables();
  try {
    await requireRole(canApprovePromotions, 'создание причины освобождения от долга');
    if (!label.trim()) return { success: false, error: 'Укажите название причины' };
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "DebtExemptionReason" ("id", "organizationId", "label", "active", "createdAt")
      VALUES (${id}, ${organizationId}, ${label.trim()}, true, NOW())
    `;
    revalidatePath('/debts');
    return { success: true, id };
  } catch (error: any) {
    if (error instanceof ForbiddenError) return { success: false, error: error.message };
    console.error('createExemptionReason error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

export async function setExemptionReasonActive(id: string, active: boolean) {
  await initDebtTables();
  try {
    await requireRole(canApprovePromotions, 'изменение справочника причин освобождения от долга');
    await prisma.$executeRaw`UPDATE "DebtExemptionReason" SET "active" = ${active} WHERE id = ${id}`;
    revalidatePath('/debts');
    return { success: true };
  } catch (error: any) {
    if (error instanceof ForbiddenError) return { success: false, error: error.message };
    console.error('setExemptionReasonActive error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// ─── Расчёт статуса строки графика (BR-01, BR-02, BR-06) ───────────────────────

function computeDebtStatus(row: any, gracePeriodDays: number, now: Date): { status: DebtRowStatus; daysOverdue: number } {
  const amount = Number(row.amount) || 0;
  const paid = Number(row.paidAmount) || 0;

  if (row.debtFrozenReason) return { status: 'CONTRACT_CANCELLED_UNPAID', daysOverdue: 0 };
  if (row.exemptionReasonId) return { status: 'EXEMPTED', daysOverdue: 0 };
  if (paid >= amount && amount > 0) return { status: 'PAID', daysOverdue: 0 };

  const dueWithGrace = new Date(row.dueDate);
  dueWithGrace.setDate(dueWithGrace.getDate() + gracePeriodDays);
  const isOverdue = now.getTime() > dueWithGrace.getTime();
  const daysOverdue = isOverdue ? Math.floor((now.getTime() - dueWithGrace.getTime()) / (1000 * 60 * 60 * 24)) : 0;

  if (isOverdue && paid > 0) return { status: 'PARTIALLY_PAID', daysOverdue };
  if (isOverdue) return { status: 'OVERDUE', daysOverdue };
  return { status: 'PENDING', daysOverdue: 0 };
}

// ─── Реестр задолженности (FR-CD-06, FR-CD-07) ─────────────────────────────────
// Возвращает только строки, представляющие реальную задолженность (текущую или
// исторически зафиксированную) — Ожидается/Оплачена целиком сюда не попадают.

export async function getDebtRegistry(organizationId: string) {
  await initDebtTables();
  try {
    const role = await requireRole(canManageDeals, 'просмотр реестра задолженности');
    const myManagerId = await getCurrentManagerId();
    const seeAll = canViewAllDeals(role);
    // Отделы (Ролевая модель, фаза 1): у РОП с назначенными отделами seeAll всё
    // так же true, но видимость дополнительно сужается до его отделов.
    const visibleManagerIds = await getVisibleManagerIds(role, myManagerId, organizationId);

    const rows: any[] = await prisma.$queryRaw`
      SELECT
        ps.id as "scheduleId",
        ps."dueDate",
        ps.amount,
        ps."paidAmount",
        ps."confirmedAt",
        ps."confirmedById",
        ps."confirmationBasis",
        ps."exemptionReasonId",
        ps."exemptionComment",
        ps."exemptedAt",
        ps."debtFrozenReason",
        er.label as "exemptionReasonLabel",
        d.id as "dealId",
        d."managerId",
        d."gracePeriodDaysOverride",
        l.name as "clientName",
        l.phone as "clientPhone",
        u.number as "unitNumber",
        p.name as "projectName"
      FROM "PaymentSchedule" ps
      JOIN "Deal" d ON ps."dealId" = d.id
      LEFT JOIN "Lead" l ON d."leadId" = l.id
      LEFT JOIN "Unit" u ON d."unitId" = u.id
      LEFT JOIN "Block" b ON u."blockId" = b.id
      LEFT JOIN "Project" p ON b."projectId" = p.id
      LEFT JOIN "DebtExemptionReason" er ON ps."exemptionReasonId" = er.id
      WHERE ps."organizationId" = ${organizationId}
        AND ps.status != 'PAID'
      ORDER BY ps."dueDate" ASC
    `;

    const defaultGrace = await getGracePeriodDays(organizationId);
    const now = new Date();

    return rows
      .filter(r => visibleManagerIds ? visibleManagerIds.includes(r.managerId) : (seeAll || r.managerId === myManagerId))
      .map(r => mapDebtRow(r, defaultGrace, now))
      .filter(activeOrHistoricalDebtRow);
  } catch (error) {
    console.error('getDebtRegistry error:', error);
    return [];
  }
}

function mapDebtRow(r: any, defaultGrace: number, now: Date) {
  const grace = r.gracePeriodDaysOverride ?? defaultGrace;
  const { status, daysOverdue } = computeDebtStatus(r, grace, now);
  return {
    scheduleId: r.scheduleId,
    dealId: r.dealId,
    managerId: r.managerId,
    dueDate: r.dueDate,
    amount: Number(r.amount) || 0,
    paidAmount: Number(r.paidAmount) || 0,
    debtAmount: Math.max(0, (Number(r.amount) || 0) - (Number(r.paidAmount) || 0)),
    status,
    daysOverdue,
    clientName: r.clientName,
    clientPhone: r.clientPhone,
    unitNumber: r.unitNumber,
    projectName: r.projectName,
    exemptionReasonLabel: r.exemptionReasonLabel,
    exemptionComment: r.exemptionComment,
    confirmationBasis: r.confirmationBasis,
  };
}

function activeOrHistoricalDebtRow(r: { status: string }) {
  return r.status === 'OVERDUE' || r.status === 'PARTIALLY_PAID' || r.status === 'EXEMPTED' || r.status === 'CONTRACT_CANCELLED_UNPAID';
}

// Блок задолженности в карточке договора/сделки (FR-CD-10)
export async function getDebtRowsForDeal(dealId: string, organizationId: string) {
  await initDebtTables();
  try {
    await requireRole(canManageDeals, 'просмотр задолженности по сделке');
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        ps.id as "scheduleId", ps."dueDate", ps.amount, ps."paidAmount",
        ps."confirmedAt", ps."confirmedById", ps."confirmationBasis",
        ps."exemptionReasonId", ps."exemptionComment", ps."exemptedAt", ps."debtFrozenReason",
        er.label as "exemptionReasonLabel",
        d.id as "dealId", d."managerId", d."gracePeriodDaysOverride",
        l.name as "clientName", l.phone as "clientPhone",
        u.number as "unitNumber", p.name as "projectName"
      FROM "PaymentSchedule" ps
      JOIN "Deal" d ON ps."dealId" = d.id
      LEFT JOIN "Lead" l ON d."leadId" = l.id
      LEFT JOIN "Unit" u ON d."unitId" = u.id
      LEFT JOIN "Block" b ON u."blockId" = b.id
      LEFT JOIN "Project" p ON b."projectId" = p.id
      LEFT JOIN "DebtExemptionReason" er ON ps."exemptionReasonId" = er.id
      WHERE ps."dealId" = ${dealId} AND ps."organizationId" = ${organizationId} AND ps.status != 'PAID'
      ORDER BY ps."dueDate" ASC
    `;
    const defaultGrace = await getGracePeriodDays(organizationId);
    const now = new Date();
    return rows.map(r => mapDebtRow(r, defaultGrace, now)).filter(activeOrHistoricalDebtRow);
  } catch (error) {
    console.error('getDebtRowsForDeal error:', error);
    return [];
  }
}

// Блок задолженности в карточке клиента — агрегированно по всем сделкам лида (FR-CD-10)
export async function getDebtRowsForLead(leadId: string, organizationId: string) {
  await initDebtTables();
  try {
    await requireRole(canManageDeals, 'просмотр задолженности по клиенту');
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        ps.id as "scheduleId", ps."dueDate", ps.amount, ps."paidAmount",
        ps."confirmedAt", ps."confirmedById", ps."confirmationBasis",
        ps."exemptionReasonId", ps."exemptionComment", ps."exemptedAt", ps."debtFrozenReason",
        er.label as "exemptionReasonLabel",
        d.id as "dealId", d."managerId", d."gracePeriodDaysOverride",
        l.name as "clientName", l.phone as "clientPhone",
        u.number as "unitNumber", p.name as "projectName"
      FROM "PaymentSchedule" ps
      JOIN "Deal" d ON ps."dealId" = d.id
      LEFT JOIN "Lead" l ON d."leadId" = l.id
      LEFT JOIN "Unit" u ON d."unitId" = u.id
      LEFT JOIN "Block" b ON u."blockId" = b.id
      LEFT JOIN "Project" p ON b."projectId" = p.id
      LEFT JOIN "DebtExemptionReason" er ON ps."exemptionReasonId" = er.id
      WHERE d."leadId" = ${leadId} AND ps."organizationId" = ${organizationId} AND ps.status != 'PAID'
      ORDER BY ps."dueDate" ASC
    `;
    const defaultGrace = await getGracePeriodDays(organizationId);
    const now = new Date();
    return rows.map(r => mapDebtRow(r, defaultGrace, now)).filter(activeOrHistoricalDebtRow);
  } catch (error) {
    console.error('getDebtRowsForLead error:', error);
    return [];
  }
}

// ─── Подтверждение оплаты (FR-CD-04, BR-03, BR-04, BR-06) ──────────────────────
// Снять статус "Просрочена" может только менеджер, ответственный за сделку
// (или админ — системная подстраховка). РОП такого права не имеет — только просмотр.

async function assertDealOwnership(dealId: string, organizationId: string) {
  const role = await getCurrentRole();
  const myManagerId = await getCurrentManagerId();
  const rows: any[] = await prisma.$queryRaw`
    SELECT "managerId" FROM "Deal" WHERE id = ${dealId} AND "organizationId" = ${organizationId} LIMIT 1
  `;
  const deal = rows[0];
  if (!deal) throw new Error('Сделка не найдена');
  if (role !== 'admin' && deal.managerId !== myManagerId) {
    throw new ForbiddenError('действие по задолженности этой сделки — не ваша сделка');
  }
  return { role, myManagerId, deal };
}

export async function confirmDebtPayment(data: {
  scheduleId: string;
  dealId: string;
  amount: number;
  paymentDate: string;
  basis: string;
  organizationId: string;
}) {
  await initDebtTables();
  try {
    await requireRole(canManageDeals, 'подтверждение оплаты по задолженности');
    await assertDealOwnership(data.dealId, data.organizationId);

    if (!data.basis?.trim()) {
      return { success: false, error: 'Укажите основание (скриншот/квитанция перевода)' };
    }
    if (!data.amount || data.amount <= 0) {
      return { success: false, error: 'Сумма оплаты должна быть больше нуля' };
    }

    const myManagerId = await getCurrentManagerId();
    const rows: any[] = await prisma.$queryRaw`
      SELECT amount, "paidAmount" FROM "PaymentSchedule" WHERE id = ${data.scheduleId} AND "dealId" = ${data.dealId} LIMIT 1
    `;
    const row = rows[0];
    if (!row) return { success: false, error: 'Строка графика не найдена' };

    const newPaid = Math.min(Number(row.amount), (Number(row.paidAmount) || 0) + data.amount);
    const isFullyPaid = newPaid >= Number(row.amount);

    await prisma.$executeRaw`
      UPDATE "PaymentSchedule"
      SET "paidAmount" = ${newPaid},
          "confirmedAt" = ${data.paymentDate ? new Date(data.paymentDate) : new Date()},
          "confirmedById" = ${myManagerId},
          "confirmationBasis" = ${data.basis.trim()},
          "status" = ${isFullyPaid ? 'PAID' : 'PENDING'}::"PaymentStatus",
          "updatedAt" = NOW()
      WHERE id = ${data.scheduleId}
    `;

    await prisma.$executeRaw`
      INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "managerId", "fieldName", "oldValue", "newValue", "reason", "organizationId", "createdAt")
      VALUES (
        ${crypto.randomUUID()}, 'UPDATE', 'PaymentSchedule', ${data.scheduleId}, ${myManagerId},
        'debtConfirmedPayment', ${String(row.paidAmount || 0)}, ${String(newPaid)}, ${data.basis.trim()}, ${data.organizationId}, NOW()
      )
    `;

    revalidatePath('/debts');
    return { success: true, fullyPaid: isFullyPaid };
  } catch (error: any) {
    if (error instanceof ForbiddenError) return { success: false, error: error.message };
    console.error('confirmDebtPayment error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// ─── Освобождение от статуса "Просрочена" без оплаты (FR-CD-09, BR-07) ─────────

export async function applyDebtExemption(data: {
  scheduleId: string;
  dealId: string;
  reasonId: string;
  comment: string;
  organizationId: string;
}) {
  await initDebtTables();
  try {
    await requireRole(canManageDeals, 'освобождение от статуса задолженности');
    await assertDealOwnership(data.dealId, data.organizationId);

    if (!data.comment?.trim()) {
      return { success: false, error: 'Комментарий обязателен' };
    }
    if (!data.reasonId) {
      return { success: false, error: 'Выберите причину освобождения' };
    }

    const myManagerId = await getCurrentManagerId();

    await prisma.$executeRaw`
      UPDATE "PaymentSchedule"
      SET "exemptionReasonId" = ${data.reasonId},
          "exemptionComment" = ${data.comment.trim()},
          "exemptedById" = ${myManagerId},
          "exemptedAt" = NOW(),
          "updatedAt" = NOW()
      WHERE id = ${data.scheduleId}
    `;

    await prisma.$executeRaw`
      INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "managerId", "fieldName", "oldValue", "newValue", "reason", "organizationId", "createdAt")
      VALUES (
        ${crypto.randomUUID()}, 'UPDATE', 'PaymentSchedule', ${data.scheduleId}, ${myManagerId},
        'debtExemptionApplied', 'OVERDUE', ${data.reasonId}, ${data.comment.trim()}, ${data.organizationId}, NOW()
      )
    `;

    revalidatePath('/debts');
    return { success: true };
  } catch (error: any) {
    if (error instanceof ForbiddenError) return { success: false, error: error.message };
    console.error('applyDebtExemption error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// ─── Отчёт-выборка для РОП (FR-CD-18, UC-5) ────────────────────────────────────
// Последние подтверждения оплаты и применённые причины освобождения по отделу —
// для выборочного контроля обоснованности действий менеджеров. Смотрит РОП/админ,
// сам менеджер права подтверждать/списывать долг проверить задним числом не может.

export async function getDebtAuditSample(organizationId: string, limit: number = 100) {
  await initDebtTables();
  try {
    await requireRole(canApprovePromotions, 'просмотр отчёта-выборки по задолженности');

    const rows: any[] = await prisma.$queryRaw`
      SELECT
        al.id, al."fieldName", al."oldValue", al."newValue", al."reason", al."createdAt",
        m.name as "managerName",
        al."managerId",
        l.name as "clientName",
        u.number as "unitNumber",
        p.name as "projectName",
        er.label as "exemptionReasonLabel"
      FROM "AuditLog" al
      LEFT JOIN "Manager" m ON al."managerId" = m.id
      LEFT JOIN "PaymentSchedule" ps ON al."entityId" = ps.id
      LEFT JOIN "Deal" d ON ps."dealId" = d.id
      LEFT JOIN "Lead" l ON d."leadId" = l.id
      LEFT JOIN "Unit" u ON d."unitId" = u.id
      LEFT JOIN "Block" b ON u."blockId" = b.id
      LEFT JOIN "Project" p ON b."projectId" = p.id
      LEFT JOIN "DebtExemptionReason" er ON al."newValue" = er.id AND al."fieldName" = 'debtExemptionApplied'
      WHERE al."organizationId" = ${organizationId}
        AND al."entityType" = 'PaymentSchedule'
        AND al."fieldName" IN ('debtConfirmedPayment', 'debtExemptionApplied')
      ORDER BY al."createdAt" DESC
      LIMIT ${limit}
    `;

    return rows.map(r => ({
      id: r.id,
      type: r.fieldName === 'debtConfirmedPayment' ? 'CONFIRMED' : 'EXEMPTED',
      createdAt: r.createdAt,
      managerName: r.managerName || r.managerId,
      clientName: r.clientName,
      unitNumber: r.unitNumber,
      projectName: r.projectName,
      // Подтверждение: oldValue/newValue — сумма оплачено-было/стало; reason — основание.
      // Освобождение: reason — комментарий, exemptionReasonLabel — причина из справочника.
      oldValue: r.oldValue,
      newValue: r.newValue,
      reason: r.reason,
      exemptionReasonLabel: r.exemptionReasonLabel,
    }));
  } catch (error) {
    console.error('getDebtAuditSample error:', error);
    return [];
  }
}
