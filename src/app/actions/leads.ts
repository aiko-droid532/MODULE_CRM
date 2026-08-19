'use server';

import { db as prisma, Prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { logAction } from '@/lib/logger';
import { requireRole, canManageDeals, canManageUnits, canApplyDiscountPercent, canApprovePromotions } from '@/lib/roles';
import { generateDealNumber } from './deals';

export async function createClient(formData: {
  name: string;
  phone: string;
  email?: string;
  source?: string;
  iin?: string;
  managerNotes?: string;
  organizationId: string;
  createdById?: string;
  type?: string;
  personalNumber?: string;
  passportNumber?: string;
  passportCountry?: string;
  consentToPdProcessing?: boolean;
  optInMarketing?: boolean;
  codeWord?: string;
  isVip?: boolean;
}) {
  try {
    await requireRole(canManageDeals, 'создание клиента');
    const existingByPhone: any[] = await prisma.$queryRaw`
      SELECT id, name FROM "Lead" 
      WHERE "phone" = ${formData.phone} 
      AND "organizationId" = ${formData.organizationId} 
      LIMIT 1
    `;

    if (existingByPhone.length > 0) {
      return {
        success: false,
        error: 'DUPLICATE',
        message: `Клиент с таким номером уже существует: ${existingByPhone[0].name}`,
        existingClientId: existingByPhone[0].id
      };
    }

    if (formData.iin) {
      const existingByIIN: any[] = await prisma.$queryRaw`
        SELECT id, name FROM "Lead" 
        WHERE "iin" = ${formData.iin} 
        AND "organizationId" = ${formData.organizationId} 
        LIMIT 1
      `;

      if (existingByIIN.length > 0) {
        return {
          success: false,
          error: 'DUPLICATE',
          message: `Клиент с таким ИИН уже существует: ${existingByIIN[0].name}`,
          existingClientId: existingByIIN[0].id
        };
      }
    }

    if (formData.personalNumber) {
      const existingByPN: any[] = await prisma.$queryRaw`
        SELECT id, name FROM "Lead" 
        WHERE "personalNumber" = ${formData.personalNumber} 
        AND "organizationId" = ${formData.organizationId} 
        LIMIT 1
      `;

      if (existingByPN.length > 0) {
        return {
          success: false,
          error: 'DUPLICATE',
          message: `Клиент с таким Personal Number уже существует: ${existingByPN[0].name}`,
          existingClientId: existingByPN[0].id
        };
      }
    }

    const clientTypeEnum = formData.type || 'LEAD';

    const clientId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "Lead" (
        "id", "name", "phone", "email", "iin", "managerNotes", "source", 
        "organizationId", "createdById", "status", "callAttempts", "managerId",
        "type", "personalNumber", "passportNumber", "passportCountry",
        "consentToPdProcessing", "optInMarketing", "consentToPd",
        "codeWord", "isVip", "updatedAt"
      ) VALUES (
        ${clientId}, ${formData.name}, ${formData.phone}, ${formData.email || null}, 
        ${formData.iin || null}, ${formData.managerNotes || null}, ${formData.source || null}, 
        ${formData.organizationId}, ${formData.createdById || null}, 'NEW', 0, null,
        ${clientTypeEnum}, ${formData.personalNumber || null}, 
        ${formData.passportNumber || null}, ${formData.passportCountry || null},
        ${formData.consentToPdProcessing || false}, ${formData.optInMarketing || false},
        ${formData.consentToPdProcessing || false},
        ${formData.codeWord || null}, ${formData.isVip || false},
        NOW()
      )
    `;

    logAction('Создание нового клиента/лида', { name: formData.name, phone: formData.phone, source: formData.source });
    revalidatePath('/clients');
    return { success: true, client: { id: clientId } };
  } catch (error) {
    console.error('Failed to create client via SQL:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

export async function anonymizeClient(leadId: string, managerId: string, reason: string) {
  try {
    await requireRole(canManageDeals, 'анонимизация клиента');
    logAction('Анонимизация клиента', { leadId, managerId, reason });
    const currentList: any[] = await prisma.$queryRaw`
      SELECT name, phone, email, iin, personalNumber, passportNumber, passportCountry, codeWord 
      FROM "Lead" WHERE id = ${leadId} LIMIT 1
    `;
    const current = currentList[0];
    if (!current) return { success: false, error: 'Клиент не найден' };

    const anonymizedData = {
      name: 'XXX',
      phone: 'XXX',
      email: null,
      iin: null,
      personalNumber: null,
      passportNumber: null,
      passportCountry: null,
      codeWord: null,
    };

    await prisma.$executeRaw`
      UPDATE "Lead" 
      SET 
        "name" = ${anonymizedData.name},
        "phone" = ${anonymizedData.phone},
        "email" = ${anonymizedData.email},
        "iin" = ${anonymizedData.iin},
        "personalNumber" = ${anonymizedData.personalNumber},
        "passportNumber" = ${anonymizedData.passportNumber},
        "passportCountry" = ${anonymizedData.passportCountry},
        "codeWord" = ${anonymizedData.codeWord},
        "updatedAt" = NOW()
      WHERE id = ${leadId}
    `;

    await prisma.$executeRaw`
      INSERT INTO "ChangeLog" ("id", "leadId", "managerId", "field", "oldValue", "newValue", "createdAt")
      VALUES (
        ${crypto.randomUUID()}, 
        ${leadId}, 
        ${managerId}, 
        'ANONYMIZATION', 
        ${JSON.stringify(current)}, 
        ${`Анонимизация по причине: ${reason}`}, 
        NOW()
      )
    `;

    revalidatePath('/clients');
    return { success: true };
  } catch (error) {
    console.error('Anonymize client error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

export async function logPhoneView(leadId: string, managerId: string, reason: string) {
  try {
    await prisma.$executeRaw`
      INSERT INTO "ChangeLog" ("id", "leadId", "managerId", "field", "oldValue", "newValue", "createdAt")
      VALUES (
        ${crypto.randomUUID()}, 
        ${leadId}, 
        ${managerId}, 
        'PHONE_VIEW', 
        null, 
        ${`Просмотр телефона по причине: ${reason}`}, 
        NOW()
      )
    `;
    return { success: true };
  } catch (error) {
    console.error('Log phone view error:', error);
    return { success: false };
  }
}

export async function getLeads(organizationId: string) {
  try {
    // Запускаем фоновую проверку устаревших промо-акций (reconcileExpiredPromoDeals)
    // асинхронно, не дожидаясь ее завершения, чтобы не блокировать загрузку страницы.
    import('./promotions').then(({ reconcileExpiredPromoDeals }) => {
      reconcileExpiredPromoDeals(organizationId).catch(e => {
        console.error('Background reconcileExpiredPromoDeals error:', e);
      });
    });

    const leads: any[] = await prisma.$queryRaw`
      SELECT l.*, p.name as "interestedProjectName"
      FROM "Lead" l
      LEFT JOIN "Project" p ON l."interestedProjectId" = p.id
      WHERE l."organizationId" = ${organizationId}
      ORDER BY l."createdAt" DESC
    `;

    if (leads.length === 0) return [];

    const leadIds = leads.map((l: any) => l.id);

    // Выгружаем интересы и сделки параллельно (без ChangeLog, который теперь
    // подгружается динамически через getLeadById только при открытии досье).
    const [allInterests, deals] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          li.*,
          u.number as "unitNumber",
          u.price as "unitPrice",
          u.area as "unitArea",
          u.rooms as "unitRooms",
          p.name as "projectName"
        FROM "LeadInterest" li
        JOIN "Unit" u ON li."unitId" = u.id
        JOIN "Block" b ON u."blockId" = b.id
        JOIN "Project" p ON b."projectId" = p.id
        WHERE li."leadId" IN (${Prisma.join(leadIds)})
      ` as Promise<any[]>,
      prisma.$queryRaw`
        SELECT DISTINCT
          d.id,
          d."leadId",
          d."unitId",
          d.status,
          d."createdAt",
          d."updatedAt",
          COALESCE(dc."leadId", d."leadId") as "involvedLeadId",
          u.number as "unitNumber",
          u.price as "unitPrice",
          u.area as "unitArea",
          u.rooms as "unitRooms",
          p.name as "projectName"
        FROM "Deal" d
        JOIN "Unit" u ON d."unitId" = u.id
        JOIN "Block" b ON u."blockId" = b.id
        JOIN "Project" p ON b."projectId" = p.id
        LEFT JOIN "DealClient" dc ON d.id = dc."dealId"
        WHERE d."leadId" IN (${Prisma.join(leadIds)}) OR dc."leadId" IN (${Prisma.join(leadIds)})
      ` as Promise<any[]>,
    ]);

    let dealUnits: any[] = [];
    if (deals.length > 0) {
      const dealIds = Array.from(new Set(deals.map(d => d.id)));
      dealUnits = await prisma.$queryRaw`
        SELECT du.id, du."dealId", du."unitId", u.number as "unitNumber", u.price as "unitPrice", u.area as "unitArea", u.rooms as "unitRooms", p.name as "projectName"
        FROM "DealUnit" du
        JOIN "Unit" u ON du."unitId" = u.id
        JOIN "Block" b ON u."blockId" = b.id
        JOIN "Project" p ON b."projectId" = p.id
        WHERE du."dealId" IN (${Prisma.join(dealIds)}) AND du."isDeleted" = false
      `;
    }

    // Оптимизируем сборку связей (маппинг) в памяти сервера с квадратичного перебора O(N^2)
    // до линейного O(N + M + D + U) через хэш-таблицы (Map).
    const interestsByLeadId = new Map<string, any[]>();
    for (const interest of allInterests) {
      const list = interestsByLeadId.get(interest.leadId) || [];
      list.push(interest);
      interestsByLeadId.set(interest.leadId, list);
    }

    const dealsByLeadId = new Map<string, any[]>();
    for (const deal of deals) {
      const ids = new Set<string>();
      if (deal.leadId) ids.add(deal.leadId);
      if (deal.involvedLeadId) ids.add(deal.involvedLeadId);

      for (const lid of ids) {
        const list = dealsByLeadId.get(lid) || [];
        list.push(deal);
        dealsByLeadId.set(lid, list);
      }
    }

    const dealUnitsByDealId = new Map<string, any[]>();
    for (const du of dealUnits) {
      const list = dealUnitsByDealId.get(du.dealId) || [];
      list.push(du);
      dealUnitsByDealId.set(du.dealId, list);
    }

    return leads.map(lead => {
      const leadInterestsRaw = interestsByLeadId.get(lead.id) || [];
      const interests = leadInterestsRaw.map(ri => ({
        ...ri,
        unit: {
          id: ri.unitId,
          number: ri.unitNumber,
          price: ri.unitPrice,
          area: ri.unitArea,
          rooms: ri.unitRooms,
          block: {
            project: {
              name: ri.projectName
            }
          }
        }
      }));

      const leadDeals = dealsByLeadId.get(lead.id) || [];

      for (const d of leadDeals) {
        // Первичное помещение сделки
        const primaryInInterests = interests.some(i => i.unitId === d.unitId);
        if (primaryInInterests) {
          interests.forEach(i => {
            if (i.unitId === d.unitId) {
              i.status = 'DEAL';
            }
          });
        } else {
          interests.push({
            id: `deal-interest-primary-${d.id}`,
            leadId: lead.id,
            unitId: d.unitId,
            status: 'DEAL',
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            unit: {
              id: d.unitId,
              number: d.unitNumber,
              price: d.unitPrice,
              area: d.unitArea,
              rooms: d.unitRooms,
              block: {
                project: {
                  name: d.projectName
                }
              }
            }
          });
        }

        // Дополнительные помещения в этой сделке (DealUnit)
        const addUnits = dealUnitsByDealId.get(d.id) || [];
        for (const du of addUnits) {
          const extraInInterests = interests.some(i => i.unitId === du.unitId);
          if (extraInInterests) {
            interests.forEach(i => {
              if (i.unitId === du.unitId) {
                i.status = 'DEAL';
              }
            });
          } else {
            interests.push({
              id: `deal-interest-extra-${du.id}`,
              leadId: lead.id,
              unitId: du.unitId,
              status: 'DEAL',
              createdAt: d.createdAt,
              updatedAt: d.updatedAt,
              unit: {
                id: du.unitId,
                number: du.unitNumber,
                price: du.unitPrice,
                area: du.unitArea,
                rooms: du.unitRooms,
                block: {
                  project: {
                    name: du.projectName
                  }
                }
              }
            });
          }
        }
      }

      return {
        ...lead,
        interests: interests || [],
        deals: [],
        logs: [] // Логи изменений пустые при начальной загрузке, они тянутся при открытии досье
      };
    });

  } catch (error) {
    console.error('Fast fetch clients error:', error);
    return [];
  }
}

export async function getLeadsBoard(organizationId: string) {
  try {
    const leads: any[] = await prisma.$queryRaw`
      SELECT * FROM "Lead" 
      WHERE "organizationId" = ${organizationId} 
      ORDER BY "createdAt" DESC
    `;
    return leads;
  } catch (error) {
    console.error('getLeadsBoard error:', error);
    return [];
  }
}

// "Взять лида в работу" — теперь со скоупом по отделу (BR-B08, Ролевая модель
// фаза 3): менеджер может забрать только лид своего отдела, самозахват чужого
// пула запрещён. Реализация — в actions/leadDistribution.ts (claimPoolLead),
// здесь просто сохранена прежняя сигнатура ради существующих вызовов.
export async function assignLeadToManager(leadId: string, managerId: string, organizationId?: string) {
  const { claimPoolLead } = await import('./leadDistribution');
  return claimPoolLead(leadId, managerId, organizationId || '');
}

export async function logCallAttempt(leadId: string) {
  try {
    await requireRole(canManageDeals, 'фиксация звонка по лиду');
    const leads: any[] = await prisma.$queryRaw`SELECT "callAttempts", "managerId" FROM "Lead" WHERE id = ${leadId}`;
    if (!leads.length) return { success: false };

    let attempts = (leads[0].callAttempts || 0) + 1;

    if (attempts >= 3) {
      await prisma.$executeRaw`
        UPDATE "Lead" SET "callAttempts" = ${attempts}, "status" = 'LOST', "updatedAt" = NOW() WHERE id = ${leadId}
      `;
    } else {
      await prisma.$executeRaw`
        UPDATE "Lead" SET "callAttempts" = ${attempts}, "updatedAt" = NOW() WHERE id = ${leadId}
      `;
    }

    // Синхронизация со сделкой: это те же самые 3 звонка менеджера ОП, что и
    // счётчик "Звонок (X/3)" у лида — просто отражаем их в статусе сделки
    // (1-й/2-й/3-й звонок), а не в статусах колл-центра.
    let dealStatusToSet = '';
    if (attempts === 1) {
      dealStatusToSet = 'PRE_RESERVATION'; // "1-й звонок"
    } else if (attempts === 2) {
      dealStatusToSet = 'RESERVATION'; // "2-й звонок"
    } else if (attempts >= 3) {
      dealStatusToSet = 'CONTRACT_PREPARATION'; // "3-й звонок"
    }

    if (dealStatusToSet) {
      await syncDealStatusForLead(leadId, dealStatusToSet, leads[0].managerId);
    }

    revalidatePath('/clients');
    revalidatePath('/deals');
    return { success: true, attempts };
  } catch (error) {
    console.error('logCallAttempt error:', error);
    return { success: false };
  }
}

export async function updateLeadStatus(leadId: string, newStatus: string) {
  try {
    await requireRole(canManageDeals, 'изменение статуса лида');
    await prisma.$executeRaw`
      UPDATE "Lead" SET "status" = ${newStatus}::"LeadStatus", "updatedAt" = NOW() WHERE id = ${leadId}
    `;
    revalidatePath('/clients');
    return { success: true };
  } catch (error) {
    console.error('updateLeadStatus error:', error);
    return { success: false };
  }
}

export async function createDeal(data: {
  leadId: string;
  unitId: string;
  organizationId: string;
  managerId?: string;
  interestId: string;
}) {
  try {
    await requireRole(canManageDeals, 'создание сделки');
    const leads: any[] = await prisma.$queryRaw`
      SELECT "phone", "source" FROM "Lead" WHERE "id" = ${data.leadId} LIMIT 1
    `;
    const lead = leads[0];

    if (!lead || !lead.phone || !lead.source) {
      return {
        success: false,
        error: 'VALIDATION_FAILED',
        message: 'У клиента должен быть указан телефон и источник для создания сделки!'
      };
    }

    const dealId = crypto.randomUUID();

    // Сделка сразу попадает в "Распределён" (CONSULTATION) — так и должно быть при
    // конвертации лида в сделку. Статус квартиры НЕ трогаем — она остаётся свободной,
    // пока менеджер сам не поставит ручную бронь через шахматку (см. booking.ts).
    // Раньше здесь же квартиру молча запирали в RESERVATION_PAID без записи в Booking —
    // из-за этого бронь потом было невозможно снять через интерфейс.
    const dealNumber = await generateDealNumber(data.organizationId);
    await prisma.$executeRaw`
      INSERT INTO "Deal" ("id", "leadId", "unitId", "status", "organizationId", "managerId", "dealNumber", "createdAt", "updatedAt")
      VALUES (${dealId}, ${data.leadId}, ${data.unitId}, 'CONSULTATION', ${data.organizationId}, ${data.managerId}, ${dealNumber}, NOW(), NOW())
    `;

    await prisma.$executeRaw`
      UPDATE "LeadInterest" SET "status" = 'DEAL' WHERE "id" = ${data.interestId}
    `;

    await prisma.$executeRaw`
      INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "managerId", "fieldName", "oldValue", "newValue", "organizationId", "createdAt")
      VALUES (${crypto.randomUUID()}, 'CREATE', 'Deal', ${dealId}, ${data.managerId || 'system'}, 'status', 'NEW_LEAD', 'CONSULTATION', ${data.organizationId}, NOW())
    `;

    revalidatePath('/clients');
    revalidatePath('/deals');
    return { success: true, deal: { id: dealId } };
  } catch (error) {
    console.error('Create deal SQL error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

export async function updateClient(data: {
  id: string;
  name?: string;
  phone?: string;
  iin?: string;
  managerNotes?: string;
  managerId: string;
  isVip?: boolean;
}) {
  try {
    await requireRole(canManageDeals, 'редактирование клиента');
    const currentList: any[] = await prisma.$queryRaw`
      SELECT * FROM "Lead" WHERE id = ${data.id} LIMIT 1
    `;
    const current = currentList[0];
    if (!current) return { success: false };

    const updates: any[] = [];
    const logs = [];

    if (data.name && data.name !== current.name) {
      updates.push(Prisma.sql`"name" = ${data.name}`);
      logs.push({ field: 'name', old: current.name, new: data.name });
    }
    if (data.phone && data.phone !== current.phone) {
      updates.push(Prisma.sql`"phone" = ${data.phone}`);
      logs.push({ field: 'phone', old: current.phone, new: data.phone });
    }
    if (data.iin !== undefined && data.iin !== current.iin) {
      updates.push(Prisma.sql`"iin" = ${data.iin}`);
      logs.push({ field: 'iin', old: current.iin || '', new: data.iin });
    }
    if (data.managerNotes !== undefined && data.managerNotes !== current.managerNotes) {
      updates.push(Prisma.sql`"managerNotes" = ${data.managerNotes}`);
    }
    if (data.isVip !== undefined && data.isVip !== current.isVip) {
      updates.push(Prisma.sql`"isVip" = ${data.isVip}`);
      logs.push({ field: 'isVip', old: current.isVip ? 'VIP' : 'Обычный', new: data.isVip ? 'VIP' : 'Обычный' });
    }

    if (updates.length === 0) return { success: true };

    await prisma.$executeRaw`
      UPDATE "Lead" 
      SET ${Prisma.join(updates, ', ')}, "updatedAt" = NOW()
      WHERE id = ${data.id}
    `;

    for (const log of logs) {
      await prisma.$executeRaw`
        INSERT INTO "ChangeLog" ("id", "leadId", "managerId", "field", "oldValue", "newValue", "createdAt")
        VALUES (${crypto.randomUUID()}, ${data.id}, ${data.managerId}, ${log.field}, ${log.old}, ${log.new}, NOW())
      `;
    }

    revalidatePath('/clients');
    return { success: true };
  } catch (error) {
    console.error('Update client SQL error:', error);
    return { success: false };
  }
}

export async function getLeadById(id: string) {
  try {
    const leads: any[] = await prisma.$queryRaw`
      SELECT l.*, p.name as "interestedProjectName"
      FROM "Lead" l
      LEFT JOIN "Project" p ON l."interestedProjectId" = p.id
      WHERE l."id" = ${id} LIMIT 1
    `;
    if (leads.length === 0) return null;

    const lead = leads[0];

    const interests: any[] = await prisma.$queryRaw`
      SELECT i.*, u.number, u.price, p.name as "projectName"
      FROM "LeadInterest" i
      JOIN "Unit" u ON i."unitId" = u.id
      JOIN "Block" b ON u."blockId" = b.id
      JOIN "Project" p ON b."projectId" = p.id
      WHERE i."leadId" = ${id}
    `;

    // Get all deals where the client is primary or participant
    const deals: any[] = await prisma.$queryRaw`
      SELECT DISTINCT
        d.id,
        d."leadId",
        d."unitId",
        d.status,
        d."paymentType",
        d."downPayment",
        d."totalAmount",
        d."mortgageBank",
        d."mortgageStatus",
        d."mortgageComment",
        d."managerId",
        d."organizationId",
        d."createdAt",
        d."updatedAt",
        u.number as "unitNumber",
        u.price as "unitPrice",
        p.name as "projectName"
      FROM "Deal" d
      JOIN "Unit" u ON d."unitId" = u.id
      JOIN "Block" b ON u."blockId" = b.id
      JOIN "Project" p ON b."projectId" = p.id
      LEFT JOIN "DealClient" dc ON d.id = dc."dealId"
      WHERE d."leadId" = ${id} OR dc."leadId" = ${id}
    `;

    let dealUnits: any[] = [];
    if (deals.length > 0) {
      const dealIds = deals.map(d => d.id);
      dealUnits = await prisma.$queryRaw`
        SELECT du.id, du."dealId", du."unitId", u.number as "unitNumber", u.price as "unitPrice", p.name as "projectName"
        FROM "DealUnit" du
        JOIN "Unit" u ON du."unitId" = u.id
        JOIN "Block" b ON u."blockId" = b.id
        JOIN "Project" p ON b."projectId" = p.id
        WHERE du."dealId" IN (${Prisma.join(dealIds)}) AND du."isDeleted" = false
      `;
    }

    const finalInterests = [...interests];

    // For each deal
    for (const d of deals) {
      // Primary unit
      const primaryInInterests = finalInterests.some(i => i.unitId === d.unitId);
      if (primaryInInterests) {
        finalInterests.forEach(i => {
          if (i.unitId === d.unitId) {
            i.status = 'DEAL';
          }
        });
      } else {
        finalInterests.push({
          id: `deal-interest-primary-${d.id}`,
          leadId: id,
          unitId: d.unitId,
          status: 'DEAL',
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          number: d.unitNumber,
          price: d.unitPrice,
          projectName: d.projectName
        });
      }

      // Additional units
      const addUnits = dealUnits.filter(du => du.dealId === d.id);
      for (const du of addUnits) {
        const extraInInterests = finalInterests.some(i => i.unitId === du.unitId);
        if (extraInInterests) {
          finalInterests.forEach(i => {
            if (i.unitId === du.unitId) {
              i.status = 'DEAL';
            }
          });
        } else {
          finalInterests.push({
            id: `deal-interest-extra-${du.id}`,
            leadId: id,
            unitId: du.unitId,
            status: 'DEAL',
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            number: du.unitNumber,
            price: du.unitPrice,
            projectName: du.projectName
          });
        }
      }
    }

    // Expose all deal entries (for primary and extra units)
    const allDealEntries: any[] = [];
    for (const d of deals) {
      allDealEntries.push({
        ...d,
        isAdditional: false
      });
      const addUnits = dealUnits.filter(du => du.dealId === d.id);
      for (const du of addUnits) {
        allDealEntries.push({
          ...d,
          unitId: du.unitId,
          unitNumber: du.unitNumber,
          unitPrice: du.unitPrice,
          projectName: du.projectName,
          isAdditional: true
        });
      }
    }

    const dealsWithPayments = [];
    for (const de of allDealEntries) {
      const payments: any[] = await prisma.$queryRaw`
        SELECT * FROM "PaymentSchedule" WHERE "dealId" = ${de.id} ORDER BY "dueDate" ASC
      `;
      dealsWithPayments.push({
        ...de,
        payments
      });
    }

    const logs: any[] = await prisma.$queryRaw`
      SELECT * FROM "ChangeLog" WHERE "leadId" = ${id} ORDER BY "createdAt" DESC
    `;

    return {
      ...lead,
      interests: finalInterests.map(i => ({
        ...i,
        unit: {
          id: i.unitId,
          number: i.number,
          price: i.price,
          block: {
            project: {
              name: i.projectName
            }
          }
        }
      })),
      deals: dealsWithPayments,
      logs
    };
  } catch (error) {
    console.error('getLeadById SQL error:', error);
    return null;
  }
}

export async function savePaymentScheduleAction(data: {
  leadId: string;
  unitId: string;
  paymentType: string;
  downPayment: number;
  totalAmount: number;
  basePriceUSD?: number;
  catalogPriceUSD?: number;
  exchangeRate: number;
  schedule: Array<{ date: string; amountUSD: number; amountGEL: number }>;
  organizationId: string;
  initiatorId?: string;
}) {
  try {
    const role = await requireRole(canManageDeals, 'сохранение графика платежей');

    // Индивидуальная (+ накопительная, уже включённая в totalAmount) скидка
    const basePrice = data.basePriceUSD ?? data.totalAmount;
    const discountPercent = basePrice > 0
      ? Math.round(((basePrice - data.totalAmount) / basePrice) * 1000) / 10
      : 0;
    // Эффект самой акции — разница между каталожной ценой (до акции) и basePrice (после акции)
    const promoDiscountPercent = data.catalogPriceUSD && data.catalogPriceUSD > 0
      ? Math.round(((data.catalogPriceUSD - basePrice) / data.catalogPriceUSD) * 1000) / 10
      : 0;
    // Порог согласования — по СУММАРНОМУ эффекту: акция + индивидуальная + накопительная
    // (раздел 6 ТЗ "Акции и специальные предложения")
    const combinedDiscountPercent = Math.round((promoDiscountPercent + discountPercent) * 10) / 10;

    let dealId = '';

    const deals: any[] = await prisma.$queryRaw`
      SELECT id FROM "Deal" WHERE "leadId" = ${data.leadId} AND "unitId" = ${data.unitId} LIMIT 1
    `;

    if (deals.length > 0) {
      dealId = deals[0].id;
    } else {
      dealId = crypto.randomUUID();
      const dealNumber = await generateDealNumber(data.organizationId);
      await prisma.$executeRaw`
        INSERT INTO "Deal" ("id", "leadId", "unitId", "status", "organizationId", "dealNumber", "createdAt", "updatedAt")
        VALUES (${dealId}, ${data.leadId}, ${data.unitId}, 'NEW_LEAD', ${data.organizationId}, ${dealNumber}, NOW(), NOW())
      `;
      await prisma.$executeRaw`
        UPDATE "LeadInterest" SET "status" = 'DEAL' WHERE "leadId" = ${data.leadId} AND "unitId" = ${data.unitId}
      `;
    }

    // Цена зафиксирована (сделка уже дошла до статуса "Договор") — менять её может только РОП/админ
    const lockedRows: any[] = await prisma.$queryRaw`
      SELECT "priceLocked" FROM "Deal" WHERE id = ${dealId} LIMIT 1
    `;
    if (lockedRows[0]?.priceLocked && !canApprovePromotions(role)) {
      return {
        success: false,
        error: 'Цена по этой сделке зафиксирована после заключения договора. Изменить может только руководитель ОП.',
      };
    }

    // Акция, реально действующая сейчас на объекте сделки — привязываем к сделке для лимитов
    // применения (Общий/на клиента/на объект) и аналитики (см. promotions.ts)
    const { getLivePromotionForUnit, checkPromotionLimits } = await import('./promotions');
    const livePromo = await getLivePromotionForUnit(data.unitId);
    const promotionId = livePromo?.promotionId || null;

    if (promotionId) {
      const limitCheck = await checkPromotionLimits(promotionId, data.unitId, data.leadId, dealId);
      if (!limitCheck.ok) {
        return { success: false, error: limitCheck.reason };
      }
    }

    // Пороги — настройка коммерческой политики организации (BR-B05), а не
    // хардкод в коде (Ролевая модель, фаза 4).
    const { getDiscountThresholds } = await import('./discountPolicy');
    const thresholds = await getDiscountThresholds(data.organizationId);

    // Уходит заявкой на согласование РОП/админу (а не отклоняется отказом), если:
    // а) роль manager и есть хоть какая-то ручная скидка (даже в пределах её порога — по договорённости
    //    любая ручная скидка менеджера требует подтверждения), ИЛИ
    // б) суммарный эффект (акция + индивидуальная + накопительная) выше СОБСТВЕННОГО порога роли —
    //    иначе применение уже одобренной при создании крупной акции без всякой доп.скидки было бы
    //    вообще несохраняемым для всех ролей кроме admin.
    const needsApproval = (role === 'manager' && discountPercent > 0)
      || (combinedDiscountPercent > 0 && !canApplyDiscountPercent(role, combinedDiscountPercent, thresholds));

    if (needsApproval) {
      const { submitDiscountApprovalRequest } = await import('./discountApprovals');
      const reqRes = await submitDiscountApprovalRequest({
        dealId,
        sourcePath: 'LEAD_DOSSIER',
        proposedPayload: data,
        proposedDiscountPercent: combinedDiscountPercent,
        submittedById: data.initiatorId || '',
        organizationId: data.organizationId,
        thresholdAtSubmission: thresholds[role] ?? 0,
      });
      if (!reqRes.success) {
        return { success: false, error: 'Не удалось отправить скидку на согласование' };
      }
      return { success: true, pendingApproval: true };
    }

    await prisma.$executeRaw`
      UPDATE "Deal"
      SET "paymentType" = ${data.paymentType}, "downPayment" = ${data.downPayment}, "totalAmount" = ${data.totalAmount},
        "basePriceUSD" = ${basePrice},
        "catalogPriceUSD" = ${data.catalogPriceUSD ?? null},
        "promotionId" = ${promotionId},
        "discountPercent" = ${discountPercent},
        "discountApprovedById" = ${discountPercent > 0 ? (data.initiatorId || null) : null},
        "discountApprovedByRole" = ${discountPercent > 0 ? role : null},
        "updatedAt" = NOW()
      WHERE id = ${dealId}
    `;

    await prisma.$executeRaw`
      DELETE FROM "PaymentSchedule" WHERE "dealId" = ${dealId}
    `;

    for (const p of data.schedule) {
      const scheduleId = crypto.randomUUID();
      let dueDate = new Date();
      const parts = p.date.split('.');
      if (parts.length === 3) {
        dueDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      } else {
        dueDate = new Date(p.date);
      }

      await prisma.$executeRaw`
        INSERT INTO "PaymentSchedule" ("id", "dealId", "amount", "dueDate", "status", "organizationId", "createdAt", "updatedAt")
        VALUES (${scheduleId}, ${dealId}, ${p.amountUSD}, ${dueDate}, 'PENDING', ${data.organizationId}, NOW(), NOW())
      `;
    }

    revalidatePath('/clients');
    return { success: true };
  } catch (error) {
    console.error('savePaymentScheduleAction SQL error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// Подтверждение платежа по графику
export async function recordPaymentAction(data: {
  paymentScheduleId: string;
  organizationId: string;
}) {
  try {
    await requireRole(canManageDeals, 'подтверждение платежа');
    // 1. Находим платеж по графику
    const schedules: any[] = await prisma.$queryRaw`
      SELECT * FROM "PaymentSchedule" 
      WHERE id = ${data.paymentScheduleId} AND "organizationId" = ${data.organizationId} 
      LIMIT 1
    `;

    if (schedules.length === 0) {
      return { success: false, error: 'NOT_FOUND', message: 'Платеж по графику не найден.' };
    }

    const schedule = schedules[0];
    if (schedule.status === 'PAID') {
      return { success: false, error: 'ALREADY_PAID', message: 'Этот платеж уже подтвержден.' };
    }

    // 2. Меняем статус платежа на PAID
    await prisma.$executeRaw`
      UPDATE "PaymentSchedule" 
      SET status = 'PAID'::"PaymentStatus", "updatedAt" = NOW() 
      WHERE id = ${data.paymentScheduleId}
    `;

    // 3. Создаем запись транзакции в Transaction
    const transactionId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "Transaction" ("id", "amount", "date", "paymentScheduleId", "organizationId", "createdAt")
      VALUES (${transactionId}, ${schedule.amount}, NOW(), ${data.paymentScheduleId}, ${data.organizationId}, NOW())
    `;

    // 4. Продвигаем сделку и квартиру по воронке при поступлении оплаты
    const allSchedules: any[] = await prisma.$queryRaw`
      SELECT id, status FROM "PaymentSchedule" WHERE "dealId" = ${schedule.dealId}
    `;
    const unpaidSchedules = allSchedules.filter((p: any) => p.status !== 'PAID');
    const paidSchedules = allSchedules.filter((p: any) => p.status === 'PAID');

    const deals: any[] = await prisma.$queryRaw`
      SELECT id, status, "unitId" FROM "Deal" WHERE id = ${schedule.dealId} LIMIT 1
    `;
    if (deals.length > 0) {
      const deal = deals[0];
      if (unpaidSchedules.length === 0) {
        // Последний платеж (все оплачено) -> Успех и Продано
        await prisma.$executeRaw`
          UPDATE "Deal" 
          SET status = 'SUCCESS'::"DealStatus", "updatedAt" = NOW() 
          WHERE id = ${deal.id}
        `;
        if (deal.unitId) {
          await prisma.$executeRaw`
            UPDATE "Unit" 
            SET status = 'SOLD'::"UnitStatus", "updatedAt" = NOW() 
            WHERE id = ${deal.unitId}
          `;
        }
      } else if (paidSchedules.length >= 1) {
        // Любой оплаченный взнос -> переводим сделку в SUCCESS (Won), а квартиру в SOLD
        await prisma.$executeRaw`
          UPDATE "Deal" 
          SET status = 'SUCCESS'::"DealStatus", "updatedAt" = NOW() 
          WHERE id = ${deal.id}
        `;
        if (deal.unitId) {
          await prisma.$executeRaw`
            UPDATE "Unit" 
            SET status = 'SOLD'::"UnitStatus", "updatedAt" = NOW() 
            WHERE id = ${deal.unitId}
          `;
        }
      }
    }

    revalidatePath('/clients');
    revalidatePath('/deals');
    revalidatePath('/shakhmatka');
    revalidatePath('/');

    return { success: true };
  } catch (error) {
    console.error('recordPaymentAction error:', error);
    return { success: false, error: 'SERVER_ERROR', message: 'Ошибка сервера при регистрации оплаты.' };
  }
}

export async function getActiveManagers(organizationId: string) {
  try {
    const managers: any[] = await prisma.$queryRaw`
      SELECT id, name, status, "currentLoad", "lastActiveAt"
      FROM "Manager"
      WHERE "organizationId" = ${organizationId} AND status = 'ACTIVE'
      ORDER BY "currentLoad" ASC
    `;
    return managers;
  } catch (error) {
    console.error('getActiveManagers error:', error);
    return [];
  }
}

// Раньше эта функция только меняла статус лида на IN_QUALIFICATION, не назначая
// ответственного (ровно проблема из ТЗ: "автораспределение существует, но
// ответственного не назначает"). Теперь реально маршрутизирует лид по отделу
// и правилу распределения (см. actions/leadDistribution.ts).
export async function assignLeadAutomatically(leadId: string, organizationId: string) {
  try {
    await requireRole(canManageDeals, 'автораспределение лида');
    const { distributeLead } = await import('./leadDistribution');
    const res = await distributeLead(leadId, organizationId);
    if (!res.success) return { success: false, error: 'SERVER_ERROR' };

    // Если движок реально назначил ответственного — переводим в квалификацию,
    // как и раньше. Если лид остался в пуле отдела (некого назначить / ручное
    // правило) — статус NEW оставляем как есть, это и есть пул.
    if (res.managerId) {
      await prisma.$executeRaw`
        UPDATE "Lead" SET "status" = 'IN_QUALIFICATION', "updatedAt" = NOW() WHERE id = ${leadId}
      `;
    }
    return { success: true };
  } catch (error) {
    console.error('assignLeadAutomatically error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// ========== ОБНОВЛЕННАЯ ФУНКЦИЯ КВАЛИФИКАЦИИ (С НОВЫМИ ПОЛЯМИ) ==========
export async function qualifyLead(leadId: string, data: {
  interestedProjectId?: string;
  propertyType?: string;
  budgetMin?: number;
  budgetMax?: number;
  paymentMethod?: string;
  sourceInfo?: string;
  // НОВЫЕ ПОЛЯ
  roomsInterested?: number | string | null;
  areaMin?: number | string | null;
  areaMax?: number | string | null;
  deliveryDeadline?: string | null;
}) {
  try {
    await requireRole(canManageDeals, 'квалификация лида');
    await prisma.$executeRaw`
      UPDATE "Lead" 
      SET 
        "interestedProjectId" = ${data.interestedProjectId || null},
        "propertyType" = ${data.propertyType || null},
        "budgetMin" = ${data.budgetMin || null},
        "budgetMax" = ${data.budgetMax || null},
        "paymentMethod" = ${data.paymentMethod || null},
        "sourceInfo" = ${data.sourceInfo || null},
        "roomsInterested" = ${data.roomsInterested === '' || data.roomsInterested === undefined || data.roomsInterested === null ? null : data.roomsInterested},
        "areaMin" = ${data.areaMin === '' || data.areaMin === undefined || data.areaMin === null ? null : data.areaMin},
        "areaMax" = ${data.areaMax === '' || data.areaMax === undefined || data.areaMax === null ? null : data.areaMax},
        "deliveryDeadline" = ${data.deliveryDeadline || null},
        "status" = 'QUALIFIED',
        "updatedAt" = NOW()
      WHERE id = ${leadId}
    `;

    // Если ЖК интереса только что стал известен и лид ещё никому не назначен —
    // маршрутизируем его в отдел, ведущий этот ЖК (BR-B08). Уже взятые в
    // работу лиды не трогаем — менеджера, который начал общение с клиентом,
    // мы не выдёргиваем из-под него сменой ЖК при квалификации.
    if (data.interestedProjectId) {
      try {
        const leadRow: any[] = await prisma.$queryRaw`SELECT "organizationId", "managerId" FROM "Lead" WHERE id = ${leadId}`;
        if (leadRow[0] && !leadRow[0].managerId) {
          const { distributeLead } = await import('./leadDistribution');
          await distributeLead(leadId, leadRow[0].organizationId);
        }
      } catch (_) {}
    }

    revalidatePath('/clients');
    return { success: true };
  } catch (error) {
    console.error('qualifyLead error:', error);
    return { success: false };
  }
}

// Подбор объектов (досье лида/клиента) — фиксирует параметры поиска в журнале изменений
// И одновременно обновляет поля анкеты лида через COALESCE (не затирая уже заполненные).
const PROPERTY_TYPE_LABELS_RU: Record<string, string> = {
  Apartment: 'Квартира',
  Commercial: 'Коммерция',
  Parking: 'Паркиги',
  Storage: 'Кладовка',
};

function formatSearchCriteriaSummary(data: { rooms?: string | number; minArea?: string | number; maxPrice?: string | number; type?: string }): string {
  const parts: string[] = [];
  if (data.type) parts.push(PROPERTY_TYPE_LABELS_RU[data.type] || data.type);
  if (data.rooms) parts.push(`${data.rooms}-комн.`);
  if (data.minArea) parts.push(`от ${data.minArea} м²`);
  if (data.maxPrice) parts.push(`до $${Number(data.maxPrice).toLocaleString()}`);
  return parts.length > 0 ? parts.join(', ') : 'без параметров';
}

export async function saveSearchCriteria(
  leadId: string,
  data: { rooms?: string | number; minArea?: string | number; maxPrice?: string | number; type?: string },
  stage: 'search' | 'select' = 'search',
  managerId?: string
) {
  try {
    const rooms = data.rooms === '' || data.rooms == null ? null : Number(data.rooms);
    const minArea = data.minArea === '' || data.minArea == null ? null : Number(data.minArea);
    const maxPrice = data.maxPrice === '' || data.maxPrice == null ? null : Number(data.maxPrice);

    // Обновляем поля анкеты лида через COALESCE (не затирая уже заполненные значения)
    await prisma.$executeRaw`
      UPDATE "Lead"
      SET
        "roomsInterested" = COALESCE(${rooms}, "roomsInterested"),
        "areaMin" = COALESCE(${minArea}, "areaMin"),
        "budgetMax" = COALESCE(${maxPrice}, "budgetMax"),
        "propertyType" = COALESCE(${data.type || null}, "propertyType"),
        "updatedAt" = NOW()
      WHERE id = ${leadId}
    `;

    // Логируем в журнал изменений с человекочитаемым описанием
    const fieldLabel = stage === 'select' ? 'Подбор объектов — выбран вариант' : 'Подбор объектов — поиск';
    await prisma.$executeRaw`
      INSERT INTO "ChangeLog" ("id", "leadId", "managerId", "field", "oldValue", "newValue", "createdAt")
      VALUES (${crypto.randomUUID()}, ${leadId}, ${managerId || 'system'}, ${fieldLabel}, null, ${formatSearchCriteriaSummary(data)}, NOW())
    `;

    revalidatePath('/clients');
    return { success: true };
  } catch (error) {
    console.error('saveSearchCriteria error:', error);
    return { success: false };
  }
}


// Эскалация просроченных лидов теперь в actions/leadDistribution.ts —
// настраиваемый SLA + уведомления руководителям отдела (Ролевая модель, фаза 3),
// вместо жёстко зашитых 15 минут и одного console.log без реального действия.

export async function getLeadsKanban(organizationId: string) {
  try {
    const leads: any[] = await prisma.$queryRaw`
      SELECT 
        l.*,
        NULL as "managerName",
        p.name as "interestedProjectName"
      FROM "Lead" l
      LEFT JOIN "Project" p ON l."interestedProjectId" = p.id
      WHERE l."organizationId" = ${organizationId}
      ORDER BY 
        CASE l.status
          WHEN 'NEW' THEN 1
          WHEN 'IN_QUALIFICATION' THEN 2
          WHEN 'QUALIFIED' THEN 3
          WHEN 'IN_PROGRESS' THEN 4
          WHEN 'CONVERTED' THEN 5
          WHEN 'LOST' THEN 6
          ELSE 7
        END,
        l."createdAt" ASC
    `;
    
    console.log(` getLeadsKanban: найдено ${leads.length} лидов для orgId=${organizationId}`);
    return leads;
  } catch (error) {
    console.error('getLeadsKanban error:', error);
    return [];
  }
}

export async function reassignLead(leadId: string, newManagerId: string, reason: string) {
  try {
    // Переназначение лида другому менеджеру — действие руководителя (admin/rop/senior_manager)
    await requireRole(canManageUnits, 'переназначение лида');
    const oldLead: any[] = await prisma.$queryRaw`
      SELECT "managerId" FROM "Lead" WHERE id = ${leadId}
    `;
    
    if (oldLead[0]?.managerId) {
      await prisma.$executeRaw`
        UPDATE "Manager" SET "currentLoad" = "currentLoad" - 1 WHERE id = ${oldLead[0].managerId}
      `;
    }
    
    await prisma.$executeRaw`
      UPDATE "Manager" SET "currentLoad" = "currentLoad" + 1 WHERE id = ${newManagerId}
    `;
    
    await prisma.$executeRaw`
      UPDATE "Lead" 
      SET "managerId" = ${newManagerId}, 
          "reassignedAt" = NOW(),
          "reassignReason" = ${reason},
          "updatedAt" = NOW()
      WHERE id = ${leadId}
    `;
    
    revalidatePath('/clients');
    return { success: true };
  } catch (error) {
    console.error('reassignLead error:', error);
    return { success: false };
  }
}

export async function getLeadInterests(leadId: string) {
  try {
    const interests: any[] = await prisma.$queryRaw`
      SELECT li.id, li."unitId", u.number as "unitNumber", u.price as "unitPrice", p.name as "projectName"
      FROM "LeadInterest" li
      JOIN "Unit" u ON li."unitId" = u.id
      JOIN "Block" b ON u."blockId" = b.id
      JOIN "Project" p ON b."projectId" = p.id
      WHERE li."leadId" = ${leadId} AND li.status::text = 'ACTIVE'
    `;
    return interests;
  } catch (error) {
    console.error('getLeadInterests error:', error);
    return [];
  }
}

// ========== ГРАФИК ПРИЕМА ЛИДОВ ==========

export type TimeSlot = {
  id: string;
  leadId: string;
  managerId: string | null;
  date: string;
  time: string;
  status: 'AVAILABLE' | 'BOOKED' | 'COMPLETED' | 'CANCELLED';
  leadName: string;
  leadPhone: string;
  createdAt: string;
};

export async function getManagerSchedule(managerId: string, startDate: string) {
  try {
    const slots: any[] = await prisma.$queryRaw`
      SELECT * FROM "LeadSchedule"
      WHERE "managerId" = ${managerId}
        AND "date" >= ${startDate}
        AND "date" < ${startDate}::date + interval '7 days'
      ORDER BY "date", "time"
    `;
    return slots;
  } catch (error) {
    console.error('getManagerSchedule error:', error);
    return [];
  }
}

// Полный список приёмов менеджера (все даты, а не только текущая неделя) — для просмотра
// списком, чтобы не листать календарь неделя за неделей ради старых записей
export async function getManagerScheduleList(managerId: string) {
  try {
    const slots: any[] = await prisma.$queryRaw`
      SELECT * FROM "LeadSchedule"
      WHERE "managerId" = ${managerId}
      ORDER BY "date" DESC, "time" DESC
    `;
    return slots;
  } catch (error) {
    console.error('getManagerScheduleList error:', error);
    return [];
  }
}

// Записать лида на прием (забронировать слот)
export async function bookScheduleSlot(data: {
  leadId: string;
  managerId: string;
  date: string;
  time: string;
}) {
  try {
    await requireRole(canManageDeals, 'запись на прием');
    // Проверяем, не занят ли уже этот слот у этого менеджера
    const existing: any[] = await prisma.$queryRaw`
      SELECT id FROM "LeadSchedule"
      WHERE "managerId" = ${data.managerId}
        AND "date" = ${data.date}::date
        AND "time" = ${data.time}
      LIMIT 1
    `;

    if (existing.length > 0) {
      return { success: false, error: 'SLOT_TAKEN', message: 'Это время уже занято другим лидом' };
    }

    // Получаем данные лида
    const lead: any[] = await prisma.$queryRaw`
      SELECT name, phone FROM "Lead" WHERE id = ${data.leadId} LIMIT 1
    `;

    if (lead.length === 0) {
      return { success: false, error: 'LEAD_NOT_FOUND', message: 'Лид не найден' };
    }

    // Создаем запись
    const slotId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "LeadSchedule" ("id", "leadId", "managerId", "date", "time", "status", "leadName", "leadPhone", "createdAt", "updatedAt")
      VALUES (${slotId}, ${data.leadId}, ${data.managerId}, ${data.date}::date, ${data.time}, 'BOOKED', ${lead[0].name}, ${lead[0].phone}, NOW(), NOW())
    `;

    // Синхронизация со сделкой: запись на приём — сделка сразу переходит в "Встреча назначена"
    await syncDealStatusForLead(data.leadId, 'MEETING', data.managerId);

    revalidatePath('/clients');
    revalidatePath('/deals');
    return { success: true, slotId };
  } catch (error) {
    console.error('bookScheduleSlot error:', error);
    return { success: false, error: 'SERVER_ERROR', message: 'Ошибка сервера при записи' };
  }
}

export async function cancelScheduleSlot(slotId: string, reason: string) {
  try {
    await requireRole(canManageDeals, 'отмена приема');
    const slots: any[] = await prisma.$queryRaw`
      SELECT "leadId", "managerId" FROM "LeadSchedule" WHERE "id" = ${slotId} LIMIT 1
    `;
    await prisma.$executeRaw`
      UPDATE "LeadSchedule"
      SET "status" = 'CANCELLED', "updatedAt" = NOW()
      WHERE "id" = ${slotId}
    `;
    // Встреча не проведена — сделка возвращается в "Распределён"
    if (slots[0]?.leadId) {
      await syncDealStatusForLead(slots[0].leadId, 'CONSULTATION', slots[0].managerId, reason);
    }
    revalidatePath('/clients');
    revalidatePath('/deals');
    return { success: true };
  } catch (error) {
    console.error('cancelScheduleSlot error:', error);
    return { success: false };
  }
}

export async function completeScheduleSlot(slotId: string) {
  try {
    await requireRole(canManageDeals, 'подтверждение приема');
    const slots: any[] = await prisma.$queryRaw`
      SELECT "leadId", "managerId" FROM "LeadSchedule" WHERE "id" = ${slotId} LIMIT 1
    `;
    await prisma.$executeRaw`
      UPDATE "LeadSchedule"
      SET "status" = 'COMPLETED', "updatedAt" = NOW()
      WHERE "id" = ${slotId}
    `;
    // Встреча проведена успешно — сделка переходит в "Встреча проведена"
    if (slots[0]?.leadId) {
      await syncDealStatusForLead(slots[0].leadId, 'CLIENT_CONFIRMATION', slots[0].managerId);
    }
    revalidatePath('/clients');
    revalidatePath('/deals');
    return { success: true };
  } catch (error) {
    console.error('completeScheduleSlot error:', error);
    return { success: false };
  }
}

// Синхронизация статуса сделки лида по событиям записи на приём (запись / отмена / проведена).
// Не трогает уже закрытые сделки (Won/Lost/Cancelled).
async function syncDealStatusForLead(leadId: string, newStatus: string, managerId?: string, reason?: string) {
  const deals: any[] = await prisma.$queryRaw`
    SELECT "id", "status", "organizationId" FROM "Deal"
    WHERE "leadId" = ${leadId} AND "status" NOT IN ('SUCCESS', 'FAILED', 'CANCELLED')
    LIMIT 1
  `;
  const deal = deals[0];
  if (!deal || deal.status === newStatus) return;

  await prisma.$executeRaw`
    UPDATE "Deal"
    SET "status" = ${newStatus}::"DealStatus", "updatedAt" = NOW()
    WHERE "id" = ${deal.id}
  `;
  await prisma.$executeRaw`
    INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "managerId", "fieldName", "oldValue", "newValue", "reason", "organizationId", "createdAt")
    VALUES (${crypto.randomUUID()}, 'UPDATE', 'Deal', ${deal.id}, ${managerId || 'system'}, 'status', ${deal.status}, ${newStatus}, ${reason || null}, ${deal.organizationId}, NOW())
  `;
}

export async function getLeadSchedule(leadId: string) {
  try {
    const slots: any[] = await prisma.$queryRaw`
      SELECT * FROM "LeadSchedule"
      WHERE "leadId" = ${leadId}
      ORDER BY "date" DESC, "time" DESC
    `;
    return slots;
  } catch (error) {
    console.error('getLeadSchedule error:', error);
    return [];
  }
}