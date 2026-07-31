"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import styles from "./NotificationBell.module.css";
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "@/app/actions/notifications";

interface NotificationBellProps {
  managerId: string;
  organizationId: string;
}

//  Тип → иконка и CSS класс
const TYPE_META: Record<string, { icon: string; cls: string; label: string }> =
  {
    PAYMENT: { icon: "", cls: styles.typePayment, label: "Оплата" },
    BOOKING_EXPIRY: { icon: "", cls: styles.typeBooking, label: "Бронь" },
    MEETING: { icon: "", cls: styles.typeMeeting, label: "Встреча" },
    CONTRACT: { icon: "", cls: styles.typeContract, label: "Договор" },
    DEAL_STATUS: { icon: "", cls: styles.typeDeal, label: "Сделка" },
    SYSTEM: { icon: "", cls: styles.typeSystem, label: "Система" },
  };

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн назад`;
  return new Date(dateStr).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
  });
}

export default function NotificationBell({
  managerId,
  organizationId,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  //  Загрузка уведомлений
  const loadNotifications = useCallback(async () => {
    setLoading(true);
    const res = await getNotifications(managerId, organizationId);
    if (res.success) {
      setNotifications(res.notifications);
      setUnreadCount(res.notifications.filter((n: any) => !n.isRead).length);
    }
    setLoading(false);
  }, [managerId, organizationId]);

  // Загружаем при открытии
  useEffect(() => {
    if (open) loadNotifications();
  }, [open, loadNotifications]);

  // Периодически обновляем счётчик (каждые 30 сек)
  useEffect(() => {
    const tick = async () => {
      const res = await getUnreadCount(managerId, organizationId);
      setUnreadCount(res.count);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [managerId, organizationId]);

  // Закрыть при клике вне панели
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  //  Клик по уведомлению
  const handleClick = async (n: any) => {
    if (!n.isRead) {
      await markNotificationRead(n.id);
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  };

  //  Пометить все прочитанными
  const handleMarkAll = async () => {
    await markAllNotificationsRead(managerId, organizationId);
    setNotifications((prev) => prev.map((x) => ({ ...x, isRead: true })));
    setUnreadCount(0);
  };

  //  Удалить уведомление
  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteNotification(id);
    setNotifications((prev) => prev.filter((x) => x.id !== id));
    const was = notifications.find((x) => x.id === id);
    if (was && !was.isRead) setUnreadCount((c) => Math.max(0, c - 1));
  };

  return (
    <div className={styles.bell} ref={panelRef}>
      {/*  Кнопка колокольчика  */}
      <button
        id="notification-bell-btn"
        className={`${styles.bellBtn} ${open ? styles.bellBtnActive : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Уведомления"
        aria-label={`Уведомления${unreadCount > 0 ? `, ${unreadCount} непрочитанных` : ""}`}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className={styles.badge}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/*  Выпадающая панель  */}
      {open && (
        <div className={styles.panel} id="notification-panel">
          {/* Заголовок */}
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>
              Уведомления
              {unreadCount > 0 && (
                <span
                  style={{
                    background: "#ef4444",
                    color: "#fff",
                    borderRadius: "9999px",
                    fontSize: "0.65rem",
                    padding: "1px 6px",
                    fontWeight: 700,
                  }}
                >
                  {unreadCount} новых
                </span>
              )}
            </span>
            {unreadCount > 0 && (
              <button className={styles.markAllBtn} onClick={handleMarkAll}>
                Все прочитаны
              </button>
            )}
          </div>

          {/* Список */}
          <div className={styles.list}>
            {loading ? (
              <div className={styles.empty}>
                <span className={styles.emptyIcon}></span>
                Загрузка...
              </div>
            ) : notifications.length === 0 ? (
              <div className={styles.empty}>
                <span className={styles.emptyIcon}></span>
                Нет новых уведомлений
              </div>
            ) : (
              notifications.map((n) => {
                const meta = TYPE_META[n.type] ?? TYPE_META.SYSTEM;
                return (
                  <div
                    key={n.id}
                    className={`${styles.item} ${!n.isRead ? styles.itemUnread : ""}`}
                    onClick={() => handleClick(n)}
                    title={n.link ? "Нажмите, чтобы перейти" : undefined}
                  >
                    <div className={`${styles.typeIcon} ${meta.cls}`}>
                      {meta.icon}
                    </div>
                    <div className={styles.itemBody}>
                      <div className={styles.itemTitle}>{n.title}</div>
                      <div className={styles.itemText}>{n.body}</div>
                      <div className={styles.itemTime}>
                        {relativeTime(n.createdAt)}
                      </div>
                    </div>
                    <button
                      className={styles.deleteBtn}
                      onClick={(e) => handleDelete(e, n.id)}
                      title="Удалить"
                    ></button>
                  </div>
                );
              })
            )}
          </div>

          {/* Подвал */}
          <div className={styles.panelFooter}>
            <span className={styles.footerText}>
              Показаны последние {notifications.length} уведомлений
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
