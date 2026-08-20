'use server';

// Отделы (Ролевая модель, фаза 1) — см. "Ролевая модель.docx":
// TO-BE "Контроль работы отдела" + бизнес-правило BR-B06 ("Руководитель видит
// данные своей зоны ответственности, а не всей компании").
//
// Модель:
//   Department      — сам отдел (id, name, organizationId).
//   DepartmentHead   — кто отдел ВЕДЁТ (многие-ко-многим: один РОП может вести
//                      несколько отделов — прямое требование ТЗ: "Руководитель,
//                      ведущий несколько отделов, видит их все").
//   Manager.departmentId — в каком отделе состоит сотрудник (ровно один, как и
//                      сказано в ТЗ: "включает её (карточку) в СВОЙ отдел").
//
// Карточка сотрудника (создание Manager-записей) — отдельная фаза 2 ТЗ
// ("карточка сотрудника vs учётная запись"). Здесь мы только распределяем по
// отделам уже существующих сотрудников.

import { db as prisma, Prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { logAction } from '@/lib/logger';
import { canManageDepartments, canAssignDepartmentMembership, UserRole } from '@/lib/roles';
import { requireRole, getCurrentManagerId } from '@/lib/serverAuth';

// Лениво создаём таблицы/колонки при первом обращении — в проекте нет доступа
// к БД для отдельных миграций (см. остальные *.ts в actions/ — тот же приём).
export async function initDepartmentTables() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "Department" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "DepartmentHead" (
      "id" TEXT PRIMARY KEY,
      "departmentId" TEXT NOT NULL REFERENCES "Department"(id) ON DELETE CASCADE,
      "managerId" TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE ("departmentId", "managerId")
    )
  `;
  await prisma.$executeRaw`
    ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "departmentId" TEXT REFERENCES "Department"(id) ON DELETE SET NULL
  `;
  // Те же колонки роли, что заводит accounts.ts (фаза 2) — дублируем здесь идемпотентно
  // (IF NOT EXISTS), чтобы getManagersWithDepartment ниже могла их читать независимо
  // от порядка, в котором Promise.all в page.tsx разрешит параллельные вызовы.
  await prisma.$executeRaw`ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "role" TEXT`;
  await prisma.$executeRaw`ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "roleExpiresAt" TIMESTAMP`;
  await prisma.$executeRaw`ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "roleAssignedAt" TIMESTAMP`;
  await prisma.$executeRaw`ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "roleAssignedById" TEXT`;
  // Те же колонки распределения лидов, что заводит leadDistribution.ts (фаза 3) —
  // дублируем идемпотентно по той же причине (независимость от порядка Promise.all).
  await prisma.$executeRaw`ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "distributionRule" TEXT NOT NULL DEFAULT 'MANUAL'`;
  await prisma.$executeRaw`ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "availableForDistribution" BOOLEAN NOT NULL DEFAULT true`;
  await prisma.$executeRaw`ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "lastAssignedAt" TIMESTAMP`;
}

export interface DepartmentRow {
  id: string;
  name: string;
  organizationId: string;
  createdAt: string;
  headIds: string[];
  headNames: string[];
  memberCount: number;
  distributionRule: string;
}

// Список отделов с руководителями и количеством сотрудников — для админ-экрана.
export async function getDepartments(organizationId: string): Promise<DepartmentRow[]> {
  await initDepartmentTables();
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        d.id,
        d.name,
        d."organizationId",
        d."createdAt",
        d."distributionRule",
        COALESCE(
          (SELECT json_agg(json_build_object('id', m.id, 'name', m.name))
           FROM "DepartmentHead" dh
           JOIN "Manager" m ON m.id = dh."managerId"
           WHERE dh."departmentId" = d.id),
          '[]'::json
        ) as heads,
        (SELECT COUNT(*) FROM "Manager" mm WHERE mm."departmentId" = d.id) as "memberCount"
      FROM "Department" d
      WHERE d."organizationId" = ${organizationId}
      ORDER BY d.name ASC
    `;
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      organizationId: r.organizationId,
      createdAt: r.createdAt,
      headIds: (r.heads || []).map((h: any) => h.id),
      headNames: (r.heads || []).map((h: any) => h.name),
      memberCount: Number(r.memberCount) || 0,
      distributionRule: r.distributionRule || 'MANUAL',
    }));
  } catch (error) {
    console.error('getDepartments error:', error);
    return [];
  }
}

// Все сотрудники организации с указанием их текущего отдела — для UI назначения.
export async function getManagersWithDepartment(organizationId: string) {
  await initDepartmentTables();
  try {
    return await prisma.$queryRaw`
      SELECT m.id, m.name, m.status, m."departmentId", d.name as "departmentName",
        m."role", m."roleExpiresAt", m."availableForDistribution"
      FROM "Manager" m
      LEFT JOIN "Department" d ON d.id = m."departmentId"
      WHERE m."organizationId" = ${organizationId}
      ORDER BY m.name ASC
    `;
  } catch (error) {
    console.error('getManagersWithDepartment error:', error);
    return [];
  }
}

// Создание отдела — только администратор (RACI: "Создание отдела" R,A = Админ).
export async function createDepartment(name: string, organizationId: string, initiatorId: string) {
  await initDepartmentTables();
  try {
    await requireRole(canManageDepartments, 'создание отдела');
    if (!name.trim()) {
      return { success: false, error: 'Укажите название отдела' };
    }
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "Department" ("id", "name", "organizationId", "createdAt", "updatedAt")
      VALUES (${id}, ${name.trim()}, ${organizationId}, NOW(), NOW())
    `;
    logAction('Создание отдела', { departmentId: id, name, initiatorId });
    revalidatePath('/departments');
    return { success: true, id };
  } catch (error: any) {
    console.error('createDepartment error:', error);
    return { success: false, error: error.message || 'Ошибка сервера при создании отдела' };
  }
}

export async function renameDepartment(departmentId: string, name: string, initiatorId: string) {
  await initDepartmentTables();
  try {
    await requireRole(canManageDepartments, 'переименование отдела');
    if (!name.trim()) {
      return { success: false, error: 'Укажите название отдела' };
    }
    await prisma.$executeRaw`
      UPDATE "Department" SET "name" = ${name.trim()}, "updatedAt" = NOW() WHERE id = ${departmentId}
    `;
    logAction('Переименование отдела', { departmentId, name, initiatorId });
    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('renameDepartment error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// Удаление отдела — только если в нём не осталось сотрудников (без сирот-подчинённых).
export async function deleteDepartment(departmentId: string, initiatorId: string) {
  await initDepartmentTables();
  try {
    await requireRole(canManageDepartments, 'удаление отдела');
    const members: any[] = await prisma.$queryRaw`
      SELECT COUNT(*) as cnt FROM "Manager" WHERE "departmentId" = ${departmentId}
    `;
    if (Number(members[0]?.cnt) > 0) {
      return { success: false, error: 'В отделе ещё есть сотрудники — сначала переведите их в другой отдел' };
    }
    await prisma.$executeRaw`DELETE FROM "DepartmentHead" WHERE "departmentId" = ${departmentId}`;
    await prisma.$executeRaw`DELETE FROM "Department" WHERE id = ${departmentId}`;
    logAction('Удаление отдела', { departmentId, initiatorId });
    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('deleteDepartment error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// Назначить/снять руководителя отдела — администратор (продолжение права на создание отдела).
export async function setDepartmentHead(departmentId: string, managerId: string, organizationId: string, initiatorId: string) {
  await initDepartmentTables();
  try {
    await requireRole(canManageDepartments, 'назначение руководителя отдела');
    await prisma.$executeRaw`
      INSERT INTO "DepartmentHead" ("id", "departmentId", "managerId", "organizationId", "createdAt")
      VALUES (${crypto.randomUUID()}, ${departmentId}, ${managerId}, ${organizationId}, NOW())
      ON CONFLICT ("departmentId", "managerId") DO NOTHING
    `;
    logAction('Назначение руководителя отдела', { departmentId, managerId, initiatorId });
    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('setDepartmentHead error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

export async function removeDepartmentHead(departmentId: string, managerId: string, initiatorId: string) {
  await initDepartmentTables();
  try {
    await requireRole(canManageDepartments, 'снятие руководителя отдела');
    await prisma.$executeRaw`
      DELETE FROM "DepartmentHead" WHERE "departmentId" = ${departmentId} AND "managerId" = ${managerId}
    `;
    logAction('Снятие руководителя отдела', { departmentId, managerId, initiatorId });
    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('removeDepartmentHead error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// Включить сотрудника в отдел (или перевести в другой) — РОП отдела или администратор
// (RACI: "Включение сотрудника в отдел" R,A = РОП, R = Админ).
export async function assignManagerToDepartment(managerId: string, departmentId: string | null, initiatorId: string) {
  await initDepartmentTables();
  try {
    const role = await requireRole(canAssignDepartmentMembership, 'включение сотрудника в отдел');

    // РОП может распоряжаться составом только тех отделов, которые он реально
    // возглавляет — иначе через этот же server action можно было бы обойти UI
    // и добавлять/убирать людей в чужих отделах. Администратору ограничение не
    // применяется (у него нет "своего" отдела в этом смысле).
    if (role === 'rop') {
      const realManagerId = await getCurrentManagerId();
      const headed: any[] = await prisma.$queryRaw`
        SELECT "departmentId" FROM "DepartmentHead" WHERE "managerId" = ${realManagerId}
      `;
      const headedIds = new Set(headed.map(h => h.departmentId));

      if (departmentId && !headedIds.has(departmentId)) {
        return { success: false, error: 'Вы можете добавлять сотрудников только в отдел, который возглавляете' };
      }
      if (!departmentId) {
        const current: any[] = await prisma.$queryRaw`
          SELECT "departmentId" FROM "Manager" WHERE id = ${managerId}
        `;
        const currentDeptId = current[0]?.departmentId;
        if (currentDeptId && !headedIds.has(currentDeptId)) {
          return { success: false, error: 'Вы можете убрать сотрудника только из отдела, который возглавляете' };
        }
      }
    }

    await prisma.$executeRaw`
      UPDATE "Manager" SET "departmentId" = ${departmentId} WHERE id = ${managerId}
    `;
    logAction('Включение сотрудника в отдел', { managerId, departmentId, initiatorId });
    revalidatePath('/departments');
    return { success: true };
  } catch (error: any) {
    console.error('assignManagerToDepartment error:', error);
    return { success: false, error: error.message || 'Ошибка сервера' };
  }
}

// ── Видимость по отделам (BR-B06) ───────────────────────────────────────────
// Возвращает список managerId, чьи данные разрешено видеть текущему пользователю,
// или null, если ограничения не применяются (видит всё — админ/старший
// менеджер/юрист, как и раньше, а также РОП, который пока не назначен главой
// ни одного отдела — сознательно НЕ обрезаем ему видимость до появления
// отделов, чтобы фаза 1 не сломала доступ, пока админ не начал их заводить).
export async function getVisibleManagerIds(
  role: UserRole,
  managerId: string,
  organizationId: string
): Promise<string[] | null> {
  if (role !== 'rop') return null;
  await initDepartmentTables();
  try {
    const headed: any[] = await prisma.$queryRaw`
      SELECT "departmentId" FROM "DepartmentHead"
      WHERE "managerId" = ${managerId} AND "organizationId" = ${organizationId}
    `;
    const departmentIds = headed.map(h => h.departmentId);
    if (departmentIds.length === 0) return null;

    const members: any[] = await prisma.$queryRaw`
      SELECT id FROM "Manager" WHERE "departmentId" IN (${Prisma.join(departmentIds)})
    `;
    const ids = new Set<string>(members.map(m => m.id));
    ids.add(managerId);
    return Array.from(ids);
  } catch (error) {
    console.error('getVisibleManagerIds error:', error);
    return null;
  }
}

// Список id отделов, которые доступны текущей роли для просмотра пула лидов
// (Ролевая модель, фаза 3): null — доступны все отделы (админ, контакт-центр —
// у них сквозной доступ к пулу для первичной квалификации, см. ТЗ), массив —
// только перечисленные (РОП — те, что возглавляет, менеджер — свой отдел).
export async function getVisibleDepartmentIds(
  role: UserRole,
  managerId: string,
  organizationId: string
): Promise<string[] | null> {
  if (role === 'admin' || role === 'call_center') return null;
  await initDepartmentTables();
  try {
    if (role === 'rop') {
      const headed: any[] = await prisma.$queryRaw`
        SELECT "departmentId" FROM "DepartmentHead" WHERE "managerId" = ${managerId} AND "organizationId" = ${organizationId}
      `;
      return headed.map(h => h.departmentId);
    }
    // manager / senior_manager / lawyer — только свой отдел (если он есть)
    const own: any[] = await prisma.$queryRaw`SELECT "departmentId" FROM "Manager" WHERE id = ${managerId}`;
    return own[0]?.departmentId ? [own[0].departmentId] : [];
  } catch (error) {
    console.error('getVisibleDepartmentIds error:', error);
    return [];
  }
}
