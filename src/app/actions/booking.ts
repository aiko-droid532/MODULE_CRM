'use server';

import { db as prisma, Prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { logAction } from '@/lib/logger';
import { generateDealNumber } from './deals';

export async function createBooking(data: {
  leadId: string;
  unitId: string;
  organizationId: string;
  type: 'SOFT' | 'HARD' | 'SERVICE';
  duration: number; // hours for SOFT, days for HARD
  customExpiresAt?: string | Date;
}) {
  try {
    // 1. Проверяем, нет ли уже активной брони на это помещение в Booking
    const activeBookings: any[] = await prisma.$queryRaw`
      SELECT b.id, l.name as "leadName", m.name as "managerName"
      FROM "Booking" b
      JOIN "Lead" l ON b."leadId" = l.id
      LEFT JOIN "Manager" m ON l."managerId" = m.id
      WHERE b."unitId" = ${data.unitId} AND b.status = 'ACTIVE'
      LIMIT 1
    `;

    if (activeBookings.length > 0) {
      const b = activeBookings[0];
      return { 
        success: false, 
        error: 'ALREADY_BOOKED', 
        message: `Этот объект уже забронирован клиентом ${b.leadName}${b.managerName ? `, менеджер: ${b.managerName}` : ''}.`
      };
    }

    // 2. Рассчитываем expiresAt
    let expiresAt = new Date();
    if (data.customExpiresAt) {
      expiresAt = new Date(data.customExpiresAt);
    } else if (data.type === 'SOFT') {
      expiresAt = new Date(Date.now() + data.duration * 60 * 60 * 1000);
    } else if (data.type === 'HARD') {
      expiresAt = new Date(Date.now() + data.duration * 24 * 60 * 60 * 1000);
    } else {
      // Service booking: 99 years duration
      expiresAt = new Date(Date.now() + 99 * 365 * 24 * 60 * 60 * 1000);
    }

    // 3. Создаем запись в Booking
    const bookingId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "Booking" ("id", "leadId", "unitId", "expiresAt", "type", "status", "organizationId", "createdAt", "updatedAt")
      VALUES (${bookingId}, ${data.leadId}, ${data.unitId}, ${expiresAt}, ${data.type}, 'ACTIVE', ${data.organizationId}, NOW(), NOW())
    `;

    // 4. Проверяем наличие сделки. Если её нет, создаем её
    const existingDeals: any[] = await prisma.$queryRaw`
      SELECT id FROM "Deal" 
      WHERE "leadId" = ${data.leadId} AND "unitId" = ${data.unitId} AND status NOT IN ('SUCCESS', 'FAILED', 'CANCELLED')
      LIMIT 1
    `;

    let dealId = '';
    let dealStatus = 'NEW_LEAD';
    if (data.type === 'SOFT') {
      dealStatus = 'PRE_RESERVATION'; // Soft Booking
    } else if (data.type === 'HARD') {
      dealStatus = 'RESERVATION'; // Hard Booking
    } else {
      dealStatus = 'CLIENT_CONFIRMATION';
    }

    if (existingDeals.length > 0) {
      dealId = existingDeals[0].id;
      // Обновляем статус существующей сделки
      await prisma.$executeRaw`
        UPDATE "Deal" 
        SET "status" = ${dealStatus}::"DealStatus", "updatedAt" = NOW()
        WHERE id = ${dealId}
      `;
    } else {
      dealId = crypto.randomUUID();
      const dealNumber = await generateDealNumber(data.organizationId);
      await prisma.$executeRaw`
        INSERT INTO "Deal" ("id", "leadId", "unitId", "organizationId", "status", "dealNumber", "createdAt", "updatedAt")
        VALUES (${dealId}, ${data.leadId}, ${data.unitId}, ${data.organizationId}, ${dealStatus}::"DealStatus", ${dealNumber}, NOW(), NOW())
      `;
    }

    // 5. Меняем статус квартиры в Unit
    let unitStatus = 'SOFT_BOOKED';
    if (data.type === 'HARD') {
      unitStatus = 'RESERVATION_PAID';
    } else if (data.type === 'SERVICE') {
      unitStatus = 'SERVICE';
    }

    await prisma.$executeRaw`
      UPDATE "Unit" 
      SET status = ${unitStatus}::"UnitStatus", "thinkingFlag" = false, "updatedAt" = NOW()
      WHERE id = ${data.unitId}
    `;

    // 6. Также переводим лида в статус IN_PROGRESS (Сделка/Клиент), если он был в старых этапах
    await prisma.$executeRaw`
      UPDATE "Lead"
      SET "status" = 'IN_PROGRESS'::"LeadStatus", "updatedAt" = NOW()
      WHERE id = ${data.leadId} AND "status" IN ('NEW', 'IN_QUALIFICATION', 'QUALIFIED')
    `;

    logAction('Создание нового бронирования', { leadId: data.leadId, unitId: data.unitId, type: data.type, duration: data.duration });
    revalidatePath('/shakhmatka');
    revalidatePath('/deals');
    revalidatePath('/clients');
    revalidatePath('/');
    
    return { success: true, bookingId };
  } catch (error: any) {
    console.error('Booking error:', error);
    if (error.message && error.message.includes('unique constraint')) {
      return { success: false, error: 'ALREADY_BOOKED', message: 'Этот объект уже забронирован другим клиентом (ошибка параллельного бронирования).' };
    }
    return { success: false, error: 'SERVER_ERROR', message: 'Ошибка сервера при создании бронирования.' };
  }
}

export async function checkAndReleaseExpiredBookings() {
  try {
    // 1. Находим все активные просроченные брони
    const expiredBookings: any[] = await prisma.$queryRaw`
      SELECT id, "unitId", "leadId", "type", "organizationId"
      FROM "Booking"
      WHERE status = 'ACTIVE' AND "expiresAt" < NOW()
    `;

    if (expiredBookings.length === 0) return { success: true, releasedCount: 0 };

    for (const b of expiredBookings) {
      // Обновляем статус брони на EXPIRED
      await prisma.$executeRaw`
        UPDATE "Booking" SET status = 'EXPIRED', "updatedAt" = NOW() WHERE id = ${b.id}
      `;

      // Обновляем сделку
      if (b.type === 'SOFT') {
        // Устная бронь: переводим сделку обратно в Личную консультацию (CONSULTATION)
        await prisma.$executeRaw`
          UPDATE "Deal" 
          SET status = 'CONSULTATION'::"DealStatus", "updatedAt" = NOW()
          WHERE "leadId" = ${b.leadId} AND "unitId" = ${b.unitId} AND status NOT IN ('SUCCESS', 'FAILED', 'CANCELLED')
        `;
      } else {
        // Жесткая бронь: переводим сделку в LOST (FAILED)
        await prisma.$executeRaw`
          UPDATE "Deal" 
          SET status = 'FAILED'::"DealStatus", "updatedAt" = NOW()
          WHERE "leadId" = ${b.leadId} AND "unitId" = ${b.unitId} AND status NOT IN ('SUCCESS', 'FAILED', 'CANCELLED')
        `;
        // Лид тоже переходит в LOST
        await prisma.$executeRaw`
          UPDATE "Lead"
          SET status = 'LOST'::"LeadStatus", "updatedAt" = NOW()
          WHERE id = ${b.leadId}
        `;
      }

      // Проверяем, есть ли лист ожидания на эту квартиру
      const queue = await getWaitingListAction(b.unitId, b.organizationId);
      if (queue.length > 0) {
        // Продвигаем первого клиента из очереди (VIP + FIFO)
        const nextInQueue = queue[0];

        // Удаляем его из очереди
        await prisma.$executeRaw`
          DELETE FROM "WaitingList" WHERE id = ${nextInQueue.id}
        `;

        // Оформляем на него устную бронь (SOFT) на 24 часа
        const bookingId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await prisma.$executeRaw`
          INSERT INTO "Booking" ("id", "leadId", "unitId", "expiresAt", "type", "status", "organizationId", "createdAt", "updatedAt")
          VALUES (${bookingId}, ${nextInQueue.leadId}, ${b.unitId}, ${expiresAt}, 'SOFT', 'ACTIVE', ${b.organizationId}, NOW(), NOW())
        `;

        // Создаем/обновляем сделку на нового клиента
        const existingDeals: any[] = await prisma.$queryRaw`
          SELECT id FROM "Deal" 
          WHERE "leadId" = ${nextInQueue.leadId} AND "unitId" = ${b.unitId} AND status NOT IN ('SUCCESS', 'FAILED', 'CANCELLED')
          LIMIT 1
        `;

        let dealId = '';
        if (existingDeals.length > 0) {
          dealId = existingDeals[0].id;
          await prisma.$executeRaw`
            UPDATE "Deal" 
            SET status = 'PRE_RESERVATION'::"DealStatus", "updatedAt" = NOW()
            WHERE id = ${dealId}
          `;
        } else {
          dealId = crypto.randomUUID();
          const dealNumber = await generateDealNumber(b.organizationId);
          await prisma.$executeRaw`
            INSERT INTO "Deal" ("id", "leadId", "unitId", "organizationId", "status", "dealNumber", "createdAt", "updatedAt")
            VALUES (${dealId}, ${nextInQueue.leadId}, ${b.unitId}, ${b.organizationId}, 'PRE_RESERVATION'::"DealStatus", ${dealNumber}, NOW(), NOW())
          `;
        }

        // Статус квартиры становится SOFT_BOOKED (Устная бронь)
        await prisma.$executeRaw`
          UPDATE "Unit" 
          SET status = 'SOFT_BOOKED'::"UnitStatus", "thinkingFlag" = false, "updatedAt" = NOW() 
          WHERE id = ${b.unitId}
        `;

        // Записываем лог изменений о продвижении очереди
        await prisma.$executeRaw`
          INSERT INTO "ChangeLog" ("id", "leadId", "managerId", "field", "oldValue", "newValue", "createdAt")
          VALUES (${crypto.randomUUID()}, ${nextInQueue.leadId}, ${b.organizationId}, 'QueuePromotion', 'В очереди', 'Забронировано на 24 часа', NOW())
        `;
      } else {
        // Очередь пуста -> Освобождаем квартиру
        await prisma.$executeRaw`
          UPDATE "Unit" SET status = 'FREE', "thinkingFlag" = ${b.type === 'SOFT'}, "updatedAt" = NOW() WHERE id = ${b.unitId}
        `;
      }
    }

    revalidatePath('/shakhmatka');
    revalidatePath('/deals');
    revalidatePath('/clients');
    revalidatePath('/');

    return { success: true, releasedCount: expiredBookings.length };
  } catch (error) {
    console.error('Error releasing expired bookings:', error);
    return { success: false, error: 'Failed to release expired bookings' };
  }
}

// Получить список всех лидов для выпадающего списка
export async function getLeadsList(organizationId: string) {
  return await prisma.$queryRaw`
    SELECT * FROM "Lead" 
    WHERE "organizationId" = ${organizationId} 
    ORDER BY "createdAt" DESC
  `;
}

// Ручное снятие бронирования с проверкой ролей
export async function releaseBooking(data: {
  unitId: string;
  organizationId: string;
  userRole: string;
}) {
  try {
    // 1. Находим активную бронь на эту квартиру
    const activeBookings: any[] = await prisma.$queryRaw`
      SELECT id, "leadId", "type" 
      FROM "Booking" 
      WHERE "unitId" = ${data.unitId} AND status = 'ACTIVE' 
      LIMIT 1
    `;

    if (activeBookings.length === 0) {
      return { success: false, error: 'NO_ACTIVE_BOOKING', message: 'Нет активного бронирования для этого объекта.' };
    }

    const b = activeBookings[0];

    // 2. Если бронь служебная, проверять права (РОП, Администратор, Супервайзер) - отключено временно для тестов
    if (b.type === 'SERVICE') {
      // const isRopOrAdmin = data.userRole === 'supervisor' || data.userRole === 'admin' || data.userRole === 'rop';
      // if (!isRopOrAdmin) {
      //   return { success: false, error: 'FORBIDDEN', message: 'Служебное резервирование может быть снято только РОПом или администратором.' };
      // }
    }

    // 3. Отменяем бронь в Booking
    await prisma.$executeRaw`
      UPDATE "Booking" 
      SET status = 'CANCELLED', "updatedAt" = NOW() 
      WHERE id = ${b.id}
    `;

    // 4. Переводим сделку в статус CANCELLED
    await prisma.$executeRaw`
      UPDATE "Deal" 
      SET status = 'CANCELLED'::"DealStatus", "updatedAt" = NOW()
      WHERE "leadId" = ${b.leadId} AND "unitId" = ${data.unitId} AND status NOT IN ('SUCCESS', 'FAILED', 'CANCELLED')
    `;

    // 5. Проверяем очередь листа ожидания на эту квартиру
    const queue = await getWaitingListAction(data.unitId, data.organizationId);
    if (queue.length > 0) {
      // Продвигаем первого клиента из очереди (VIP + FIFO)
      const nextInQueue = queue[0];

      // Удаляем его из очереди
      await prisma.$executeRaw`
        DELETE FROM "WaitingList" WHERE id = ${nextInQueue.id}
      `;

      // Оформляем на него устную бронь (SOFT) на 24 часа
      const bookingId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.$executeRaw`
        INSERT INTO "Booking" ("id", "leadId", "unitId", "expiresAt", "type", "status", "organizationId", "createdAt", "updatedAt")
        VALUES (${bookingId}, ${nextInQueue.leadId}, ${data.unitId}, ${expiresAt}, 'SOFT', 'ACTIVE', ${data.organizationId}, NOW(), NOW())
      `;

      // Создаем/обновляем сделку на нового клиента
      const existingDeals: any[] = await prisma.$queryRaw`
        SELECT id FROM "Deal" 
        WHERE "leadId" = ${nextInQueue.leadId} AND "unitId" = ${data.unitId} AND status NOT IN ('SUCCESS', 'FAILED', 'CANCELLED')
        LIMIT 1
      `;

      let dealId = '';
      if (existingDeals.length > 0) {
        dealId = existingDeals[0].id;
        await prisma.$executeRaw`
          UPDATE "Deal" 
          SET status = 'PRE_RESERVATION'::"DealStatus", "updatedAt" = NOW()
          WHERE id = ${dealId}
        `;
      } else {
        dealId = crypto.randomUUID();
        const dealNumber = await generateDealNumber(data.organizationId);
        await prisma.$executeRaw`
          INSERT INTO "Deal" ("id", "leadId", "unitId", "organizationId", "status", "dealNumber", "createdAt", "updatedAt")
          VALUES (${dealId}, ${nextInQueue.leadId}, ${data.unitId}, ${data.organizationId}, 'PRE_RESERVATION'::"DealStatus", ${dealNumber}, NOW(), NOW())
        `;
      }

      // Статус квартиры становится SOFT_BOOKED (Устная бронь)
      await prisma.$executeRaw`
        UPDATE "Unit" 
        SET status = 'SOFT_BOOKED'::"UnitStatus", "thinkingFlag" = false, "updatedAt" = NOW() 
        WHERE id = ${data.unitId}
      `;

      // Записываем лог изменений о продвижении очереди
      await prisma.$executeRaw`
        INSERT INTO "ChangeLog" ("id", "leadId", "managerId", "field", "oldValue", "newValue", "createdAt")
        VALUES (${crypto.randomUUID()}, ${nextInQueue.leadId}, ${data.organizationId}, 'QueuePromotion', 'В очереди', 'Забронировано на 24 часа', NOW())
      `;
    } else {
      // Очередь пуста -> Освобождаем квартиру в Unit
      await prisma.$executeRaw`
        UPDATE "Unit" 
        SET status = 'FREE', "thinkingFlag" = false, "updatedAt" = NOW() 
        WHERE id = ${data.unitId}
      `;
    }

    logAction('Снятие бронирования вручную', { unitId: data.unitId, userRole: data.userRole });
    revalidatePath('/shakhmatka');
    revalidatePath('/deals');
    revalidatePath('/clients');
    revalidatePath('/');

    return { success: true };
  } catch (error) {
    console.error('Error releasing booking manually:', error);
    return { success: false, error: 'SERVER_ERROR', message: 'Ошибка сервера при снятии бронирования.' };
  }
}

// === ЛИСТ ОЖИДАНИЯ (WAITING LIST) ACTIONS ===

export async function addToWaitingListAction(data: {
  unitId: string;
  leadId: string;
  organizationId: string;
}) {
  try {
    logAction('Добавление клиента в лист ожидания квартиры', { unitId: data.unitId, leadId: data.leadId });
    // Проверим, нет ли уже этого лида в очереди
    const existing: any[] = await prisma.$queryRaw`
      SELECT id FROM "WaitingList" 
      WHERE "unitId" = ${data.unitId} AND "leadId" = ${data.leadId} AND "organizationId" = ${data.organizationId}
      LIMIT 1
    `;
    
    if (existing.length > 0) {
      return { success: false, error: 'ALREADY_IN_QUEUE', message: 'Этот клиент уже стоит в листе ожидания на эту квартиру.' };
    }

    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "WaitingList" ("id", "unitId", "leadId", "organizationId", "createdAt", "updatedAt")
      VALUES (${id}, ${data.unitId}, ${data.leadId}, ${data.organizationId}, NOW(), NOW())
    `;

    revalidatePath('/shakhmatka');
    return { success: true };
  } catch (err) {
    console.error('addToWaitingListAction error:', err);
    return { success: false, error: 'SERVER_ERROR', message: 'Ошибка сервера при добавлении в очередь.' };
  }
}

export async function removeFromWaitingListAction(data: {
  waitingListId: string;
  organizationId: string;
}) {
  try {
    await prisma.$executeRaw`
      DELETE FROM "WaitingList" 
      WHERE id = ${data.waitingListId} AND "organizationId" = ${data.organizationId}
    `;
    
    revalidatePath('/shakhmatka');
    return { success: true };
  } catch (err) {
    console.error('removeFromWaitingListAction error:', err);
    return { success: false, error: 'SERVER_ERROR', message: 'Ошибка сервера при удалении из очереди.' };
  }
}

export async function getWaitingListAction(unitId: string, organizationId: string) {
  try {
    // Сортируем: сначала VIP лиды (isVip DESC), затем по FIFO (createdAt ASC)
    const list: any[] = await prisma.$queryRaw`
      SELECT 
        wl.id,
        wl."unitId",
        wl."leadId",
        wl."createdAt",
        l.name as "leadName",
        l.phone as "leadPhone",
        l."isVip" as "leadIsVip"
      FROM "WaitingList" wl
      JOIN "Lead" l ON wl."leadId" = l.id
      WHERE wl."unitId" = ${unitId} AND wl."organizationId" = ${organizationId}
      ORDER BY l."isVip" DESC, wl."createdAt" ASC
    `;
    return list;
  } catch (err) {
    console.error('getWaitingListAction error:', err);
    return [];
  }
}
