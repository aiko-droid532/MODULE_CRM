'use server';

import { db as prisma, Prisma } from '@/lib/db';
import * as XLSX from 'xlsx';
import { revalidatePath } from 'next/cache';
import { canManageFinance } from '@/lib/roles';
import { requireRole } from '@/lib/serverAuth';

// Получить импортированные банковские транзакции
export async function getBankTransactions(organizationId: string) {
  try {
    const txs: any[] = await prisma.$queryRaw`
      SELECT 
        bt.id,
        bt.bank,
        bt."payerName",
        bt."payerIin",
        bt.amount,
        bt.purpose,
        bt.date,
        bt.status,
        bt."paymentScheduleId",
        ps."dealId",
        l.name as "leadName",
        u.number as "unitNumber"
      FROM "BankTransaction" bt
      LEFT JOIN "PaymentSchedule" ps ON bt."paymentScheduleId" = ps.id
      LEFT JOIN "Deal" d ON ps."dealId" = d.id
      LEFT JOIN "Lead" l ON d."leadId" = l.id
      LEFT JOIN "Unit" u ON d."unitId" = u.id
      WHERE bt."organizationId" = ${organizationId}
      ORDER BY bt.date DESC
    `;
    return txs;
  } catch (e) {
    console.error('getBankTransactions error:', e);
    return [];
  }
}

// Получить неоплаченные графики для ручного сопоставления
export async function getPendingSchedules(organizationId: string) {
  try {
    const schedules: any[] = await prisma.$queryRaw`
      SELECT 
        ps.id,
        ps."dealId",
        ps.amount,
        ps."dueDate",
        ps.status,
        l.name as "leadName",
        l.iin as "leadIin",
        l."passportNumber" as "leadPassport",
        u.number as "unitNumber",
        d.status as "dealStatus"
      FROM "PaymentSchedule" ps
      JOIN "Deal" d ON ps."dealId" = d.id
      JOIN "Lead" l ON d."leadId" = l.id
      JOIN "Unit" u ON d."unitId" = u.id
      WHERE ps."organizationId" = ${organizationId} 
        AND ps.status IN ('PENDING', 'OVERDUE')
        AND d.status NOT IN ('SUCCESS', 'FAILED', 'CANCELLED')
      ORDER BY ps."dueDate" ASC
    `;
    return schedules;
  } catch (e) {
    console.error('getPendingSchedules error:', e);
    return [];
  }
}

// Помощник проведения сопоставления
async function executeLink(txId: string, scheduleId: string, amount: number, organizationId: string) {
  // 1. Помечаем платеж по графику как PAID
  await prisma.$executeRaw`
    UPDATE "PaymentSchedule" 
    SET status = 'PAID'::"PaymentStatus", "updatedAt" = NOW() 
    WHERE id = ${scheduleId}
  `;

  // 2. Устанавливаем ссылку в BankTransaction
  await prisma.$executeRaw`
    UPDATE "BankTransaction" 
    SET status = 'MATCHED', "paymentScheduleId" = ${scheduleId}, "updatedAt" = NOW() 
    WHERE id = ${txId}
  `;

  // 3. Создаем запись транзакции в Transaction
  const transactionId = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "Transaction" ("id", "amount", "date", "paymentScheduleId", "organizationId", "createdAt")
    VALUES (${transactionId}, ${amount}, NOW(), ${scheduleId}, ${organizationId}, NOW())
  `;

  // 4. Продвигаем сделку и квартиру по воронке при поступлении оплаты
  const schedules: any[] = await prisma.$queryRaw`
    SELECT "dealId" FROM "PaymentSchedule" WHERE id = ${scheduleId} LIMIT 1
  `;
  if (schedules.length > 0) {
    const dealId = schedules[0].dealId;
    const allSchedules: any[] = await prisma.$queryRaw`
      SELECT id, status FROM "PaymentSchedule" WHERE "dealId" = ${dealId}
    `;
    const unpaidSchedules = allSchedules.filter((p: any) => p.status !== 'PAID');
    const paidSchedules = allSchedules.filter((p: any) => p.status === 'PAID');

    const deals: any[] = await prisma.$queryRaw`
      SELECT id, "unitId", status FROM "Deal" WHERE id = ${dealId} LIMIT 1
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
  }
}

// Алгоритм автосопоставления платежа
async function autoMatchTransaction(tx: {
  id: string;
  amount: number;
  payerName?: string;
  payerIin?: string;
  purpose?: string;
  organizationId: string;
}) {
  // 1. Получаем все неоплаченные графики
  const pendingSchedules = await getPendingSchedules(tx.organizationId);
  if (pendingSchedules.length === 0) return false;

  let matchedSchedule: any = null;

  // Правило 1: Сопоставление по ИИН / Номеру паспорта
  if (tx.payerIin) {
    const matched = pendingSchedules.filter(
      (ps: any) => ps.leadIin === tx.payerIin || ps.leadPassport === tx.payerIin
    );
    if (matched.length > 0) {
      // Ищем точное соответствие по сумме
      const amtMatch = matched.find((ps: any) => Math.abs(ps.amount - tx.amount) < 0.01);
      if (amtMatch) {
        matchedSchedule = amtMatch;
      } else {
        // Если сумма не совпала в точности, берем старейший неоплаченный платеж этого клиента
        matchedSchedule = matched[0];
      }
    }
  }

  // Правило 2: Сопоставление по ФИО (поиск вхождения имени в плательщика или наоборот)
  if (!matchedSchedule && tx.payerName) {
    const nameLower = tx.payerName.toLowerCase();
    const matched = pendingSchedules.filter((ps: any) => {
      const leadNameLower = ps.leadName.toLowerCase();
      return nameLower.includes(leadNameLower) || leadNameLower.includes(nameLower);
    });
    if (matched.length > 0) {
      const amtMatch = matched.find((ps: any) => Math.abs(ps.amount - tx.amount) < 0.01);
      if (amtMatch) {
        matchedSchedule = amtMatch;
      } else {
        matchedSchedule = matched[0];
      }
    }
  }

  // Правило 3: Сопоставление по номеру квартиры в назначении платежа
  if (!matchedSchedule && tx.purpose) {
    const purposeLower = tx.purpose.toLowerCase();
    const matched = pendingSchedules.filter((ps: any) => {
      const unitNum = ps.unitNumber;
      if (!unitNum) return false;
      const cleanNum = unitNum.replace(/\D/g, ''); // только цифры (например 204)
      const patterns = [
        `кв ${unitNum}`,
        `кв. ${unitNum}`,
        `кв.${unitNum}`,
        `квартира ${unitNum}`,
        `№ ${unitNum}`,
        `№${unitNum}`,
        `unit ${unitNum}`,
        `кв ${cleanNum}`,
        `кв. ${cleanNum}`,
        `квартира ${cleanNum}`,
        `№ ${cleanNum}`
      ];
      return patterns.some(p => purposeLower.includes(p.toLowerCase())) || purposeLower.includes(unitNum.toLowerCase());
    });

    if (matched.length > 0) {
      const amtMatch = matched.find((ps: any) => Math.abs(ps.amount - tx.amount) < 0.01);
      if (amtMatch) {
        matchedSchedule = amtMatch;
      } else if (matched.length === 1) {
        matchedSchedule = matched[0];
      }
    }
  }

  // Правило 4: Сопоставление по сумме, если в системе ровно один неоплаченный платеж на такую сумму
  if (!matchedSchedule) {
    const matched = pendingSchedules.filter((ps: any) => Math.abs(ps.amount - tx.amount) < 0.01);
    if (matched.length === 1) {
      matchedSchedule = matched[0];
    }
  }

  // Если нашли совпадение, проводим платеж
  if (matchedSchedule) {
    await executeLink(tx.id, matchedSchedule.id, tx.amount, tx.organizationId);
    return true;
  }

  return false;
}

// 1. Ручное сопоставление платежа
export async function manuallyMatchTransactionAction(data: {
  bankTxId: string;
  scheduleId: string;
  organizationId: string;
}) {
  try {
    await requireRole(canManageFinance, 'сопоставление банковской транзакции');
    const txs: any[] = await prisma.$queryRaw`
      SELECT * FROM "BankTransaction" 
      WHERE id = ${data.bankTxId} AND "organizationId" = ${data.organizationId} 
      LIMIT 1
    `;
    const schedules: any[] = await prisma.$queryRaw`
      SELECT * FROM "PaymentSchedule" 
      WHERE id = ${data.scheduleId} AND "organizationId" = ${data.organizationId} 
      LIMIT 1
    `;

    if (txs.length === 0 || schedules.length === 0) {
      return { success: false, error: 'NOT_FOUND', message: 'Транзакция или график платежа не найдены.' };
    }

    const tx = txs[0];
    const schedule = schedules[0];

    if (tx.status === 'MATCHED') {
      return { success: false, error: 'ALREADY_MATCHED', message: 'Эта транзакция уже сопоставлена.' };
    }
    if (schedule.status === 'PAID') {
      return { success: false, error: 'SCHEDULE_PAID', message: 'Этот платеж по графику уже оплачен.' };
    }

    await executeLink(tx.id, schedule.id, tx.amount, data.organizationId);

    revalidatePath('/finance');
    revalidatePath('/deals');
    revalidatePath('/clients');
    revalidatePath('/');

    return { success: true };
  } catch (e) {
    console.error('manuallyMatchTransactionAction error:', e);
    return { success: false, error: 'SERVER_ERROR', message: 'Ошибка сервера при ручном сопоставлении.' };
  }
}

// 2. Отмена сопоставления платежа
export async function unmatchTransactionAction(data: {
  bankTxId: string;
  organizationId: string;
}) {
  try {
    await requireRole(canManageFinance, 'отмена сопоставления транзакции');
    const txs: any[] = await prisma.$queryRaw`
      SELECT * FROM "BankTransaction" 
      WHERE id = ${data.bankTxId} AND "organizationId" = ${data.organizationId} 
      LIMIT 1
    `;
    if (txs.length === 0) {
      return { success: false, error: 'NOT_FOUND', message: 'Транзакция не найдена.' };
    }

    const tx = txs[0];
    if (tx.status === 'UNMATCHED' || !tx.paymentScheduleId) {
      return { success: false, error: 'NOT_MATCHED', message: 'Эта транзакция не сопоставлена.' };
    }

    const scheduleId = tx.paymentScheduleId;

    // 1. Удаляем привязанную транзакцию из Transaction
    await prisma.$executeRaw`
      DELETE FROM "Transaction" WHERE "paymentScheduleId" = ${scheduleId}
    `;

    // 2. Меняем статус графика обратно на PENDING
    await prisma.$executeRaw`
      UPDATE "PaymentSchedule" 
      SET status = 'PENDING'::"PaymentStatus", "updatedAt" = NOW() 
      WHERE id = ${scheduleId}
    `;

    // 3. Отвязываем транзакцию в BankTransaction
    await prisma.$executeRaw`
      UPDATE "BankTransaction" 
      SET status = 'UNMATCHED', "paymentScheduleId" = NULL, "updatedAt" = NOW() 
      WHERE id = ${tx.id}
    `;

    // 4. Пересчитываем статус сделки
    const schedules: any[] = await prisma.$queryRaw`
      SELECT "dealId" FROM "PaymentSchedule" WHERE id = ${scheduleId} LIMIT 1
    `;
    if (schedules.length > 0) {
      const dealId = schedules[0].dealId;
      const allSchedules: any[] = await prisma.$queryRaw`
        SELECT id, status FROM "PaymentSchedule" WHERE "dealId" = ${dealId}
      `;
      const paidSchedules = allSchedules.filter((p: any) => p.status === 'PAID');
      const deals: any[] = await prisma.$queryRaw`
        SELECT id, "unitId", status FROM "Deal" WHERE id = ${dealId} LIMIT 1
      `;
      if (deals.length > 0) {
        const deal = deals[0];
        let newDealStatus = 'NEW_LEAD';
        let newUnitStatus = 'SOFT_BOOKED';

        if (paidSchedules.length === 0) {
          // Нет оплаченных -> сделка возвращается в «Ожидание оплаты», квартира в «Договор подписан»
          newDealStatus = 'WAITING_PAYMENT';
          newUnitStatus = 'CONTRACT_SIGNED';
        } else {
          // Есть оплаченные -> статус SUCCESS (Won), квартира SOLD
          newDealStatus = 'SUCCESS';
          newUnitStatus = 'SOLD';
        }

        await prisma.$executeRaw`
          UPDATE "Deal" 
          SET status = ${newDealStatus}::"DealStatus", "updatedAt" = NOW() 
          WHERE id = ${deal.id}
        `;
        if (deal.unitId) {
          await prisma.$executeRaw`
            UPDATE "Unit" 
            SET status = ${newUnitStatus}::"UnitStatus", "updatedAt" = NOW() 
            WHERE id = ${deal.unitId}
          `;
        }
      }
    }

    revalidatePath('/finance');
    revalidatePath('/deals');
    revalidatePath('/clients');
    revalidatePath('/');

    return { success: true };
  } catch (e) {
    console.error('unmatchTransactionAction error:', e);
    return { success: false, error: 'SERVER_ERROR', message: 'Ошибка сервера при отмене сопоставления.' };
  }
}

// 3. Эмуляция синхронизации с TBC API (PAY-012)
export async function syncTBCBankAPIAction(organizationId: string) {
  try {
    await requireRole(canManageFinance, 'синхронизация с банком');
    // Получаем текущие неоплаченные графики
    const pending = await getPendingSchedules(organizationId);
    let importedCount = 0;
    let matchedCount = 0;

    // Генерируем тестовые транзакции на основе неоплаченных графиков
    const mockTxs: any[] = [];
    
    if (pending.length > 0) {
      // Для первых 3 неоплаченных графиков генерируем точные транзакции
      const toSync = pending.slice(0, 3);
      toSync.forEach((p: any, idx: number) => {
        // Даты: сегодня, вчера, позавчера
        const txDate = new Date(Date.now() - idx * 24 * 60 * 60 * 1000);
        
        mockTxs.push({
          bank: 'TBC',
          payerName: p.leadName,
          payerIin: p.leadIin || p.leadPassport || '999111222',
          amount: p.amount,
          purpose: `Оплата по графику за квартиру №${p.unitNumber}, сделка ${p.dealId.substring(0, 8)}`,
          date: txDate.toISOString()
        });
      });
    }

    // Добавляем 2 случайных нераспознанных платежа
    mockTxs.push({
      bank: 'TBC',
      payerName: 'Мамедов Анар',
      payerIin: '12345678901',
      amount: 2500,
      purpose: 'Оплата взноса по договору б/н',
      date: new Date().toISOString()
    });
    mockTxs.push({
      bank: 'TBC',
      payerName: 'Gela Chanturia',
      payerIin: '01020304050',
      amount: 1200,
      purpose: 'Gela Chanturia invoice payment',
      date: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    });

    for (const tx of mockTxs) {
      // Проверяем дубликаты
      const duplicates: any[] = await prisma.$queryRaw`
        SELECT id FROM "BankTransaction"
        WHERE "amount" = ${tx.amount} 
          AND ABS(EXTRACT(EPOCH FROM ("date" - ${tx.date}::timestamp with time zone))) < 60
          AND "payerName" = ${tx.payerName}
          AND "organizationId" = ${organizationId}
        LIMIT 1
      `;

      if (duplicates.length > 0) continue; // Пропуск дубликатов

      const txId = crypto.randomUUID();
      await prisma.$executeRaw`
        INSERT INTO "BankTransaction" ("id", "bank", "payerName", "payerIin", "amount", "purpose", "date", "status", "organizationId", "createdAt", "updatedAt")
        VALUES (${txId}, ${tx.bank}, ${tx.payerName}, ${tx.payerIin}, ${tx.amount}, ${tx.purpose}, ${tx.date}::timestamp with time zone, 'UNMATCHED', ${organizationId}, NOW(), NOW())
      `;
      importedCount++;

      // Запуск автосопоставления
      const matched = await autoMatchTransaction({
        id: txId,
        amount: tx.amount,
        payerName: tx.payerName,
        payerIin: tx.payerIin,
        purpose: tx.purpose,
        organizationId
      });

      if (matched) matchedCount++;
    }

    revalidatePath('/finance');
    revalidatePath('/deals');
    revalidatePath('/clients');
    revalidatePath('/');

    return { success: true, importedCount, matchedCount };
  } catch (error) {
    console.error('syncTBCBankAPIAction error:', error);
    return { success: false, error: 'SERVER_ERROR', message: 'Ошибка API TBC Bank.' };
  }
}

// 4. Загрузка Excel выписки CAMT.053 / MT940 (PAY-014)
export async function importBankStatementAction(formData: FormData, organizationId: string) {
  try {
    await requireRole(canManageFinance, 'импорт банковской выписки');
    const file = formData.get('file') as File;
    if (!file) {
      return { success: false, error: 'FILE_MISSING', message: 'Файл не выбран.' };
    }

    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet) as any[];

    if (rows.length === 0) {
      return { success: false, error: 'EMPTY_FILE', message: 'Файл пуст.' };
    }

    let importedCount = 0;
    let matchedCount = 0;

    for (const row of rows) {
      const dateVal = row['Дата'] || row['Date'] || new Date();
      const amountVal = parseFloat(row['Сумма'] || row['Amount'] || 0);
      const payerNameVal = row['Плательщик'] || row['Payer'] || row['Payer Name'] || '';
      const payerIinVal = row['ИИН'] || row['IIN'] || row['Personal ID'] || '';
      const purposeVal = row['Назначение'] || row['Purpose'] || row['Details'] || '';
      const bankVal = row['Банк'] || row['Bank'] || 'MANUAL';

      if (!amountVal || isNaN(amountVal) || amountVal <= 0) continue;

      let dateStr = new Date().toISOString();
      try {
        // Если Excel дата в числовом формате
        if (typeof dateVal === 'number') {
          const dateObj = XLSX.SSF.parse_date_code(dateVal);
          dateStr = new Date(dateObj.y, dateObj.m - 1, dateObj.d).toISOString();
        } else {
          dateStr = new Date(dateVal).toISOString();
        }
      } catch (err) {
        console.warn('Date parsing warning:', err);
      }

      // Проверка дубликатов
      const duplicates: any[] = await prisma.$queryRaw`
        SELECT id FROM "BankTransaction"
        WHERE "amount" = ${amountVal} 
          AND ABS(EXTRACT(EPOCH FROM ("date" - ${dateStr}::timestamp with time zone))) < 60
          AND "payerName" = ${payerNameVal}
          AND "organizationId" = ${organizationId}
        LIMIT 1
      `;

      if (duplicates.length > 0) continue;

      const txId = crypto.randomUUID();
      await prisma.$executeRaw`
        INSERT INTO "BankTransaction" ("id", "bank", "payerName", "payerIin", "amount", "purpose", "date", "status", "organizationId", "createdAt", "updatedAt")
        VALUES (${txId}, ${bankVal}, ${payerNameVal}, ${payerIinVal}, ${amountVal}, ${purposeVal}, ${dateStr}::timestamp with time zone, 'UNMATCHED', ${organizationId}, NOW(), NOW())
      `;
      importedCount++;

      // Запуск автосопоставления
      const matched = await autoMatchTransaction({
        id: txId,
        amount: amountVal,
        payerName: payerNameVal,
        payerIin: payerIinVal,
        purpose: purposeVal,
        organizationId
      });

      if (matched) matchedCount++;
    }

    revalidatePath('/finance');
    revalidatePath('/deals');
    revalidatePath('/clients');
    revalidatePath('/');

    return { success: true, importedCount, matchedCount };
  } catch (error) {
    console.error('importBankStatementAction error:', error);
    return { success: false, error: 'SERVER_ERROR', message: 'Ошибка импорта выписки.' };
  }
}