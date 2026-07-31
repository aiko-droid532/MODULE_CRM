'use server';

import { db as prisma } from '@/lib/db';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { requireRole, canApprovePromotions } from '@/lib/roles';

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

export async function submitDiscountApprovalRequest(data: {
  dealId: string;
  sourcePath: 'LEAD_DOSSIER' | 'SHAKHMATKA';
  proposedPayload: any;
  proposedDiscountPercent: number;
  submittedById: string;
  organizationId: string;
}) {
  try {
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "DiscountApprovalRequest" (
        "id", "dealId", "sourcePath", "proposedPayload", "proposedDiscountPercent",
        "status", "submittedById", "organizationId", "createdAt"
      ) VALUES (
        ${id}, ${data.dealId}, ${data.sourcePath}, ${JSON.stringify(data.proposedPayload)}, ${data.proposedDiscountPercent},
        'PENDING', ${data.submittedById}, ${data.organizationId}, NOW()
      )
    `;
    revalidatePath('/deals');
    return { success: true, id };
  } catch (error) {
    console.error('submitDiscountApprovalRequest error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

export async function getPendingDiscountRequest(dealId: string) {
  noStore();
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

export async function approveDiscountRequest(requestId: string, reviewedById: string, organizationId: string) {
  try {
    await requireRole(canApprovePromotions, 'согласование скидки менеджера');

    const rows: any[] = await prisma.$queryRaw`
      SELECT * FROM "DiscountApprovalRequest" WHERE id = ${requestId} AND "organizationId" = ${organizationId} AND status = 'PENDING' LIMIT 1
    `;
    const request = rows[0];
    if (!request) return { success: false, error: 'Заявка не найдена или уже обработана' };

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
    await requireRole(canApprovePromotions, 'отклонение скидки менеджера');
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
