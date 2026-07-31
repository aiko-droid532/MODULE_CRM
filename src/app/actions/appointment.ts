'use server';

import { db as prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

// Получить занятые слоты для менеджера на определенную дату
export async function getBusySlots(managerId: string, date: string) {
  try {
    const appointments = await prisma.$queryRaw<any>`
      SELECT "appointmentTime" FROM "Lead"
      WHERE "appointmentManagerId" = ${managerId}
        AND "appointmentDate" = ${date}::date
        AND "appointmentStatus" = 'SCHEDULED'
    `;
    return appointments.map((a: any) => a.appointmentTime);
  } catch (error) {
    console.error('getBusySlots error:', error);
    return [];
  }
}

// Записать лида на прием
export async function scheduleAppointment(
  leadId: string,
  date: string,
  time: string,
  managerId: string,
  notes?: string
) {
  try {
    // Проверяем, не занят ли слот
    const busy = await prisma.$queryRaw<any>`
      SELECT COUNT(*) as count FROM "Lead"
      WHERE "appointmentManagerId" = ${managerId}
        AND "appointmentDate" = ${date}::date
        AND "appointmentTime" = ${time}::time
        AND "appointmentStatus" = 'SCHEDULED'
    `;
    
    if (Number(busy[0].count) > 0) {
      return { success: false, error: 'Это время уже занято' };
    }
    
    await prisma.$executeRaw`
      UPDATE "Lead"
      SET "appointmentDate" = ${date}::date,
          "appointmentTime" = ${time}::time,
          "appointmentManagerId" = ${managerId},
          "appointmentStatus" = 'SCHEDULED',
          "appointmentNotes" = ${notes || null},
          "updatedAt" = NOW()
      WHERE id = ${leadId}
    `;
    
    revalidatePath('/clients');
    return { success: true };
  } catch (error) {
    console.error('scheduleAppointment error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// Отменить запись
export async function cancelAppointment(leadId: string, reason: string) {
  try {
    await prisma.$executeRaw`
      UPDATE "Lead"
      SET "appointmentStatus" = 'CANCELLED',
          "appointmentNotes" = ${reason},
          "updatedAt" = NOW()
      WHERE id = ${leadId}
    `;
    revalidatePath('/clients');
    return { success: true };
  } catch (error) {
    console.error('cancelAppointment error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// Отметить прием как выполненный
export async function completeAppointment(leadId: string) {
  try {
    await prisma.$executeRaw`
      UPDATE "Lead"
      SET "appointmentStatus" = 'COMPLETED',
          "updatedAt" = NOW()
      WHERE id = ${leadId}
    `;
    revalidatePath('/clients');
    return { success: true };
  } catch (error) {
    console.error('completeAppointment error:', error);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

// Получить расписание менеджера на неделю
export async function getManagerSchedule(managerId: string, startDate: string) {
  try {
    const appointments = await prisma.$queryRaw`
      SELECT l.id, l.name, l.phone, l."appointmentDate", l."appointmentTime", l."appointmentStatus"
      FROM "Lead" l
      WHERE l."appointmentManagerId" = ${managerId}
        AND l."appointmentDate" >= ${startDate}::date
        AND l."appointmentDate" < ${startDate}::date + INTERVAL '7 days'
      ORDER BY l."appointmentDate", l."appointmentTime"
    `;
    return appointments;
  } catch (error) {
    console.error('getManagerSchedule error:', error);
    return [];
  }
}