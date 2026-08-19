'use server';

// Отпуск, перевод, увольнение сотрудника (Ролевая модель, фаза 5) — см.
// "Ролевая модель.docx", TO-BE "Отпуск, перевод, увольнение" + BR-B02, BR-B03, BR-B07.
//
// AS-IS проблема: процедуры в системе нет вообще. Сделки и лиды остаются
// закреплёнными за отсутствующим сотрудником, учётная запись продолжает
// работать, пока кто-то не вмешается вручную, отпуск не отличается от
// увольнения.
//
// RACI "Увольнение и передача объектов": C = РОП, R,A = Админ, R = HR — в
// нашей системе роли HR нет (её и не было в UserRole), поэтому действие
// выполняет администратор от имени HR/по её запросу, как и с остальными
// операциями, где RACI ссылается на роли вне модели данных CRM.
//
// Модель:
//   Manager.status = 'TERMINATED'   — увольнение: блокирует доступ (BR-B07),
//                                     снимает членство в отделе.
//   Substitution                    — временное замещение на период отпуска,
//                                     с обязательной датой окончания. Действует
//                                     как диапазон дат — истекает сама, без
//                                     отдельного шага "отозвать".

import { db as prisma, Prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { logAction } from '@/lib/logger';
import { requireRole, canManageSystem, getCurrentManagerId } from '@/lib/roles';
import { createNotification } from './notifications';

const TERMINAL_LEAD_STATUSES = ['CONVERTED', 'LOST'];
const TERMINAL_DEAL_STATUSES = ['SUCCESS', 'FAILED', 'CANCELLED'];

export async function initLifecycleTables() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "Substitution" (
      "id" TEXT PRIMARY KEY,
      "managerId" TEXT NOT NULL,
      "substituteId" TEXT NOT NULL,
      "startDate" DATE NOT NULL,
      "endDate" DATE NOT NULL,
      "organizationId" TEXT NOT NULL,
      "createdById" TEXT NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "cancelledAt" TIMESTAMP
    )
  `;
  // Тот же журнал изменения прав, что заводит accounts.ts (фаза 2) — увольнение
  // тоже туда пишет (BR-B11), дублируем идемпотентно по той же причине, что и
  // в остальных фазах (независимость от порядка Promise.all).
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "PermissionAuditLog" (
      "id" TEXT PRIMARY KEY,
      "organizationId" TEXT NOT NULL,
      "targetManagerId" TEXT,
      "action" TEXT NOT NULL,
      "details" TEXT,
      "initiatorId" TEXT NOT NULL,
      "reason" TEXT,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
}

// ── Увольнение ───────────────────────────────────────────────────────────

// Объекты, требующие передачи перед увольнением (BR-B02) — только АКТИВНЫЕ
// (закрытые сделки/лиды не трогаем — BR-B03, история не переписывается).
export async function getPendingHandoverItems(managerId: string, organizationId: string) {
  try {
    const leads: any[] = await prisma.$queryRaw`
      SELECT id, name, phone, status FROM "Lead"
      WHERE "managerId" = ${managerId} AND "organizationId" = ${organizationId}
        AND status NOT IN (${Prisma.join(TERMINAL_LEAD_STATUSES)})
      ORDER BY "createdAt" DESC
    `;
    const deals: any[] = await prisma.$queryRaw`
      SELECT d.id, d."dealNumber", d.status, l.name as "clientName", u.number as "unitNumber"
      FROM "Deal" d
      LEFT JOIN "Lead" l ON l.id = d."leadId"
      LEFT JOIN "Unit" u ON u.id = d."unitId"
      WHERE d."managerId" = ${managerId} AND d."organizationId" = ${organizationId}
        AND d.status NOT IN (${Prisma.join(TERMINAL_DEAL_STATUSES)})
      ORDER BY d."createdAt" DESC
    `;
    return { leads, deals };
  } catch (error) {
    console.error('getPendingHandoverItems error:', error);
    return { leads: [], deals: [] };
  }
}

// Увольнение сотрудника: без преемника невозможно, если есть что передавать
// (BR-B02). Закрытые сделки/лиды не переназначаются (BR-B03). Доступ
// блокируется сразу (BR-B07) — см. также layout.tsx, где Manager.status
// проверяется на каждом заходе.
export async function terminateManager(data: {
  managerId: string;
  successorId?: string | null;
  reason: string;
  organizationId: string;
  initiatorId: string;
}) {
  await initLifecycleTables();
  try {
    await requireRole(canManageSystem, 'увольнение сотрудника');
    if (!data.reason?.trim()) {
      return { success: false, error: 'Укажите основание увольнения (для журнала изменения прав)' };
    }
    const actingManagerId = await getCurrentManagerId();
    if (actingManagerId && actingManagerId === data.managerId) {
      return { success: false, error: 'Нельзя увольнять самого себя — попросите другого администратора' };
    }

    const pending = await getPendingHandoverItems(data.managerId, data.organizationId);
    const totalPending = pending.leads.length + pending.deals.length;

    if (totalPending > 0 && !data.successorId) {
      return {
        success: false,
        error: `У сотрудника ${totalPending} незакрытых объектов (${pending.leads.length} лид(ов), ${pending.deals.length} сделок) — укажите преемника, чтобы их передать.`,
        pending,
      };
    }

    if (data.successorId) {
      await prisma.$executeRaw`
        UPDATE "Lead" SET "managerId" = ${data.successorId}, "updatedAt" = NOW()
        WHERE "managerId" = ${data.managerId} AND "organizationId" = ${data.organizationId}
          AND status NOT IN (${Prisma.join(TERMINAL_LEAD_STATUSES)})
      `;
      await prisma.$executeRaw`
        UPDATE "Deal" SET "managerId" = ${data.successorId}, "updatedAt" = NOW()
        WHERE "managerId" = ${data.managerId} AND "organizationId" = ${data.organizationId}
          AND status NOT IN (${Prisma.join(TERMINAL_DEAL_STATUSES)})
      `;
    }

    // Снимаем членство в отделе и руководство отделами — увольнение закрывает
    // и то, и другое (TO-BE: "закрывает членство в отделах").
    await prisma.$executeRaw`UPDATE "Manager" SET status = 'TERMINATED', "departmentId" = NULL WHERE id = ${data.managerId}`;
    await prisma.$executeRaw`DELETE FROM "DepartmentHead" WHERE "managerId" = ${data.managerId}`;

    await prisma.$executeRaw`
      INSERT INTO "PermissionAuditLog" ("id", "organizationId", "targetManagerId", "action", "details", "initiatorId", "reason", "createdAt")
      VALUES (${crypto.randomUUID()}, ${data.organizationId}, ${data.managerId}, 'TERMINATED',
        ${`Увольнение. Передано преемнику: ${totalPending} объект(ов) (${pending.leads.length} лид(ов), ${pending.deals.length} сделок).`},
        ${data.initiatorId}, ${data.reason}, NOW())
    `;

    if (data.successorId && totalPending > 0) {
      await createNotification({
        managerId: data.successorId,
        type: 'SYSTEM',
        title: 'Вам передали объекты уволенного сотрудника',
        body: `Передано ${pending.leads.length} лид(ов) и ${pending.deals.length} сделок.`,
        link: '/clients',
        organizationId: data.organizationId,
      });
    }

    revalidatePath('/departments');
    revalidatePath('/clients');
    revalidatePath('/deals');
    return { success: true, transferredLeads: pending.leads.length, transferredDeals: pending.deals.length };
  } catch (error: any) {
    console.error('terminateManager error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// ── Временное замещение (отпуск) ────────────────────────────────────────

export async function getSubstitutions(organizationId: string) {
  await initLifecycleTables();
  try {
    return await prisma.$queryRaw`
      SELECT s.*, m.name as "managerName", sub.name as "substituteName"
      FROM "Substitution" s
      LEFT JOIN "Manager" m ON m.id = s."managerId"
      LEFT JOIN "Manager" sub ON sub.id = s."substituteId"
      WHERE s."organizationId" = ${organizationId}
      ORDER BY s."endDate" DESC
    `;
  } catch (error) {
    console.error('getSubstitutions error:', error);
    return [];
  }
}

export async function createSubstitution(data: {
  managerId: string;
  substituteId: string;
  startDate: string;
  endDate: string;
  organizationId: string;
  initiatorId: string;
}) {
  await initLifecycleTables();
  try {
    await requireRole(canManageSystem, 'оформление временного замещения');
    if (!data.startDate || !data.endDate) {
      return { success: false, error: 'Дата окончания замещения обязательна' };
    }
    if (data.endDate < data.startDate) {
      return { success: false, error: 'Дата окончания раньше даты начала' };
    }
    if (data.managerId === data.substituteId) {
      return { success: false, error: 'Замещающий не может совпадать с замещаемым' };
    }

    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "Substitution" ("id", "managerId", "substituteId", "startDate", "endDate", "organizationId", "createdById", "createdAt")
      VALUES (${id}, ${data.managerId}, ${data.substituteId}, ${data.startDate}::date, ${data.endDate}::date, ${data.organizationId}, ${data.initiatorId}, NOW())
    `;

    logAction('Оформление временного замещения', data);
    await createNotification({
      managerId: data.substituteId,
      type: 'SYSTEM',
      title: 'Вас назначили временным замещением',
      body: `С ${data.startDate} по ${data.endDate} вы также видите и ведёте объекты коллеги.`,
      link: '/clients',
      organizationId: data.organizationId,
    });

    revalidatePath('/departments');
    return { success: true, id };
  } catch (error: any) {
    console.error('createSubstitution error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// Досрочная отмена — сотрудник вернулся раньше срока.
export async function cancelSubstitution(id: string, initiatorId: string) {
  await initLifecycleTables();
  try {
    await requireRole(canManageSystem, 'отмена временного замещения');
    await prisma.$executeRaw`UPDATE "Substitution" SET "cancelledAt" = NOW() WHERE id = ${id}`;
    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('cancelSubstitution error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// ── Эффективный набор id для "своих" записей ────────────────────────────
// Замещение действует как диапазон дат — истекает само, без отдельного шага
// "отозвать права" (TO-BE: "права отзываются автоматически"). Пока сегодня
// между startDate и endDate и замещение не отменено досрочно — замещающий
// видит объекты замещаемого как свои собственные везде, где сегодня
// применяется фильтр "managerId = я" (Сделки/Клиенты и т.п.).
export async function getEffectiveManagerIds(managerId: string, organizationId: string): Promise<string[]> {
  if (!managerId) return [managerId];
  await initLifecycleTables();
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT "managerId" FROM "Substitution"
      WHERE "substituteId" = ${managerId} AND "organizationId" = ${organizationId}
        AND "cancelledAt" IS NULL
        AND CURRENT_DATE BETWEEN "startDate" AND "endDate"
    `;
    const ids = new Set<string>([managerId, ...rows.map(r => r.managerId)]);
    return Array.from(ids);
  } catch (error) {
    console.error('getEffectiveManagerIds error:', error);
    return [managerId];
  }
}

// Заблокирован ли доступ (увольнение, BR-B07) — проверяется в layout.tsx на
// каждом заходе, тем же местом, что и очередь несвязанных учёток (фаза 2).
export async function isManagerTerminated(managerId: string): Promise<boolean> {
  if (!managerId) return false;
  try {
    const rows: any[] = await prisma.$queryRaw`SELECT status FROM "Manager" WHERE id = ${managerId} LIMIT 1`;
    return rows[0]?.status === 'TERMINATED';
  } catch (error) {
    console.error('isManagerTerminated error:', error);
    return false;
  }
}
