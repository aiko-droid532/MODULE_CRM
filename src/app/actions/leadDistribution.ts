'use server';

// Маршрутизация входящих лидов по отделам (Ролевая модель, фаза 3) — см.
// "Ролевая модель.docx", TO-BE "Распределение входящего лида" + BR-B01, BR-B08, BR-B09.
//
// AS-IS проблема, которую чиним: заявка создаёт лида без ответственного;
// "автораспределение" существует, но никого не назначает; менеджер сам
// нажимает кнопку и забирает лида без учёта того, чей это вообще ЖК; лид,
// который никто не взял, висит в общем списке бессрочно.
//
// Модель:
//   Project.departmentId          — какой отдел ведёт этот ЖК (BR-B08).
//   Department.distributionRule   — MANUAL | ROUND_ROBIN | LEAST_LOAD.
//   Manager.availableForDistribution / lastAssignedAt — кто сейчас может
//                                    получать новые лиды, и когда получал в
//                                    последний раз (для ROUND_ROBIN).
//   Lead.departmentId             — в какой отдел маршрутизирован лид (пул).
//   DistributionSettings          — отдел по умолчанию (если ЖК не сопоставлен
//                                    ни одному отделу) и SLA на распределение.

import { db as prisma, Prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { logAction } from '@/lib/logger';
import { requireRole, canManageSystem, getCurrentManagerId, UserRole } from '@/lib/roles';
import { initDepartmentTables } from './departments';
import { createNotification } from './notifications';

export type DistributionRule = 'MANUAL' | 'ROUND_ROBIN' | 'LEAST_LOAD';

export async function initDistributionTables() {
  await initDepartmentTables();
  await prisma.$executeRaw`ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "distributionRule" TEXT NOT NULL DEFAULT 'MANUAL'`;
  await prisma.$executeRaw`ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "availableForDistribution" BOOLEAN NOT NULL DEFAULT true`;
  await prisma.$executeRaw`ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "lastAssignedAt" TIMESTAMP`;
  await prisma.$executeRaw`ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "departmentId" TEXT REFERENCES "Department"(id) ON DELETE SET NULL`;
  await prisma.$executeRaw`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "departmentId" TEXT`;
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "DistributionSettings" (
      "organizationId" TEXT PRIMARY KEY,
      "defaultDepartmentId" TEXT,
      "slaMinutes" INT NOT NULL DEFAULT 15,
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
}

// Список ЖК с их текущим отделом — для админ-экрана привязки (BR-B08).
export async function getProjectsWithDepartment(organizationId: string) {
  await initDistributionTables();
  try {
    return await prisma.$queryRaw`
      SELECT p.id, p.name, p."nameRu", p."departmentId", d.name as "departmentName"
      FROM "Project" p
      LEFT JOIN "Department" d ON d.id = p."departmentId"
      WHERE p."organizationId" = ${organizationId}
      ORDER BY p.name ASC
    `;
  } catch (error) {
    console.error('getProjectsWithDepartment error:', error);
    return [];
  }
}

export async function getDistributionSettings(organizationId: string) {
  await initDistributionTables();
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT * FROM "DistributionSettings" WHERE "organizationId" = ${organizationId}
    `;
    return rows[0] || { organizationId, defaultDepartmentId: null, slaMinutes: 15 };
  } catch (error) {
    console.error('getDistributionSettings error:', error);
    return { organizationId, defaultDepartmentId: null, slaMinutes: 15 };
  }
}

// Отдел по умолчанию + SLA — параметр коммерческой политики (по аналогии с
// порогами скидок, BR-B05) — настраивает администратор через интерфейс.
export async function setDistributionSettings(data: {
  organizationId: string;
  defaultDepartmentId?: string | null;
  slaMinutes?: number;
  initiatorId: string;
}) {
  await initDistributionTables();
  try {
    await requireRole(canManageSystem, 'настройка распределения лидов');
    await prisma.$executeRaw`
      INSERT INTO "DistributionSettings" ("organizationId", "defaultDepartmentId", "slaMinutes", "updatedAt")
      VALUES (${data.organizationId}, ${data.defaultDepartmentId ?? null}, ${data.slaMinutes ?? 15}, NOW())
      ON CONFLICT ("organizationId") DO UPDATE SET
        "defaultDepartmentId" = ${data.defaultDepartmentId ?? null},
        "slaMinutes" = ${data.slaMinutes ?? 15},
        "updatedAt" = NOW()
    `;
    logAction('Настройка распределения лидов', data);
    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('setDistributionSettings error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// Правило распределения на отдел — руководитель этого отдела или админ
// (RACI "Настройка правила распределения лидов": R,A = РОП, C = Админ).
export async function setDepartmentDistributionRule(departmentId: string, rule: DistributionRule, initiatorId: string) {
  await initDistributionTables();
  try {
    const role = await requireRole(r => ['admin', 'rop'].includes(r), 'настройка правила распределения лидов');
    if (role === 'rop') {
      const realManagerId = await getCurrentManagerId();
      const headed: any[] = await prisma.$queryRaw`
        SELECT 1 FROM "DepartmentHead" WHERE "managerId" = ${realManagerId} AND "departmentId" = ${departmentId}
      `;
      if (headed.length === 0) return { success: false, error: 'Вы можете настраивать правило только для отдела, который возглавляете' };
    }
    await prisma.$executeRaw`UPDATE "Department" SET "distributionRule" = ${rule}, "updatedAt" = NOW() WHERE id = ${departmentId}`;
    logAction('Настройка правила распределения отдела', { departmentId, rule, initiatorId });
    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('setDepartmentDistributionRule error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// ЖК → отдел (BR-B08) — административная настройка каталога, как и создание
// самих отделов.
export async function setProjectDepartment(projectId: string, departmentId: string | null, initiatorId: string) {
  await initDistributionTables();
  try {
    await requireRole(canManageSystem, 'привязка ЖК к отделу');
    await prisma.$executeRaw`UPDATE "Project" SET "departmentId" = ${departmentId} WHERE id = ${projectId}`;
    logAction('Привязка ЖК к отделу', { projectId, departmentId, initiatorId });
    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('setProjectDepartment error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

export async function toggleManagerAvailability(managerId: string, available: boolean, initiatorId: string) {
  await initDistributionTables();
  try {
    await requireRole(r => ['admin', 'rop'].includes(r), 'изменение доступности сотрудника для распределения');
    await prisma.$executeRaw`UPDATE "Manager" SET "availableForDistribution" = ${available} WHERE id = ${managerId}`;
    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('toggleManagerAvailability error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// ── Определить отдел для лида: по ЖК интереса, иначе — отдел по умолчанию ──
async function resolveDepartmentForLead(organizationId: string, interestedProjectId?: string | null): Promise<string | null> {
  if (interestedProjectId) {
    const rows: any[] = await prisma.$queryRaw`SELECT "departmentId" FROM "Project" WHERE id = ${interestedProjectId}`;
    if (rows[0]?.departmentId) return rows[0].departmentId;
  }
  const settings = await getDistributionSettings(organizationId);
  return settings.defaultDepartmentId || null;
}

// ── Найти доступного сотрудника отдела по заданному правилу ────────────────
// "Наименьшая нагрузка" считается по ФАКТИЧЕСКИМ данным (живые лиды+сделки),
// а не по счётчику Manager.currentLoad — прямое требование ТЗ (тот счётчик
// расходится с реальностью, потому что меняется вручную в разных местах).
async function pickManagerForDepartment(departmentId: string, rule: DistributionRule): Promise<string | null> {
  if (rule === 'MANUAL') return null;

  if (rule === 'ROUND_ROBIN') {
    const rows: any[] = await prisma.$queryRaw`
      SELECT id FROM "Manager"
      WHERE "departmentId" = ${departmentId} AND "availableForDistribution" = true AND status = 'ACTIVE'
      ORDER BY "lastAssignedAt" ASC NULLS FIRST
      LIMIT 1
    `;
    return rows[0]?.id || null;
  }

  // LEAST_LOAD
  const rows: any[] = await prisma.$queryRaw`
    SELECT m.id,
      (
        (SELECT COUNT(*) FROM "Lead" l WHERE l."managerId" = m.id AND l.status NOT IN ('CONVERTED', 'LOST'))
        +
        (SELECT COUNT(*) FROM "Deal" d WHERE d."managerId" = m.id AND d.status NOT IN ('SUCCESS', 'FAILED', 'CANCELLED'))
      ) as "liveLoad"
    FROM "Manager" m
    WHERE m."departmentId" = ${departmentId} AND m."availableForDistribution" = true AND m.status = 'ACTIVE'
    ORDER BY "liveLoad" ASC, m."lastAssignedAt" ASC NULLS FIRST
    LIMIT 1
  `;
  return rows[0]?.id || null;
}

// ── Главный вход: маршрутизировать лид (при создании и при повторном вызове
// для ещё не разобранных лидов). Определяет отдел, назначает сотрудника по
// правилу отдела; если некого назначить — оставляет в пуле отдела и уведомляет
// руководителей отдела.
export async function distributeLead(leadId: string, organizationId: string) {
  await initDistributionTables();
  try {
    const leadRows: any[] = await prisma.$queryRaw`SELECT * FROM "Lead" WHERE id = ${leadId}`;
    const lead = leadRows[0];
    if (!lead) return { success: false, error: 'Лид не найден' };

    const departmentId = await resolveDepartmentForLead(organizationId, lead.interestedProjectId);

    if (!departmentId) {
      // Нет ни сопоставления по ЖК, ни отдела по умолчанию — оставляем как
      // есть (общий пул), это осознанный пробел в настройке, а не ошибка.
      return { success: true, departmentId: null, managerId: null };
    }

    const dept: any[] = await prisma.$queryRaw`SELECT "distributionRule" FROM "Department" WHERE id = ${departmentId}`;
    const rule = (dept[0]?.distributionRule || 'MANUAL') as DistributionRule;
    const pickedManagerId = await pickManagerForDepartment(departmentId, rule);

    if (pickedManagerId) {
      await prisma.$executeRaw`
        UPDATE "Lead" SET "departmentId" = ${departmentId}, "managerId" = ${pickedManagerId}, "assignedAt" = NOW(), "updatedAt" = NOW()
        WHERE id = ${leadId}
      `;
      await prisma.$executeRaw`UPDATE "Manager" SET "lastAssignedAt" = NOW() WHERE id = ${pickedManagerId}`;
    } else {
      // Остаётся в пуле отдела без ответственного — до ручного разбора
      // (MANUAL-правило) или пока не появится доступный сотрудник.
      await prisma.$executeRaw`
        UPDATE "Lead" SET "departmentId" = ${departmentId}, "updatedAt" = NOW()
        WHERE id = ${leadId} AND "managerId" IS NULL
      `;
      if (rule !== 'MANUAL') {
        // Правило требует авто-назначения, но назначить некого — это именно
        // та ситуация, о которой ТЗ просит уведомлять руководителя.
        const heads: any[] = await prisma.$queryRaw`
          SELECT "managerId" FROM "DepartmentHead" WHERE "departmentId" = ${departmentId}
        `;
        for (const h of heads) {
          await createNotification({
            managerId: h.managerId,
            type: 'SYSTEM',
            title: 'Лид в пуле без доступных сотрудников',
            body: `Новый лид «${lead.name}» не удалось автоматически распределить — в отделе нет доступных сотрудников.`,
            link: '/clients',
            organizationId,
          });
        }
      }
    }

    revalidatePath('/clients');
    return { success: true, departmentId, managerId: pickedManagerId };
  } catch (error: any) {
    console.error('distributeLead error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// Пул лидов отдела (без ответственного) — для экрана "Клиенты" и для
// контакт-центра (доступ к пулу для первичной квалификации).
export async function getDepartmentPool(organizationId: string, departmentIds: string[] | null) {
  await initDistributionTables();
  try {
    if (departmentIds && departmentIds.length === 0) return [];
    return await prisma.$queryRaw`
      SELECT l.*, d.name as "departmentName"
      FROM "Lead" l
      LEFT JOIN "Department" d ON d.id = l."departmentId"
      WHERE l."organizationId" = ${organizationId} AND l."managerId" IS NULL AND l.status NOT IN ('CONVERTED', 'LOST')
        ${departmentIds ? Prisma.sql`AND l."departmentId" IN (${Prisma.join(departmentIds)})` : Prisma.empty}
      ORDER BY l."createdAt" ASC
    `;
  } catch (error) {
    console.error('getDepartmentPool error:', error);
    return [];
  }
}

// Забрать лид из пула — та же кнопка "взять в работу", что и раньше, но
// теперь со скоупом по отделу (BR-B08): менеджер может забрать только лид
// своего отдела; контакт-центр — из любого (их работа — сквозная
// квалификация до передачи в отдел).
export async function claimPoolLead(leadId: string, managerId: string, organizationId: string) {
  await initDistributionTables();
  try {
    const role = await requireRole(r => ['admin', 'rop', 'senior_manager', 'manager', 'call_center'].includes(r), 'взять лида в работу');

    if (role !== 'admin' && role !== 'call_center') {
      const lead: any[] = await prisma.$queryRaw`SELECT "departmentId" FROM "Lead" WHERE id = ${leadId}`;
      const manager: any[] = await prisma.$queryRaw`SELECT "departmentId" FROM "Manager" WHERE id = ${managerId}`;
      const leadDept = lead[0]?.departmentId;
      const managerDept = manager[0]?.departmentId;
      if (leadDept && managerDept && leadDept !== managerDept) {
        return { success: false, error: 'Этот лид принадлежит другому отделу' };
      }
    }

    const affected = await prisma.$executeRaw`
      UPDATE "Lead"
      SET "managerId" = ${managerId}, "status" = 'IN_QUALIFICATION', "assignedAt" = NOW(), "updatedAt" = NOW()
      WHERE id = ${leadId} AND "managerId" IS NULL
    `;
    if (affected === 0) return { success: false, error: 'Лид уже взят в работу другим менеджером!' };

    await prisma.$executeRaw`UPDATE "Manager" SET "lastAssignedAt" = NOW() WHERE id = ${managerId}`;
    revalidatePath('/clients');
    return { success: true };
  } catch (error: any) {
    console.error('claimPoolLead error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// ── SLA (BR-B09): нераспределённый лид не может висеть без внимания дольше
// установленного срока. Живой аналог checkAndReleaseExpiredBookings в
// booking.ts — вызывается на загрузке страницы "Клиенты", т.к. в проекте нет
// отдельного крона.
export async function escalateExpiredLeads(organizationId: string) {
  await initDistributionTables();
  try {
    const settings = await getDistributionSettings(organizationId);
    const expired: any[] = await prisma.$queryRaw`
      SELECT l.id, l.name, l."departmentId"
      FROM "Lead" l
      WHERE l."organizationId" = ${organizationId}
        AND l."managerId" IS NULL
        AND l.status NOT IN ('CONVERTED', 'LOST')
        AND l."createdAt" < NOW() - (${settings.slaMinutes}::text || ' minutes')::interval
        AND l."escalatedAt" IS NULL
    `;

    for (const lead of expired) {
      await prisma.$executeRaw`UPDATE "Lead" SET "escalatedAt" = NOW(), "updatedAt" = NOW() WHERE id = ${lead.id}`;

      const heads: any[] = lead.departmentId
        ? await prisma.$queryRaw`SELECT "managerId" FROM "DepartmentHead" WHERE "departmentId" = ${lead.departmentId}`
        : [];
      const targets = heads.length > 0 ? heads.map((h: any) => h.managerId) : [null]; // null = уведомление без отдела уходит всем (см. createNotification)

      for (const targetManagerId of targets) {
        await createNotification({
          managerId: targetManagerId || undefined,
          type: 'SYSTEM',
          title: 'Просрочен SLA на распределение лида',
          body: `Лид «${lead.name}» уже более ${settings.slaMinutes} мин. без ответственного.`,
          link: '/clients',
          organizationId,
        });
      }
    }

    return { success: true, escalatedCount: expired.length };
  } catch (error) {
    console.error('escalateExpiredLeads error:', error);
    return { success: false, escalatedCount: 0 };
  }
}
