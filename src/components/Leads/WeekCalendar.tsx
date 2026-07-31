'use client';

import React, { useState, useEffect } from 'react';
import styles from './WeekCalendar.module.css';
import { getManagerSchedule } from '@/app/actions/leads';

interface WeekCalendarProps {
  managerId: string;
  onBookSlot?: (date: string, time: string) => void;
  onSelectSlot?: (slot: any) => void;
  refreshTrigger?: number;
}

// Полезная утилита для получения YYYY-MM-DD в локальной таймзоне
export function getLocalDateString(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function WeekCalendar({ managerId, onBookSlot, onSelectSlot, refreshTrigger = 0 }: WeekCalendarProps) {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [appointments, setAppointments] = useState<any[]>([]);

  // Находим понедельник текущей недели
  const getMonday = (d: Date) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
  };

  const monday = getMonday(currentDate);

  // Генерируем 5 рабочих дней недели (Пн-Пт)
  const days: Date[] = [];
  for (let i = 0; i < 5; i++) {
    const nextDay = new Date(monday);
    nextDay.setDate(monday.getDate() + i);
    days.push(nextDay);
  }

  // Загружаем приемы для текущей недели
  useEffect(() => {
    if (!managerId) return;
    
    const fetchSchedule = async () => {
      setLoading(true);
      const startDateStr = getLocalDateString(monday);
      const data = await getManagerSchedule(managerId, startDateStr);
      setAppointments(data || []);
      setLoading(false);
    };

    fetchSchedule();
  }, [currentDate, managerId, refreshTrigger]);

  // Сетка временных интервалов с 9:00 до 18:00 (каждые 30 мин)
  const timeSlots: string[] = [];
  for (let hour = 9; hour < 18; hour++) {
    timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
    timeSlots.push(`${hour.toString().padStart(2, '0')}:30`);
  }

  // Навигация по неделям
  const handlePrevWeek = () => {
    const prev = new Date(currentDate);
    prev.setDate(prev.getDate() - 7);
    setCurrentDate(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + 7);
    setCurrentDate(next);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Поиск приема в конкретный день и время
  const findAppointment = (date: Date, timeStr: string) => {
    const dateStr = getLocalDateString(date);
    return appointments.find(app => {
      // Robust date matching (support string or date object comparison)
      const appDateStr = typeof app.date === 'string' ? app.date.split('T')[0] : getLocalDateString(new Date(app.date));
      // Robust time matching (handles seconds like '09:30:00')
      const appTimeShort = app.time.slice(0, 5);
      return appDateStr === dateStr && appTimeShort === timeStr;
    });
  };

  // Форматирование заголовка недели (например: "9 июня — 13 июня 2026")
  const formatWeekRange = () => {
    const start = days[0];
    const end = days[days.length - 1];
    if (!start || !end) return '';

    const startMonth = start.toLocaleDateString('ru-RU', { month: 'long' });
    const endMonth = end.toLocaleDateString('ru-RU', { month: 'long' });
    const startYear = start.getFullYear();
    const endYear = end.getFullYear();

    if (startYear !== endYear) {
      return `${start.getDate()} ${startMonth} ${startYear} — ${end.getDate()} ${endMonth} ${endYear}`;
    }
    if (startMonth !== endMonth) {
      return `${start.getDate()} ${startMonth} — ${end.getDate()} ${endMonth} ${startYear}`;
    }
    return `${start.getDate()} — ${end.getDate()} ${startMonth} ${startYear}`;
  };

  const todayStr = getLocalDateString(new Date());

  return (
    <div className={styles.calendarContainer}>
      {/* Шапка управления календарем */}
      <div className={styles.calendarHeader}>
        <div className={styles.navGroup}>
          <button className={styles.navBtn} onClick={handleToday}>Сегодня</button>
          <button className={styles.navBtn} onClick={handlePrevWeek}>&larr;</button>
          <button className={styles.navBtn} onClick={handleNextWeek}>&rarr;</button>
        </div>
        <div className={styles.currentWeekText}>{formatWeekRange()}</div>
        <div style={{ width: '80px' }}></div> {/* Spacer */}
      </div>

      {loading ? (
        <div className={styles.loadingOverlay}>
          <span>⏳ Загрузка расписания...</span>
        </div>
      ) : (
        <div className={styles.grid}>
          {/* Пустая ячейка в левом верхнем углу */}
          <div className={styles.headerCellFirst}></div>

          {/* Заголовки дней (Пн-Пт) */}
          {days.map((day, idx) => {
            const dayNum = day.getDate();
            const dayName = day.toLocaleDateString('ru-RU', { weekday: 'short' });
            const dayDateStr = getLocalDateString(day);
            const isToday = dayDateStr === todayStr;

            return (
              <div key={idx} className={styles.headerCell}>
                <span className={styles.dayName}>{dayName}</span>
                <span className={`${styles.dayNumber} ${isToday ? styles.isToday : ''}`}>
                  {dayNum}
                </span>
              </div>
            );
          })}

          {/* Тайм-слоты и сетка приемов */}
          {timeSlots.map((time) => (
            <React.Fragment key={time}>
              {/* Колонка времени */}
              <div className={styles.timeColCell}>{time}</div>

              {/* Ячейки для каждого дня */}
              {days.map((day, dayIdx) => {
                const app = findAppointment(day, time);
                const dayDateStr = getLocalDateString(day);
                const isToday = dayDateStr === todayStr;

                return (
                  <div key={dayIdx} className={`${styles.gridCell} ${isToday ? styles.todayCell : ''}`}>
                    {app ? (
                      // Занятый слот (карточка приема)
                      <div
                        className={`${styles.appointmentCard} ${styles[`status_${app.status}`]}`}
                        onClick={() => onSelectSlot && onSelectSlot(app)}
                        title={`${app.leadName} (${app.leadPhone}) - ${app.status}`}
                      >
                        <div className={styles.clientName}>{app.leadName}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className={styles.slotTime}>{time}</span>
                          <span className={styles.phoneText}>{app.leadPhone}</span>
                        </div>
                      </div>
                    ) : (
                      // Свободный слот (кнопка записи)
                      onBookSlot && (
                        <button
                          className={styles.freeSlotButton}
                          onClick={() => onBookSlot(dayDateStr, time)}
                        >
                          <span className={styles.plusIcon}>+</span> Записать
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
