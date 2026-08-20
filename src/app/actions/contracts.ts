'use server';

import { db as prisma, Prisma } from '@/lib/db';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { logAction } from '@/lib/logger';
import { requireRole, canManageContracts, canApproveContracts, canCommentContracts, canViewAllContracts, UserRole } from '@/lib/roles';

// Инициализация таблиц документооборота
export async function initContractTables() {
  try {
    // 1. Создаем таблицу шаблонов
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "ContractTemplate" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "language" TEXT NOT NULL DEFAULT 'ru',
        "version" TEXT NOT NULL DEFAULT '1.0.0',
        "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
        "content" TEXT NOT NULL,
        "organizationId" TEXT NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 2. Создаем таблицу договоров
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Contract" (
        "id" TEXT PRIMARY KEY,
        "dealId" TEXT NOT NULL REFERENCES "Deal"("id") ON DELETE CASCADE,
        "templateId" TEXT NOT NULL REFERENCES "ContractTemplate"("id") ON DELETE CASCADE,
        "documentNumber" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'DRAFT',
        "signingDate" TIMESTAMP WITH TIME ZONE,
        "scanUrl" TEXT,
        "currencyFixation" TEXT NOT NULL DEFAULT 'USD',
        "organizationId" TEXT NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
    return { success: true };
  } catch (error: any) {
    console.error('Failed to init contract tables:', error);
    return { success: false, error: error.message };
  }
}

// Загрузка шаблонов и авто-сидинг демо шаблонов
export async function getTemplates(organizationId: string) {
  noStore();
  await initContractTables();
  try {
    let list: any[] = await prisma.$queryRaw`
      SELECT * FROM "ContractTemplate" 
      WHERE "organizationId" = ${organizationId}
      ORDER BY "createdAt" DESC
    `;

    // Если шаблонов нет, создаем базовые демонстрационные шаблоны
    if (list.length === 0) {
      const demoTemplates = [
        {
          id: crypto.randomUUID(),
          name: 'Договор бронирования (Booking Agreement) - RU',
          type: 'BOOKING',
          language: 'ru',
          version: '1.0.0',
          content: `<div style="font-family: Arial, sans-serif; padding: 30px; line-height: 1.6; max-width: 800px; margin: 0 auto; color: #1e293b;">
  <h2 style="text-align: center; text-transform: uppercase; color: #0f172a;">Договор бронирования № {{document.number}}</h2>
  <p style="text-align: right; font-weight: bold;">Дата: {{now.date}}</p>
  
  <p>Мы, нижеподписавшиеся, от лица Застройщика ЖК "<strong>{{building.name}}</strong>" (Компания: <strong>{{seller.companyName}}</strong>) с одной стороны, и Клиент <strong>{{client.fullName}}</strong> (Паспорт/ID: {{client.passport}}, Личный номер: {{client.personalNumber}}), с другой стороны, заключили настоящее соглашение о нижеследующем:</p>

  <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #334155;">1. Предмет соглашения</h3>
  <p>1.1. Застройщик обязуется временно изъять из открытой продажи и зарезервировать за Клиентом Объект недвижимости: квартира № <strong>{{unit.number}}</strong> на этаже <strong>{{unit.floor}}</strong>, общей проектной площадью <strong>{{unit.totalArea}} кв.м.</strong></p>
  <p>1.2. Базовая стоимость Объекта на момент подписания настоящего соглашения зафиксирована в размере <strong>{{deal.priceUsd}} USD</strong>.</p>

  <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #334155;">2. Условия резервирования и оплата</h3>
  <p>2.1. Настоящее бронирование устанавливается сроком на 14 (четырнадцать) календарных дней.</p>
  <p>2.2. В подтверждение серьезности намерений Клиент вносит гарантийный депозит в размере <strong>1,000 USD</strong>.</p>
  <p>2.3. В случае подписания основного предварительного или основного договора купли-продажи в течение срока действия брони, сумма гарантийного депозита в полном объеме засчитывается в счет оплаты первоначального взноса.</p>
  <p>2.4. Фиксация цены договора установлена в валюте: <strong>{{contract.currency}}</strong>.</p>

  <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #334155;">3. Реквизиты сторон</h3>
  <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
    <tr>
      <td style="width: 50%; vertical-align: top; padding-right: 10px;">
        <strong>ЗАСТРОЙЩИК:</strong><br/>
        {{seller.companyName}}<br/>
        Код: {{seller.tin}}<br/>
        Счет: {{seller.bankAccount}}
      </td>
      <td style="width: 50%; vertical-align: top;">
        <strong>ПОКУПАТЕЛЬ:</strong><br/>
        {{client.fullName}}<br/>
        Паспорт: {{client.passport}}<br/>
        Адрес: {{client.address}}
      </td>
    </tr>
  </table>
</div>`
        },
        {
          id: crypto.randomUUID(),
          name: 'Договор о намерениях (LOI) - RU',
          type: 'LOI',
          language: 'ru',
          version: '1.0.0',
          content: `<div style="font-family: Arial, sans-serif; padding: 30px; line-height: 1.6; max-width: 800px; margin: 0 auto; color: #1e293b;">
  <h2 style="text-align: center; text-transform: uppercase; color: #0f172a;">Соглашение о намерениях № {{document.number}}</h2>
  <p style="text-align: right; font-weight: bold;">Дата: {{now.date}}</p>
  
  <p>Настоящее Соглашение подтверждает взаимные намерения Застройщика и Покупателя заключить в будущем Договор купли-продажи строящегося объекта недвижимости.</p>
  
  <p><strong>Покупатель:</strong> {{client.fullName}}<br/>
  <strong>Объект:</strong> Помещение № {{unit.number}}, Этаж: {{unit.floor}}, в проекте "{{building.name}}"<br/>
  <strong>Ориентировочная площадь:</strong> {{unit.totalArea}} кв.м.<br/>
  <strong>Предварительно согласованная стоимость:</strong> {{deal.priceUsd}} USD</p>
  
  <p>Данный документ носит информационный характер и фиксирует параметры переговоров сторон перед составлением основного Договора купли-продажи.</p>
</div>`
        }
      ];

      for (const t of demoTemplates) {
        await prisma.$executeRaw`
          INSERT INTO "ContractTemplate" ("id", "name", "type", "language", "version", "status", "content", "organizationId")
          VALUES (${t.id}, ${t.name}, ${t.type}, ${t.language}, ${t.version}, 'PUBLISHED', ${t.content}, ${organizationId})
        `;
      }

      list = await prisma.$queryRaw`
        SELECT * FROM "ContractTemplate" 
        WHERE "organizationId" = ${organizationId}
        ORDER BY "createdAt" DESC
      `;
    }
    return list;
  } catch (error) {
    console.error('Failed to get templates:', error);
    return [];
  }
}

// Создание нового шаблона
export async function createTemplate(data: {
  name: string;
  type: string;
  language: string;
  version: string;
  content: string;
  organizationId: string;
}) {
  await initContractTables();
  try {
    await requireRole(canManageContracts, 'создание шаблона договора');
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "ContractTemplate" ("id", "name", "type", "language", "version", "status", "content", "organizationId")
      VALUES (${id}, ${data.name}, ${data.type}, ${data.language}, ${data.version}, 'PUBLISHED', ${data.content}, ${data.organizationId})
    `;
    logAction('Создание нового шаблона договора', { name: data.name, type: data.type, version: data.version });
    revalidatePath('/contracts');
    return { success: true };
  } catch (error: any) {
    console.error('Failed to create template:', error);
    return { success: false, error: error.message };
  }
}

// Загрузка списка договоров
export async function getContractsList(organizationId: string, userRole?: string, managerId?: string) {
  noStore();
  await initContractTables();
  try {
    const role = (userRole || 'manager') as UserRole;
    const viewAll = canViewAllContracts(role);

    const list: any[] = await prisma.$queryRaw`
      SELECT 
        c.*,
        t.name as "templateName",
        t.type as "templateType",
        l.name as "clientName",
        l.phone as "clientPhone",
        u.id as "unitId",
        u.number as "unitNumber",
        b.number as "blockNumber",
        p.name as "projectName",
        d."totalAmount" as "dealAmount",
        d."dealNumber" as "dealNumber",
        d."managerId" as "managerId"
      FROM "Contract" c
      JOIN "ContractTemplate" t ON c."templateId" = t.id
      JOIN "Deal" d ON c."dealId" = d.id
      JOIN "Lead" l ON d."leadId" = l.id
      JOIN "Unit" u ON d."unitId" = u.id
      LEFT JOIN "Block" b ON u."blockId" = b.id
      LEFT JOIN "Project" p ON b."projectId" = p.id
      WHERE c."organizationId" = ${organizationId}
        ${viewAll ? Prisma.empty : Prisma.sql`AND d."managerId" = ${managerId || ''}`}
      ORDER BY c."createdAt" DESC
    `;
    return list;
  } catch (error) {
    console.error('Failed to get contracts list:', error);
    return [];
  }
}

// Загрузка сделок для выбора в форме
export async function getDealsForContract(organizationId: string, userRole?: string, managerId?: string) {
  noStore();
  try {
    const role = (userRole || 'manager') as UserRole;
    const viewAll = canViewAllContracts(role);

    const deals: any[] = await prisma.$queryRaw`
      SELECT 
        d.id,
        d."totalAmount",
        l.name as "clientName",
        u.number as "unitNumber",
        p.name as "projectName"
      FROM "Deal" d
      JOIN "Lead" l ON d."leadId" = l.id
      JOIN "Unit" u ON d."unitId" = u.id
      LEFT JOIN "Block" b ON u."blockId" = b.id
      LEFT JOIN "Project" p ON b."projectId" = p.id
      WHERE d."organizationId" = ${organizationId} AND d.status != 'CANCELLED'
        ${viewAll ? Prisma.empty : Prisma.sql`AND d."managerId" = ${managerId || ''}`}
      ORDER BY d."createdAt" DESC
    `;
    return deals;
  } catch (error) {
    console.error('Failed to get deals for contracts:', error);
    return [];
  }
}

// Создание новой заявки на договор (Draft)
export async function createContractDraft(data: {
  dealId: string;
  templateId: string;
  currencyFixation: string;
  organizationId: string;
}) {
  await initContractTables();
  try {
    await requireRole(canManageContracts, 'создание договора');
    // Получаем тип шаблона для генерации номера
    const templates: any[] = await prisma.$queryRaw`
      SELECT type FROM "ContractTemplate" WHERE id = ${data.templateId} LIMIT 1
    `;
    const template = templates[0];
    if (!template) {
      return { success: false, error: 'Шаблон не найден' };
    }

    // Считаем количество договоров этого типа для нумерации
    const countRes: any[] = await prisma.$queryRaw`
      SELECT COUNT(*)::integer as count FROM "Contract" 
      WHERE "organizationId" = ${data.organizationId} AND "templateId" = ${data.templateId}
    `;
    const nextNum = (countRes[0]?.count || 0) + 1;
    const documentNumber = `PB-${template.type}-${String(nextNum).padStart(3, '0')}`;

    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "Contract" ("id", "dealId", "templateId", "documentNumber", "currencyFixation", "status", "organizationId", "createdAt", "updatedAt")
      VALUES (${id}, ${data.dealId}, ${data.templateId}, ${documentNumber}, ${data.currencyFixation}, 'DRAFT', ${data.organizationId}, NOW(), NOW())
    `;

    // Записываем лог аудита
    const auditId = crypto.randomUUID();
    const dealRowsForMgr: any[] = await prisma.$queryRaw`
      SELECT "managerId" FROM "Deal" WHERE id = ${data.dealId} LIMIT 1
    `;
    const managerId = dealRowsForMgr[0]?.managerId || 'system';

    await prisma.$executeRaw`
      INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "managerId", "fieldName", "newValue", "organizationId", "createdAt")
      VALUES (${auditId}, 'CREATE', 'Contract', ${id}, ${managerId}, 'STATUS', 'DRAFT', ${data.organizationId}, NOW())
    `;

    logAction('Создание новой заявки на договор (Черновик)', { dealId: data.dealId, templateId: data.templateId, currency: data.currencyFixation, documentNumber });
    revalidatePath('/contracts');
    return { success: true, contractId: id };
  } catch (error: any) {
    console.error('Failed to create contract draft:', error);
    return { success: false, error: error.message };
  }
}

// Изменение статуса договора (Согласование / Подписание)
export async function updateContractStatus(data: {
  contractId: string;
  status: string;
  scanUrl?: string;
  organizationId: string;
}) {
  try {
    // Утверждение/отклонение — только руководитель ОП или админ.
    // Остальные переходы (отправка на согласование, регистрация подписи и т.д.) — обычные canManageContracts.
    const isApprovalDecision = data.status === 'APPROVED' || data.status === 'REJECTED';
    await requireRole(isApprovalDecision ? canApproveContracts : canManageContracts, isApprovalDecision ? 'согласование договора (утверждение/отклонение)' : 'изменение статуса договора');
    logAction('Изменение статуса договора', { contractId: data.contractId, newStatus: data.status, hasScan: !!data.scanUrl });
    const prevStatusList: any[] = await prisma.$queryRaw`
      SELECT status FROM "Contract" WHERE id = ${data.contractId} LIMIT 1
    `;
    const prevStatus = prevStatusList[0]?.status || 'DRAFT';

    const signingDateSql = (data.status.startsWith('SIGNED')) ? 'NOW()' : 'NULL';

    if (data.status.startsWith('SIGNED')) {
      await prisma.$executeRaw`
        UPDATE "Contract" 
        SET "status" = ${data.status}, 
            "scanUrl" = ${data.scanUrl || null}, 
            "signingDate" = NOW(), 
            "updatedAt" = NOW()
        WHERE id = ${data.contractId}
      `;
    } else {
      await prisma.$executeRaw`
        UPDATE "Contract" 
        SET "status" = ${data.status}, 
            "updatedAt" = NOW()
        WHERE id = ${data.contractId}
      `;
    }

    // Пишем лог аудита
    const auditId = crypto.randomUUID();
    const dealRowsForMgr: any[] = await prisma.$queryRaw`
      SELECT d."managerId" 
      FROM "Contract" c 
      JOIN "Deal" d ON c."dealId" = d.id 
      WHERE c.id = ${data.contractId} 
      LIMIT 1
    `;
    const managerId = dealRowsForMgr[0]?.managerId || 'system';

    await prisma.$executeRaw`
      INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "managerId", "fieldName", "oldValue", "newValue", "organizationId", "createdAt")
      VALUES (${auditId}, 'UPDATE', 'Contract', ${data.contractId}, ${managerId}, 'STATUS', ${prevStatus}, ${data.status}, ${data.organizationId}, NOW())
    `;

    revalidatePath('/contracts');
    return { success: true };
  } catch (error: any) {
    console.error('Failed to update contract status:', error);
    return { success: false, error: error.message };
  }
}

// Генерация финального текста договора с заменой плейсхолдеров
export async function generateContractHtml(contractId: string) {
  noStore();
  try {
    const contracts: any[] = await prisma.$queryRaw`
      SELECT 
        c.*, 
        t.content as "templateContent",
        t.name as "templateName",
        d.id as "dealId",
        d."totalAmount" as "dealAmount",
        d.discount as "dealDiscount",
        l.name as "clientName",
        l."lastName" as "clientLastName",
        l."nameKa" as "clientNameKa",
        l."lastNameKa" as "clientLastNameKa",
        l.phone as "clientPhone",
        l.email as "clientEmail",
        l.iin as "clientIin",
        l."legalAddress" as "clientLegalAddress",
        l."legalAddressKa" as "clientLegalAddressKa",
        l."actualAddress" as "clientActualAddress",
        l."actualAddressKa" as "clientActualAddressKa",
        u.number as "unitNumber",
        u.floor as "unitFloor",
        u.area as "unitArea",
        u.price as "unitPrice",
        b.number as "blockNumber",
        p.name as "projectName"
      FROM "Contract" c
      JOIN "ContractTemplate" t ON c."templateId" = t.id
      JOIN "Deal" d ON c."dealId" = d.id
      JOIN "Lead" l ON d."leadId" = l.id
      JOIN "Unit" u ON d."unitId" = u.id
      LEFT JOIN "Block" b ON u."blockId" = b.id
      LEFT JOIN "Project" p ON b."projectId" = p.id
      WHERE c.id = ${contractId}
      LIMIT 1
    `;

    const contract = contracts[0];
    if (!contract) return 'Договор не найден';

    let html = contract.templateContent;

    // Базовые значения для подстановок
    const docNum = contract.documentNumber || '';
    const docDate = new Date(contract.createdAt).toLocaleDateString('ru-RU');
    const projName = contract.projectName || 'ЖК Park Boulevard';
    const blkNum = contract.blockNumber || '';
    const entNum = '1';
    
    const clientName = contract.clientName || 'Не указано';
    const clientLastName = contract.clientLastName || '';
    const clientFullName = `${clientName} ${clientLastName}`.trim();
    
    const clientNameKa = contract.clientNameKa || 'Не указано';
    const clientLastNameKa = contract.clientLastNameKa || '';
    const clientFullNameKa = `${clientNameKa} ${clientLastNameKa}`.trim();

    const clientPhone = contract.clientPhone || 'Не указано';
    const clientEmail = contract.clientEmail || 'Не указано';
    const clientIin = contract.clientIin || 'Не указано';
    
    const legalAddr = contract.clientLegalAddress || 'Не указано';
    const legalAddrKa = contract.clientLegalAddressKa || 'Не указано';
    const actualAddr = contract.clientActualAddress || 'Не указано';
    const actualAddrKa = contract.clientActualAddressKa || 'Не указано';

    const unitNum = contract.unitNumber || '';
    const unitFloor = String(contract.unitFloor || 1);
    const unitArea = String(contract.unitArea || 0);

    const dealPrice = new Intl.NumberFormat('en-US').format(contract.dealAmount || contract.unitPrice);
    const dealDiscount = String(contract.dealDiscount || 0);

    // Списки замен в разных форматах: {{placeholder}}, <placeholder> и &lt;placeholder&gt;
    const replacements: Record<string, string> = {
      // 1. Стандартные фигурные скобки {{...}}
      '{{document.number}}': docNum,
      '{{now.date}}': docDate,
      '{{building.name}}': projName,
      '{{building.blockNumber}}': blkNum,
      '{{unit.entrance}}': entNum,
      '{{seller.companyName}}': 'Park Boulevard Developers LLC',
      '{{seller.tin}}': '204998761',
      '{{seller.bankAccount}}': 'GE89TB77366209488390',
      '{{client.name}}': clientName,
      '{{client.lastName}}': clientLastName,
      '{{client.fullName}}': clientFullName,
      '{{client.nameKa}}': clientNameKa,
      '{{client.lastNameKa}}': clientLastNameKa,
      '{{client.fullNameKa}}': clientFullNameKa,
      '{{client.phone}}': clientPhone,
      '{{client.email}}': clientEmail,
      '{{client.passport}}': clientIin,
      '{{client.personalNumber}}': clientIin,
      '{{client.legalAddress}}': legalAddr,
      '{{client.legalAddressKa}}': legalAddrKa,
      '{{client.actualAddress}}': actualAddr,
      '{{client.actualAddressKa}}': actualAddrKa,
      '{{unit.number}}': unitNum,
      '{{unit.floor}}': unitFloor,
      '{{unit.totalArea}}': unitArea,
      '{{deal.priceUsd}}': dealPrice,
      '{{deal.discount}}': dealDiscount,
      '{{contract.currency}}': contract.currencyFixation || 'USD',
      '{{booking.deposit}}': '1,000',

      // 2. Теги из Word документа в формате <Параметр> и &lt;Параметр&gt;
      'Номер': docNum,
      'Дата': docDate,
      'Покупатель_ИмяГ': clientNameKa,
      'Покупатель_ФамилияГ': clientLastNameKa,
      'Покупатель_ЛичныйНомер': clientIin,
      'Покупатель_ЮридическийАдресГ': legalAddrKa,
      'Покупатель_ФизическйиАдресГ': actualAddrKa,
      'Покупатель_Email': clientEmail,
      'Покупатель_Телефон': clientPhone,
      'ОбъектСтроительства_КорпусНаГр': blkNum,
      'Подъезд_ПодъездНаГр': entNum,
      'Помещение_ПроектнаяПлощадь': unitArea,
      'Помещение_Этаж': unitFloor,
      'Помещение_СтроительныйНомер': unitNum,
      'СкидкаНаценка': dealDiscount,
      'СуммаДоговора': dealPrice,
      'Покупатель_Имя': clientName,
      'Покупатель_Фамилия_НаименованиеПолное': clientLastName || clientFullName,
      'Покупатель_ЮридическийАдрес': legalAddr,
      'Покупатель_Адрес': actualAddr,
      'ГрафикБезДопПлатежей': 'Согласно графику платежей'
    };

    // Применяем все замены
    for (const [key, value] of Object.entries(replacements)) {
      if (key.startsWith('{{')) {
        html = html.replaceAll(key, value);
      } else {
        // Заменяем и <Параметр>, и &lt;Параметр&gt;
        html = html.replaceAll(`<${key}>`, value);
        html = html.replaceAll(`&lt;${key}&gt;`, value);
      }
    }

    return html;
  } catch (error) {
    console.error('Failed to generate contract HTML:', error);
    return 'Ошибка генерации документа';
  }
}

export async function getContractHistory(contractId: string) {
  try {
    const list: any[] = await prisma.$queryRaw`
      SELECT 
        a.id,
        a.action,
        a."createdAt" as "createdAt",
        a."oldValue" as "oldValue",
        a."newValue" as "newValue",
        a."reason" as "reason",
        COALESCE(m.name, 'Система') as "managerName"
      FROM "AuditLog" a
      LEFT JOIN "Manager" m ON a."managerId" = m.id
      WHERE a."entityId" = ${contractId} AND a."entityType" = 'Contract'
      ORDER BY a."createdAt" DESC
    `;
    return { success: true, history: list };
  } catch (error: any) {
    console.error('Failed to get contract history:', error);
    return { success: false, error: error.message };
  }
}

// Добавить комментарий/уточнение к договору (для юриста и других ролей)
export async function addContractComment(data: {
  contractId: string;
  comment: string;
  authorRole: string;
  managerId: string;
  organizationId: string;
}) {
  try {
    await requireRole(canCommentContracts, 'комментирование договора');
    const { contractId, comment, authorRole, managerId, organizationId } = data;
    const logId = crypto.randomUUID();

    await prisma.$executeRaw`
      INSERT INTO "AuditLog" (
        "id", "action", "entityType", "entityId",
        "fieldName", "newValue", "reason", "managerId",
        "organizationId", "createdAt"
      ) VALUES (
        ${logId},
        'CONTRACT_COMMENT',
        'Contract',
        ${contractId},
        'comment',
        ${comment},
        ${`Роль: ${authorRole}`},
        ${managerId || 'system'},
        ${organizationId},
        NOW()
      )
    `;

    // Если комментарий от юриста — переводим договор в статус CLARIFICATION
    if (authorRole === 'lawyer') {
      await prisma.$executeRaw`
        UPDATE "Contract"
        SET status = 'CLARIFICATION', "updatedAt" = NOW()
        WHERE id = ${contractId}
      `;
    }

    return { success: true };
  } catch (error: any) {
    console.error('addContractComment error:', error);
    return { success: false, error: error.message };
  }
}