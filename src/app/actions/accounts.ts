'use server';

// Карточка сотрудника vs учётная запись (Ролевая модель, фаза 2) — см.
// "Ролевая модель.docx", TO-BE "Приём нового менеджера" + BR-B11.
//
// Проблема AS-IS: роль и учётная запись целиком живут во внешней системе
// (ERP/Supabase — см. JWT), а наша CRM только ЧИТАЕТ токен. Ни редактировать
// роль, ни создавать учётные записи оттуда мы не можем — нет доступа к их
// admin API. Поэтому роль в CRM (Manager.role/roleExpiresAt) СТАНОВИТСЯ
// источником истины и имеет приоритет над токеном, когда назначена и не
// истекла — это единственный способ выдавать полномочия "на период"
// (временная роль истекает сама, без похода во внешнюю систему).
//
// Модель:
//   UnlinkedAccount    — учётная запись, которая уже логинилась через ERP
//                        (есть валидный JWT), но карточки Manager с таким id
//                        ещё нет. Заполняется автоматически при каждом заходе
//                        (см. ensureAccountTracked, вызывается из layout.tsx).
//   PendingManagerCard — карточка сотрудника, заведённая РОП/админом ДО того,
//                        как человек первый раз зашёл в систему (ещё не имеет
//                        id учётной записи — только имя и отдел).
//   Manager.role / roleExpiresAt / roleAssignedAt / roleAssignedById —
//                        CRM-роль и её срок действия.
//   PermissionAuditLog — кто/когда/зачем менял роль, отдел, связывал учётку
//                        (BR-B11: "Любое изменение прав доступа имеет автора,
//                        время и основание").

import { db as prisma, Prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { logAction } from '@/lib/logger';
import {
  requireRole,
  canManageSystem,
  getCurrentManagerId,
  UserRole,
} from '@/lib/roles';
import { initDepartmentTables } from './departments';
// Примечание: resolveEffectiveRole (CRM-роль с приоритетом над токеном)
// физически определена в @/lib/roles — импортируйте её оттуда напрямую в
// page.tsx, чтобы не создавать цикл импортов между roles.ts и accounts.ts.

export async function initAccountTables() {
  await initDepartmentTables();
  await prisma.$executeRaw`
    ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "role" TEXT
  `;
  await prisma.$executeRaw`
    ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "roleExpiresAt" TIMESTAMP
  `;
  await prisma.$executeRaw`
    ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "roleAssignedAt" TIMESTAMP
  `;
  await prisma.$executeRaw`
    ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "roleAssignedById" TEXT
  `;
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "UnlinkedAccount" (
      "id" TEXT PRIMARY KEY,
      "organizationId" TEXT NOT NULL,
      "claimedName" TEXT,
      "claimedEmail" TEXT,
      "firstSeenAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "lastSeenAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "PendingManagerCard" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "departmentId" TEXT REFERENCES "Department"(id) ON DELETE SET NULL,
      "organizationId" TEXT NOT NULL,
      "createdById" TEXT,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
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

async function logPermissionChange(data: {
  organizationId: string;
  targetManagerId?: string | null;
  action: string;
  details: string;
  initiatorId: string;
  reason?: string | null;
}) {
  await prisma.$executeRaw`
    INSERT INTO "PermissionAuditLog" ("id", "organizationId", "targetManagerId", "action", "details", "initiatorId", "reason", "createdAt")
    VALUES (${crypto.randomUUID()}, ${data.organizationId}, ${data.targetManagerId || null}, ${data.action}, ${data.details}, ${data.initiatorId}, ${data.reason || null}, NOW())
  `;
}

// ── Отслеживание учётных записей — вызывается из layout.tsx на каждом заходе.
// Если карточки Manager с этим id ещё нет — фиксируем/обновляем в очереди
// несвязанных (BR: "сотрудник входит из ERP, система создаёт учётку и
// помещает её в очередь несвязанных"). Если карточка уже есть — ничего не
// делаем (обычный, самый частый путь — не тратим лишний запрос).
export async function ensureAccountTracked(
  managerId: string,
  organizationId: string,
  claimedName?: string | null,
  claimedEmail?: string | null
): Promise<boolean> {
  if (!managerId) return true;
  try {
    await initAccountTables();
    const existing: any[] = await prisma.$queryRaw`SELECT 1 FROM "Manager" WHERE id = ${managerId} LIMIT 1`;
    if (existing.length > 0) return true; // уже связан

    await prisma.$executeRaw`
      INSERT INTO "UnlinkedAccount" ("id", "organizationId", "claimedName", "claimedEmail", "firstSeenAt", "lastSeenAt")
      VALUES (${managerId}, ${organizationId}, ${claimedName || null}, ${claimedEmail || null}, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        "lastSeenAt" = NOW(),
        "claimedName" = COALESCE(EXCLUDED."claimedName", "UnlinkedAccount"."claimedName"),
        "claimedEmail" = COALESCE(EXCLUDED."claimedEmail", "UnlinkedAccount"."claimedEmail")
    `;
    return false; // не связан
  } catch (error) {
    console.error('ensureAccountTracked error:', error);
    return true; // не блокируем экран из-за сбоя БД
  }
}

export async function getUnlinkedAccounts(organizationId: string) {
  await initAccountTables();
  try {
    return await prisma.$queryRaw`
      SELECT * FROM "UnlinkedAccount" WHERE "organizationId" = ${organizationId} ORDER BY "firstSeenAt" DESC
    `;
  } catch (error) {
    console.error('getUnlinkedAccounts error:', error);
    return [];
  }
}

export async function getPendingManagerCards(organizationId: string) {
  await initAccountTables();
  try {
    return await prisma.$queryRaw`
      SELECT pc.*, d.name as "departmentName"
      FROM "PendingManagerCard" pc
      LEFT JOIN "Department" d ON d.id = pc."departmentId"
      WHERE pc."organizationId" = ${organizationId}
      ORDER BY pc."createdAt" DESC
    `;
  } catch (error) {
    console.error('getPendingManagerCards error:', error);
    return [];
  }
}

// Создание карточки сотрудника ДО первого входа — РОП или админ
// (RACI "Создание карточки сотрудника": R = РОП, R,A = Админ).
// РОП может сразу указать только отдел, который он возглавляет.
export async function createPendingManagerCard(
  name: string,
  departmentId: string | null,
  organizationId: string,
  initiatorId: string
) {
  await initAccountTables();
  try {
    const role = await requireRole(
      r => ['admin', 'rop'].includes(r),
      'создание карточки сотрудника'
    );
    if (!name.trim()) return { success: false, error: 'Укажите имя сотрудника' };

    if (role === 'rop' && departmentId) {
      const realManagerId = await getCurrentManagerId();
      const headed: any[] = await prisma.$queryRaw`
        SELECT 1 FROM "DepartmentHead" WHERE "managerId" = ${realManagerId} AND "departmentId" = ${departmentId}
      `;
      if (headed.length === 0) {
        return { success: false, error: 'Вы можете создавать карточки только для своего отдела' };
      }
    }

    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "PendingManagerCard" ("id", "name", "departmentId", "organizationId", "createdById", "createdAt")
      VALUES (${id}, ${name.trim()}, ${departmentId}, ${organizationId}, ${initiatorId}, NOW())
    `;
    await logPermissionChange({
      organizationId, targetManagerId: null, action: 'CARD_CREATED',
      details: `Создана карточка сотрудника «${name.trim()}»`, initiatorId,
    });
    revalidatePath('/departments');
    return { success: true, id };
  } catch (error: any) {
    console.error('createPendingManagerCard error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

export async function deletePendingManagerCard(cardId: string, initiatorId: string) {
  await initAccountTables();
  try {
    await requireRole(r => ['admin', 'rop'].includes(r), 'удаление карточки сотрудника');
    await prisma.$executeRaw`DELETE FROM "PendingManagerCard" WHERE id = ${cardId}`;
    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('deletePendingManagerCard error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// Связывание учётной записи с карточкой + назначение роли — ОДИН шаг,
// только администратор (RACI "Связывание учётной записи с сотрудником": I=РОП,
// R,A=Админ; "Назначение роли": R,A=Админ). pendingCardId необязателен — можно
// связать учётку сразу напрямую, указав имя/отдел на месте.
export async function linkAccountToCard(data: {
  accountId: string;
  pendingCardId?: string | null;
  name?: string;
  departmentId?: string | null;
  role: UserRole;
  roleExpiresAt?: string | null; // ISO-дата или null = бессрочно
  organizationId: string;
  initiatorId: string;
}) {
  await initAccountTables();
  try {
    await requireRole(canManageSystem, 'связывание учётной записи с карточкой сотрудника');

    let name = data.name?.trim() || '';
    let departmentId = data.departmentId ?? null;

    if (data.pendingCardId) {
      const cards: any[] = await prisma.$queryRaw`SELECT * FROM "PendingManagerCard" WHERE id = ${data.pendingCardId}`;
      if (cards.length === 0) return { success: false, error: 'Карточка не найдена' };
      name = cards[0].name;
      departmentId = cards[0].departmentId;
    }
    if (!name) return { success: false, error: 'Укажите имя сотрудника' };

    const existing: any[] = await prisma.$queryRaw`SELECT 1 FROM "Manager" WHERE id = ${data.accountId}`;
    if (existing.length > 0) return { success: false, error: 'Эта учётная запись уже связана с карточкой' };

    await prisma.$executeRaw`
      INSERT INTO "Manager" ("id", "name", "status", "currentLoad", "organizationId", "lastActiveAt", "departmentId", "role", "roleExpiresAt", "roleAssignedAt", "roleAssignedById")
      VALUES (${data.accountId}, ${name}, 'ACTIVE', 0, ${data.organizationId}, NOW(), ${departmentId}, ${data.role}, ${data.roleExpiresAt || null}, NOW(), ${data.initiatorId})
    `;

    if (data.pendingCardId) {
      await prisma.$executeRaw`DELETE FROM "PendingManagerCard" WHERE id = ${data.pendingCardId}`;
    }
    await prisma.$executeRaw`DELETE FROM "UnlinkedAccount" WHERE id = ${data.accountId}`;

    await logPermissionChange({
      organizationId: data.organizationId, targetManagerId: data.accountId, action: 'ACCOUNT_LINKED',
      details: `Учётная запись связана с карточкой «${name}», назначена роль «${data.role}»${data.roleExpiresAt ? ` до ${data.roleExpiresAt}` : ' (бессрочно)'}`,
      initiatorId: data.initiatorId,
    });

    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('linkAccountToCard error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// Изменение роли уже связанного сотрудника, в т.ч. "на период" — только
// администратор. reason обязателен (BR-B11 — основание изменения).
export async function setManagerRole(data: {
  managerId: string;
  role: UserRole;
  roleExpiresAt?: string | null;
  reason: string;
  organizationId: string;
  initiatorId: string;
}) {
  await initAccountTables();
  try {
    await requireRole(canManageSystem, 'назначение роли сотруднику');
    if (!data.reason?.trim()) {
      return { success: false, error: 'Укажите основание изменения роли (BR-B11)' };
    }

    const before: any[] = await prisma.$queryRaw`SELECT "role", "roleExpiresAt" FROM "Manager" WHERE id = ${data.managerId}`;
    if (before.length === 0) return { success: false, error: 'Сотрудник не найден' };

    await prisma.$executeRaw`
      UPDATE "Manager"
      SET "role" = ${data.role}, "roleExpiresAt" = ${data.roleExpiresAt || null}, "roleAssignedAt" = NOW(), "roleAssignedById" = ${data.initiatorId}
      WHERE id = ${data.managerId}
    `;

    await logPermissionChange({
      organizationId: data.organizationId, targetManagerId: data.managerId, action: 'ROLE_ASSIGNED',
      details: `Роль: «${before[0].role || '—'}» → «${data.role}»${data.roleExpiresAt ? `, до ${data.roleExpiresAt}` : ', бессрочно'}`,
      initiatorId: data.initiatorId, reason: data.reason,
    });

    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('setManagerRole error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// Журнал изменения прав — RACI "Разбор журнала изменения прав": C=РОП, R,A=Админ.
export async function getPermissionAuditLog(organizationId: string, limit: number = 200) {
  await initAccountTables();
  try {
    await requireRole(r => ['admin', 'rop'].includes(r), 'просмотр журнала изменения прав');
    return await prisma.$queryRaw`
      SELECT pal.*, m.name as "targetManagerName"
      FROM "PermissionAuditLog" pal
      LEFT JOIN "Manager" m ON m.id = pal."targetManagerId"
      WHERE pal."organizationId" = ${organizationId}
      ORDER BY pal."createdAt" DESC
      LIMIT ${limit}
    `;
  } catch (error) {
    console.error('getPermissionAuditLog error:', error);
    return [];
  }
}
