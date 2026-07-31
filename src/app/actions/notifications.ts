"use server";

import { db as prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

//  Инициализация таблицы уведомлений
export async function initNotificationTable() {
  try {
    await prisma.$executeRaw`
 CREATE TABLE IF NOT EXISTS "Notification" (
 "id" TEXT PRIMARY KEY,
 "managerId" TEXT, -- null = для всех
 "role" TEXT, -- 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' | null
 "type" TEXT NOT NULL, -- 'PAYMENT' | 'BOOKING_EXPIRY' | 'MEETING' | 'CONTRACT' | 'SYSTEM'
 "title" TEXT NOT NULL,
 "body" TEXT NOT NULL,
 "link" TEXT, -- ссылка в CRM куда перейти
 "isRead" BOOLEAN NOT NULL DEFAULT false,
 "organizationId" TEXT NOT NULL,
 "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
 )
 `;
    return { success: true };
  } catch (error: any) {
    console.error("initNotificationTable error:", error);
    return { success: false };
  }
}

//  Получить уведомления для менеджера
export async function getNotifications(
  managerId: string,
  organizationId: string,
) {
  try {
    await initNotificationTable();
    const rows: any[] = await prisma.$queryRaw`
 SELECT * FROM "Notification"
 WHERE "organizationId" = ${organizationId}
 AND (
 "managerId" = ${managerId}
 OR "managerId" IS NULL
 )
 ORDER BY "createdAt" DESC
 LIMIT 50
 `;
    return { success: true, notifications: rows };
  } catch (error: any) {
    console.error("getNotifications error:", error);
    return { success: true, notifications: [] };
  }
}

//  Получить количество непрочитанных
export async function getUnreadCount(
  managerId: string,
  organizationId: string,
) {
  try {
    await initNotificationTable();
    const rows: any[] = await prisma.$queryRaw`
 SELECT COUNT(*)::int as count FROM "Notification"
 WHERE "organizationId" = ${organizationId}
 AND "isRead" = false
 AND (
 "managerId" = ${managerId}
 OR "managerId" IS NULL
 )
 `;
    return { count: rows[0]?.count ?? 0 };
  } catch {
    return { count: 0 };
  }
}

//  Пометить как прочитанное
export async function markNotificationRead(notificationId: string) {
  try {
    await prisma.$executeRaw`
 UPDATE "Notification" SET "isRead" = true WHERE "id" = ${notificationId}
 `;
    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("markNotificationRead error:", error);
    return { success: false };
  }
}

//  Пометить все как прочитанные
export async function markAllNotificationsRead(
  managerId: string,
  organizationId: string,
) {
  try {
    await prisma.$executeRaw`
 UPDATE "Notification"
 SET "isRead" = true
 WHERE "organizationId" = ${organizationId}
 AND "isRead" = false
 AND (
 "managerId" = ${managerId}
 OR "managerId" IS NULL
 )
 `;
    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("markAllNotificationsRead error:", error);
    return { success: false };
  }
}

//  Создать уведомление (вызывается системой)
export async function createNotification(data: {
  managerId?: string; // конкретный менеджер или null = всем
  role?: string; // фильтр по роли
  type:
    | "PAYMENT"
    | "BOOKING_EXPIRY"
    | "MEETING"
    | "CONTRACT"
    | "DEAL_STATUS"
    | "SYSTEM";
  title: string;
  body: string;
  link?: string;
  organizationId: string;
}) {
  try {
    await initNotificationTable();
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
 INSERT INTO "Notification" ("id", "managerId", "role", "type", "title", "body", "link", "isRead", "organizationId", "createdAt")
 VALUES (
 ${id},
 ${data.managerId ?? null},
 ${data.role ?? null},
 ${data.type},
 ${data.title},
 ${data.body},
 ${data.link ?? null},
 false,
 ${data.organizationId},
 NOW()
 )
 `;
    return { success: true, id };
  } catch (error: any) {
    console.error("createNotification error:", error);
    return { success: false };
  }
}

//  Удалить уведомление
export async function deleteNotification(notificationId: string) {
  try {
    await prisma.$executeRaw`
 DELETE FROM "Notification" WHERE "id" = ${notificationId}
 `;
    return { success: true };
  } catch (error: any) {
    return { success: false };
  }
}
