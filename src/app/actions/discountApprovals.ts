'use server';

import { db as prisma } from '@/lib/db';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { requireRole, canApprovePromotions, getCurrentManagerId } from '@/lib/roles';
import { createNotification } from './notifications';

// Согласование скидки менеджера (Этап 2.1, уточнённая версия):
// ЛЮБАЯ скидка, предложенная ролью manager, не сохраняется сразу — уходит черновиком
// на подтверждение РОП/админа. Роли senior_manager/rop/admin сохраняют сразу
// (в рамках своего порога — эта часть уже была реализована и не меняется).
//
// Технически: исходные параметры сохранения графика (весь payload, каким он был бы
// передан в savePaymentScheduleAction/saveInstallmentPlanAction) сохраняются как есть,
// и при одобрении РОП/админ просто "проигрывается" тот же вызов от их имени —
// это гарантирует один-в-один тот же результат, что получил бы менеджер, если бы
// мог сохранить сам.
//
// Ролевая модель, фаза 4 (BR-B04, BR-B05) — раньше заявку видел и мог согласовать
// ЛЮБОЙ РОП/админ организации, независимо от того, чей это клиент и чей отдел.
// Теперь заявка адресуется руководителю ИМЕННО ТОГО отдела, где работает
// подавший менеджер; при вакансии руководителя (отдел без РОП) — эскалируется
// на админа. Порог, действовавший на момент подачи, фиксируется в заявке.

export async function initDiscountApprovalTables() {
  await prisma.$executeRaw`ALTER TABLE "DiscountApprovalRequest" ADD COLUMN IF NOT EXISTS "departmentId" TEXT`;
  await prisma.$executeRaw`ALTER TABLE "DiscountApprovalRequest" ADD COLUMN IF NOT EXISTS "addressedToManagerId" TEXT`;
  await prisma.$executeRaw`ALTER TABLE "DiscountApprovalRequest" ADD COLUMN IF NOT EXISTS "escalatedToAdmin" BOOLEAN NOT NULL DEFAULT false`;
  await prisma.$executeRaw`ALTER TABLE "DiscountApprovalRequest" ADD COLUMN IF NOT EXISTS "thresholdAtSubmission" DOUBLE PRECISION`;
}

// Определяет, кому адресовать заявку: руководителю(ям) отдела, где работает
// submittedById, либо эскалирует на админа, если отдела нет или в нём
// вакансия руководителя (BR-B04, TO-BE "При вакансии руководителя заявка
// эскалируется на администратора").
async function resolveApprovalRouting(submittedById: string) {
  const managerRows: any[] = await prisma.$queryRaw`SELECT "departmentId" FROM "Manager" WHERE id = ${submittedById}`;
  const departmentId = managerRows[0]?.departmentId || null;
  if (!departmentId) {
    return { departmentId: null, headManagerIds: [] as string[], escalatedToAdmin: true };
  }
  const heads: any[] = await prisma.$queryRaw`SELECT "managerId" FROM "DepartmentHead" WHERE "departmentId" = ${departmentId}`;
  if (heads.length === 0) {
    return { departmentId, headManagerIds: [] as string[], escalatedToAdmin: true };
  }
  return { departmentId, headManagerIds: heads.map((h: any) => h.managerId), escalatedToAdmin: false };
}

export async function submitDiscountApprovalRequest(data: {
  dealId: string;
  sourcePath: 'LEAD_DOSSIER' | 'SHAKHMATKA';
  proposedPayload: any;
  proposedDiscountPercent: number;
  submittedById: string;
  organizationId: string;
  thresholdAtSubmission?: number; // BR-B05: порог, действовавший на момент подачи
}) {
  await initDiscountApprovalTables();
  try {
    const routing = await resolveApprovalRouting(data.submittedById);

    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "DiscountApprovalRequest" (
        "id", "dealId", "sourcePath", "proposedPayload", "proposedDiscountPercent",
        "status", "submittedById", "organizationId", "createdAt",
        "departmentId", "addressedToManagerId", "escalatedToAdmin", "thresholdAtSubmission"
      ) VALUES (
        ${id}, ${data.dealId}, ${data.sourcePath}, ${JSON.stringify(data.proposedPayload)}, ${data.proposedDiscountPercent},
        'PENDING', ${data.submittedById}, ${data.organizationId}, NOW(),
        ${routing.departmentId}, ${routing.headManagerIds[0] || null}, ${routing.escalatedToAdmin}, ${data.thresholdAtSubmission ?? null}
      )
    `;

    // Уведомляем адресата — конкретных руководителей отдела, а если вакансия —
    // всех (managerId=null означает "всем", отфильтруется по роли на клиенте
    // через NotificationBell так же, как остальные системные уведомления).
    const notifyTargets = routing.headManagerIds.length > 0 ? routing.headManagerIds : [null];
    for (const targetManagerId of notifyTargets) {
      await createNotification({
        managerId: targetManagerId || undefined,
        role: routing.escalatedToAdmin ? 'admin' : undefined,
        type: 'SYSTEM',
        title: routing.escalatedToAdmin ? 'Заявка на скидку (нет руководителя отдела)' : 'Новая заявка на согласование скидки',
        body: `Скидка ${data.proposedDiscountPercent}% ожидает согласования.`,
        link: '/deals',
        organizationId: data.organizationId,
      });
    }

    revalidatePath('/deals');
    return { success: true, id };
  } catch (error) {
    console.error('submitDiscountApprovalRequest error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

export async function getPendingDiscountRequest(dealId: string) {
  noStore();
  await initDiscountApprovalTables();
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT r.*, m.name as "submittedByName"
      FROM "DiscountApprovalRequest" r
      LEFT JOIN "Manager" m ON r."submittedById" = m.id
      WHERE r."dealId" = ${dealId} AND r.status = 'PENDING'
      ORDER BY r."createdAt" DESC
      LIMIT 1
    `;
    return rows[0] || null;
  } catch (error) {
    console.error('getPendingDiscountRequest error:', error);
    return null;
  }
}

// BR-B04: заявку согласует руководитель отдела подавшего её менеджера, либо
// админ, если она эскалирована (вакансия руководителя). Админ может всё —
// РОП только "свои" отделы, и не может вмешиваться в эскалированные заявки
// (у него нет полномочий закрыть чужую вакансию руководителя).
async function assertCanReviewRequest(role: string, request: any): Promise<string | null> {
  if (role === 'admin') return null;
  if (role !== 'rop') return 'Недостаточно прав для согласования скидки';
  if (request.escalatedToAdmin) return 'Эта заявка эскалирована администратору (в отделе нет руководителя)';
  if (!request.departmentId) return null; // заявка создана до фазы 4 — без снапшота отдела, пропускаем как раньше
  const realManagerId = await getCurrentManagerId();
  const heads: any[] = await prisma.$queryRaw`
    SELECT 1 FROM "DepartmentHead" WHERE "managerId" = ${realManagerId} AND "departmentId" = ${request.departmentId}
  `;
  if (heads.length === 0) return 'Эту заявку может согласовать только руководитель отдела, в котором работает менеджер';
  return null;
}

export async function approveDiscountRequest(requestId: string, reviewedById: string, organizationId: string) {
  try {
    const role = await requireRole(canApprovePromotions, 'согласование скидки менеджера');

    const rows: any[] = await prisma.$queryRaw`
      SELECT * FROM "DiscountApprovalRequest" WHERE id = ${requestId} AND "organizationId" = ${organizationId} AND status = 'PENDING' LIMIT 1
    `;
    const request = rows[0];
    if (!request) return { success: false, error: 'Заявка не найдена или уже обработана' };

    const forbiddenReason = await assertCanReviewRequest(role, request);
    if (forbiddenReason) return { success: false, error: forbiddenReason };

    const payload = JSON.parse(request.proposedPayload);

    // Проигрываем сохранение от имени согласующего (его роль уже прошла бы порог)
    let result: any;
    if (request.sourcePath === 'LEAD_DOSSIER') {
      const { savePaymentScheduleAction } = await import('./leads');
      result = await savePaymentScheduleAction(payload);
    } else {
      const { saveInstallmentPlanAction } = await import('./deals');
      result = await saveInstallmentPlanAction(payload);
    }

    if (!result.success) {
      return { success: false, error: result.error || 'Не удалось применить одобренную скидку' };
    }

    await prisma.$executeRaw`
      UPDATE "DiscountApprovalRequest"
      SET status = 'APPROVED', "reviewedById" = ${reviewedById}, "reviewedAt" = NOW()
      WHERE id = ${requestId}
    `;

    revalidatePath('/deals');
    return { success: true };
  } catch (error) {
    console.error('approveDiscountRequest error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

export async function rejectDiscountRequest(requestId: string, reviewedById: string, organizationId: string) {
  try {
    const role = await requireRole(canApprovePromotions, 'отклонение скидки менеджера');

    const rows: any[] = await prisma.$queryRaw`
      SELECT * FROM "DiscountApprovalRequest" WHERE id = ${requestId} AND "organizationId" = ${organizationId} AND status = 'PENDING' LIMIT 1
    `;
    const request = rows[0];
    if (!request) return { success: false, error: 'Заявка не найдена или уже обработана' };

    const forbiddenReason = await assertCanReviewRequest(role, request);
    if (forbiddenReason) return { success: false, error: forbiddenReason };

    await prisma.$executeRaw`
      UPDATE "DiscountApprovalRequest"
      SET status = 'REJECTED', "reviewedById" = ${reviewedById}, "reviewedAt" = NOW()
      WHERE id = ${requestId} AND "organizationId" = ${organizationId} AND status = 'PENDING'
    `;
    revalidatePath('/deals');
    return { success: true };
  } catch (error) {
    console.error('rejectDiscountRequest error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}
