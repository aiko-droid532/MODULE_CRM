'use client';

import React, { useState, useEffect } from 'react';
import styles from './Leads.module.css';
import { 
  assignLeadToManager, 
  assignLeadAutomatically,
  logCallAttempt, 
  updateLeadStatus, 
  qualifyLead,
  getLeadsKanban,
  reassignLead,
  createClient,
  createDeal,
  getLeadInterests,
  bookScheduleSlot,
  getManagerSchedule,
  getLeadSchedule,
  completeScheduleSlot,
  cancelScheduleSlot
} from '@/app/actions/leads';
import { useRouter } from 'next/navigation';

// Статусы по ТЗ (6 статусов)
const COLUMNS = [
  { id: 'NEW', title: '🟡 Новые лиды', description: 'Поступили, не разобраны', color: '#f59e0b' },
  { id: 'IN_QUALIFICATION', title: '🟠 В квалификации', description: 'Офис-менеджер взял в работу', color: '#f97316' },
  { id: 'QUALIFIED', title: '🟢 Квалифицирован', description: 'Передан менеджеру ОП', color: '#10b981' },
  { id: 'IN_PROGRESS', title: '🔵 В работе', description: 'Менеджер ОП работает', color: '#3b82f6' },
  { id: 'CONVERTED', title: '✅ Конвертирован', description: 'В сделку', color: '#8b5cf6' },
  { id: 'LOST', title: '⚫ Закрыт без реализации', description: 'Указана причина', color: '#6b7280' }
];

// Причины потери лида
const LOST_REASONS = [
  'Не дозвонились (3 попытки)',
  'Явный отказ клиента',
  'Бюджет не совпал',
  'Купил у конкурента',
  'Передумал',
  'Не подходит локация',
  'Другое'
];

// КОМПОНЕНТА – ГРАФИК ПРИЕМА
// КОМПОНЕНТА – ГРАФИК ПРИЕМА (С КАЛЕНДАРЕМ + СИНИЙ ЦВЕТ)
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

function ScheduleModal({ lead, managerId, onClose, onRefresh }: { 
  lead: any; 
  managerId: string; 
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [existingSlots, setExistingSlots] = useState<any[]>([]);
  const [leadSlots, setLeadSlots] = useState<any[]>([]);
  const [managersMap, setManagersMap] = useState<Record<string, string>>({});
  
  // Быстрые кнопки: ближайшие 7 рабочих дней (пн-пт)
  const getQuickDays = () => {
    const days = [];
    const today = new Date();
    let count = 0;
    let i = 0;
    while (count < 7 && i < 30) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dayOfWeek = date.getDay();
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        days.push(date);
        count++;
      }
      i++;
    }
    return days;
  };
  
  const quickDays = getQuickDays();
  
  // Временные слоты с 9:00 до 18:00
  const timeSlots = [];
  for (let hour = 9; hour < 18; hour++) {
    timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
    timeSlots.push(`${hour.toString().padStart(2, '0')}:30`);
  }
  
  // Фильтруем доступные даты в календаре (только рабочие дни)
  const filterDate = (date: Date) => {
    const dayOfWeek = date.getDay();
    return dayOfWeek >= 1 && dayOfWeek <= 5; // только пн-пт
  };
  
  // Загружаем занятые слоты при выборе даты
  useEffect(() => {
    if (selectedDate && managerId) {
      const dateStr = selectedDate.toISOString().split('T')[0];
      getManagerSchedule(managerId, dateStr).then(setExistingSlots);
    }
  }, [selectedDate, managerId]);
  
  // Загружаем историю лида
  useEffect(() => {
    if (lead?.id) {
      getLeadSchedule(lead.id).then(async (slots) => {
        setLeadSlots(slots);
        // Загружаем имена менеджеров для истории
        const managerIds = [...new Set(slots.map(s => s.managerId).filter(Boolean))];
        for (const mid of managerIds) {
          if (mid && !managersMap[mid]) {
            try {
              const res = await fetch(`/api/managers/${mid}`);
              const data = await res.json();
              setManagersMap(prev => ({ ...prev, [mid]: data.name || mid.slice(0, 8) }));
            } catch {
              setManagersMap(prev => ({ ...prev, [mid]: mid.slice(0, 8) }));
            }
          }
        }
      });
    }
  }, [lead]);
  
  const isSlotBooked = (date: Date, time: string) => {
    if (!date) return false;
    const dateStr = date.toISOString().split('T')[0];
    return existingSlots.some(s => s.date === dateStr && s.time === time);
  };
  
  const handleBook = async () => {
    if (!selectedDate || !selectedTime) {
      alert('Выберите дату и время');
      return;
    }
    setLoading(true);
    const res = await bookScheduleSlot({
      leadId: lead.id,
      managerId,
      date: selectedDate.toISOString().split('T')[0],
      time: selectedTime
    });
    if (res.success) {
      alert('✅ Лид успешно записан на прием!');
      onRefresh();
      onClose();
    } else {
      alert(res.message || 'Ошибка при записи');
    }
    setLoading(false);
  };
  
  return (
    <div className={styles.overlay}>
      <div className={styles.modal} style={{ maxWidth: '850px', borderRadius: '24px', padding: '0', overflow: 'hidden' }}>
        {/* Шапка с синим градиентом */}
        <div style={{ 
          background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', 
          padding: '24px 28px',
          color: 'white'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>📅 Запись на прием</h2>
              <p style={{ margin: '8px 0 0 0', opacity: 0.9, fontSize: '0.9rem' }}>
                Выберите удобное время для визита клиента в офис
              </p>
            </div>
            <button 
              onClick={onClose}
              style={{ 
                background: 'rgba(255,255,255,0.2)', 
                border: 'none', 
                borderRadius: '12px',
                width: '32px',
                height: '32px',
                fontSize: '18px',
                cursor: 'pointer',
                color: 'white',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
            >
              ✕
            </button>
          </div>
        </div>
        
        {/* Информация о клиенте */}
        <div style={{ 
          padding: '20px 28px', 
          background: '#f8fafc', 
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          gap: '24px',
          flexWrap: 'wrap'
        }}>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>Клиент</span>
            <p style={{ margin: '4px 0 0 0', fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>{lead.name}</p>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>Телефон</span>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.95rem', color: '#475569' }}>{lead.phone}</p>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>Ответственный менеджер</span>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem' }}>
              <span style={{ 
                background: '#dbeafe', 
                color: '#1d4ed8', 
                padding: '2px 10px', 
                borderRadius: '20px',
                fontSize: '0.75rem',
                fontWeight: 600
              }}>
                {managerId === 'default_manager' ? 'Текущий менеджер' : managerId.slice(0, 8)}
              </span>
            </p>
          </div>
        </div>
        
        {/* Основное содержимое */}
        <div style={{ padding: '28px' }}>
          {/* Двойной выбор даты: Календарь + Быстрые кнопки */}
          <div style={{ marginBottom: '28px' }}>
            <label style={{ fontWeight: 600, color: '#1e293b', display: 'block', marginBottom: '12px', fontSize: '0.85rem' }}>
              📆 Выберите дату
            </label>
            
            {/* Календарь */}
            <div style={{ marginBottom: '20px' }}>
              <DatePicker
                selected={selectedDate}
                onChange={(date: Date) => setSelectedDate(date)}
                filterDate={filterDate}
                placeholderText="Выберите дату в календаре"
                dateFormat="dd MMMM yyyy"
                locale="ru"
                className={styles.input}
                style={{ width: '100%', padding: '12px' }}
                popperPlacement="bottom-start"
              />
            </div>
            
            {/* Быстрые кнопки с днями */}
            <div style={{ 
              display: 'flex', 
              gap: '10px', 
              flexWrap: 'wrap',
              marginTop: '12px'
            }}>
              {quickDays.map((date, idx) => {
                const dateStr = date.toISOString().split('T')[0];
                const isSelected = selectedDate?.toISOString().split('T')[0] === dateStr;
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDate(date)}
                    style={{
                      padding: '10px 16px',
                      borderRadius: '40px',
                      border: isSelected ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                      background: isSelected ? '#eff6ff' : 'white',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <span style={{ fontWeight: 500, fontSize: '0.85rem', color: '#1e293b' }}>
                      {date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          
          {/* Выбор времени */}
          <div style={{ marginBottom: '32px' }}>
            <label style={{ fontWeight: 600, color: '#1e293b', display: 'block', marginBottom: '12px', fontSize: '0.85rem' }}>
              ⏰ Выберите время
            </label>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(4, 1fr)', 
              gap: '10px'
            }}>
              {timeSlots.map(time => {
                const isBooked = selectedDate ? isSlotBooked(selectedDate, time) : false;
                const isSelected = selectedTime === time;
                return (
                  <button
                    key={time}
                    onClick={() => !isBooked && setSelectedTime(time)}
                    disabled={!selectedDate || isBooked}
                    style={{
                      padding: '12px',
                      borderRadius: '12px',
                      border: isSelected ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                      background: isBooked ? '#f1f5f9' : (isSelected ? '#eff6ff' : 'white'),
                      cursor: (!selectedDate || isBooked) ? 'not-allowed' : 'pointer',
                      opacity: (!selectedDate || isBooked) ? 0.5 : 1,
                      fontSize: '0.9rem',
                      fontWeight: 500,
                      color: isBooked ? '#94a3b8' : '#1e293b',
                      transition: 'all 0.2s'
                    }}
                  >
                    {time}
                    {isBooked && <span style={{ fontSize: '0.6rem', display: 'block', color: '#ef4444' }}>занято</span>}
                  </button>
                );
              })}
            </div>
          </div>
          
          {/* Кнопки действия */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginBottom: '32px' }}>
            <button 
              onClick={onClose}
              style={{
                padding: '10px 24px',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                background: 'white',
                cursor: 'pointer',
                fontWeight: 500,
                color: '#64748b',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
            >
              Отмена
            </button>
            <button 
              onClick={handleBook} 
              disabled={loading || !selectedDate || !selectedTime}
              style={{
                padding: '10px 28px',
                borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                cursor: (loading || !selectedDate || !selectedTime) ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                color: 'white',
                opacity: (loading || !selectedDate || !selectedTime) ? 0.6 : 1,
                transition: 'all 0.2s'
              }}
            >
              {loading ? '⏳ Запись...' : '✅ Подтвердить запись'}
            </button>
          </div>
          
          {/* История посещений с менеджером */}
          {leadSlots.length > 0 && (
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '24px' }}>
              <h4 style={{ margin: '0 0 16px 0', fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>
                📋 История предыдущих записей
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {leadSlots.map(slot => (
                  <div key={slot.id} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: '#f8fafc',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0'
                  }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>
                        {new Date(slot.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </span>
                      <span style={{ marginLeft: '12px', color: '#64748b' }}>в {slot.time}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ 
                        fontSize: '0.7rem', 
                        color: '#64748b',
                        background: '#f1f5f9',
                        padding: '4px 8px',
                        borderRadius: '8px'
                      }}>
                        👤 {managersMap[slot.managerId] || slot.managerId?.slice(0, 8) || '—'}
                      </span>
                      {slot.status === 'BOOKED' && (
                        <span style={{ background: '#fef3c7', color: '#92400e', padding: '4px 12px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 600 }}>
                          🟡 Запланирован
                        </span>
                      )}
                      {slot.status === 'COMPLETED' && (
                        <span style={{ background: '#d1fae5', color: '#065f46', padding: '4px 12px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 600 }}>
                          ✅ Состоялся
                        </span>
                      )}
                      {slot.status === 'CANCELLED' && (
                        <span style={{ background: '#fee2e2', color: '#991b1b', padding: '4px 12px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 600 }}>
                          ❌ Отменен
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// КОМПОНЕНТА КВАЛИФИКАЦИИ (с новыми полями)
function QualifyModal({ lead, onClose, onQualify }: { 
  lead: any; 
  onClose: () => void;
  onQualify: (leadId: string, data: any) => Promise<void>;
}) {
  const [form, setForm] = useState({
    interestedProjectId: lead.interestedProjectId || '',
    propertyType: lead.propertyType || 'Apartment',
    budgetMin: lead.budgetMin || '',
    budgetMax: lead.budgetMax || '',
    paymentMethod: lead.paymentMethod || 'Cash',
    sourceInfo: lead.sourceInfo || '',
    roomsInterested: lead.roomsInterested || '',
    areaMin: lead.areaMin || '',
    areaMax: lead.areaMax || '',
    deliveryDeadline: lead.deliveryDeadline || ''
  });

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} style={{ maxWidth: '600px' }}>
        <h2>📋 Квалификация лида</h2>
        <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>Заполните информацию о клиенте</p>
        
        <div className={styles.formGroup}>
          <label>Жилой комплекс интереса (необязательно)</label>
          <select className={styles.input} value={form.interestedProjectId} onChange={e => setForm({...form, interestedProjectId: e.target.value})}>
            <option value="">Не выбран</option>
            <option value="project_1">Астана Тауэр</option>
            <option value="project_2">Green Park</option>
          </select>
        </div>
        
        <div className={styles.formGroup}>
          <label>Тип помещения</label>
          <select className={styles.input} value={form.propertyType} onChange={e => setForm({...form, propertyType: e.target.value})}>
            <option value="Apartment">Квартира</option>
            <option value="Commercial">Коммерция</option>
            <option value="Parking">Паркинг</option>
            <option value="Storage">Кладовка</option>
          </select>
        </div>
        
        <div className={styles.formGroup}>
          <label>Комнатность</label>
          <select className={styles.input} value={form.roomsInterested} onChange={e => setForm({...form, roomsInterested: e.target.value})}>
            <option value="">Любая</option>
            <option value="1">1 комната</option>
            <option value="2">2 комнаты</option>
            <option value="3">3 комнаты</option>
            <option value="4">4+ комнаты</option>
          </select>
        </div>
        
        <div className={styles.formGroup}>
          <label>Площадь (м²)</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input className={styles.input} placeholder="От" value={form.areaMin} onChange={e => setForm({...form, areaMin: e.target.value})} />
            <input className={styles.input} placeholder="До" value={form.areaMax} onChange={e => setForm({...form, areaMax: e.target.value})} />
          </div>
        </div>
        
        <div className={styles.formGroup}>
          <label>Срок сдачи объекта</label>
          <select className={styles.input} value={form.deliveryDeadline} onChange={e => setForm({...form, deliveryDeadline: e.target.value})}>
            <option value="">Не важно</option>
            <option value="2024">2024 год</option>
            <option value="2025">2025 год</option>
            <option value="2026">2026 год</option>
            <option value="2027+">2027+ год</option>
          </select>
        </div>
        
        <div className={styles.formGroup}>
          <label>Бюджет (USD)</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input className={styles.input} placeholder="От" value={form.budgetMin} onChange={e => setForm({...form, budgetMin: e.target.value})} />
            <input className={styles.input} placeholder="До" value={form.budgetMax} onChange={e => setForm({...form, budgetMax: e.target.value})} />
          </div>
        </div>
        
        <div className={styles.formGroup}>
          <label>Способ оплаты</label>
          <select className={styles.input} value={form.paymentMethod} onChange={e => setForm({...form, paymentMethod: e.target.value})}>
            <option value="Cash">100% оплата</option>
            <option value="Installment">Рассрочка</option>
            <option value="Mortgage">Ипотека</option>
            <option value="Cession">Цессия</option>
          </select>
        </div>
        
        <div className={styles.formGroup}>
          <label>Дополнительная информация об источнике</label>
          <input className={styles.input} placeholder="Как узнал о нас?" value={form.sourceInfo} onChange={e => setForm({...form, sourceInfo: e.target.value})} />
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '2rem' }}>
          <button className={`${styles.btnAction} ${styles.btnSecondary}`} onClick={onClose}>Отмена</button>
          <button className={styles.btnAction} onClick={() => onQualify(lead.id, form)}>Подтвердить</button>
        </div>
      </div>
    </div>
  );
}

// Модалка для LOST
function LostModal({ leadId, lostReason, setLostReason, onConfirm, onClose }: { 
  leadId: string; 
  lostReason: string; 
  setLostReason: (val: string) => void; 
  onConfirm: (id: string) => void; 
  onClose: () => void;
}) {
  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <h2>❌ Причина отказа</h2>
        <p>Укажите причину, по которой лид не был реализован:</p>
        
        <div className={styles.formGroup}>
          <select className={styles.input} value={lostReason} onChange={e => setLostReason(e.target.value)}>
            <option value="">Выберите причину...</option>
            {LOST_REASONS.map(reason => (
              <option key={reason} value={reason}>{reason}</option>
            ))}
          </select>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '2rem' }}>
          <button className={`${styles.btnAction} ${styles.btnSecondary}`} onClick={onClose}>Отмена</button>
          <button className={styles.btnAction} onClick={() => onConfirm(leadId)}>Подтвердить</button>
        </div>
      </div>
    </div>
  );
}

export default function LeadsClient({ leads: initialLeads, organizationId }: { leads: any[], organizationId: string }) {
  const router = useRouter();
  const [leads, setLeads] = useState(initialLeads);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showQualifyModal, setShowQualifyModal] = useState<any>(null);
  const [showLostModal, setShowLostModal] = useState<any>(null);
  const [showConvertModal, setShowConvertModal] = useState<any>(null);
  const [showScheduleModal, setShowScheduleModal] = useState<any>(null);
  
  const [leadInterests, setLeadInterests] = useState<any[]>([]);
  const [selectedInterestId, setSelectedInterestId] = useState('');
  
  const [lostReason, setLostReason] = useState('');
  const [formData, setFormData] = useState({ name: '', phone: '', source: 'WEBSITE' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoAssign, setAutoAssign] = useState(true);
  const [draggedLead, setDraggedLead] = useState<any>(null);

  // Временно берем managerId из organizationId (или можно из сессии)
  const currentManagerId = organizationId || 'default_manager';

  const refreshLeads = async () => {
    const fresh = await getLeadsKanban(organizationId);
    setLeads(fresh);
    router.refresh();
  };

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const int = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(int);
  }, []);

  const getSLA = (createdAt: string, status: string) => {
    if (status !== 'NEW') return null;
    const diffMin = Math.floor((now - new Date(createdAt).getTime()) / 60000);
    const left = 15 - diffMin;
    if (left > 0) return { expired: false, text: `${left} мин`, percent: (diffMin / 15) * 100 };
    return { expired: true, text: `Просрочено на ${Math.abs(left)} мин`, percent: 100 };
  };

  const handleCreate = async () => {
    setError(null);
    setLoading(true);
    const res = await createClient({ ...formData, organizationId, type: 'LEAD' });
    if (!res.success) {
      if (res.error === 'DUPLICATE') {
        setError(`⚠️ Обнаружен дубликат! Лид с таким номером уже есть.`);
      } else {
        setError('Произошла ошибка при создании лида');
      }
    } else {
      setShowAddModal(false);
      setFormData({ name: '', phone: '', source: 'WEBSITE' });
      if (autoAssign) {
        await assignLeadAutomatically(res.client.id, organizationId);
      }
      await refreshLeads();
    }
    setLoading(false);
  };

  const onAssign = async (id: string) => {
    await assignLeadToManager(id, currentManagerId);
    await refreshLeads();
  };

  const handleDragStart = (e: React.DragEvent, lead: any) => {
    setDraggedLead(lead);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    if (!draggedLead) return;
    if (draggedLead.status !== targetStatus) {
      await updateLeadStatus(draggedLead.id, targetStatus);
      await refreshLeads();
    }
    setDraggedLead(null);
  };

  const onCall = async (id: string) => {
    const res = await logCallAttempt(id);
    if (res.attempts >= 3) {
      alert('⚠️ Выполнено 3 попытки звонка. Лид будет закрыт как LOST.');
    }
    await refreshLeads();
  };

  const onChangeStatus = async (id: string, status: string) => {
    if (status === 'LOST') {
      setShowLostModal(id);
      return;
    }
    await updateLeadStatus(id, status);
    await refreshLeads();
  };

  const onQualify = async (leadId: string, qualifyData: any) => {
    await qualifyLead(leadId, qualifyData);
    setShowQualifyModal(null);
    await refreshLeads();
  };

  const onConfirmLost = async (id: string) => {
    if (!lostReason) {
      alert('Укажите причину отказа');
      return;
    }
    await updateLeadStatus(id, 'LOST');
    setShowLostModal(null);
    setLostReason('');
    await refreshLeads();
  };

  const handleOpenConvert = async (lead: any) => {
    setLoading(true);
    const interests = await getLeadInterests(lead.id);
    setLeadInterests(interests);
    if (interests.length > 0) {
      setSelectedInterestId(interests[0].id);
    }
    setShowConvertModal(lead);
    setLoading(false);
  };

  const handleConfirmConvert = async () => {
    if (!showConvertModal) return;
    if (!selectedInterestId) {
      alert('У лида должен быть выбран хотя бы один интерес (квартира) для создания сделки!');
      return;
    }
    
    setLoading(true);
    const selectedInterest = leadInterests.find(i => i.id === selectedInterestId);
    if (!selectedInterest) {
      alert('Ошибка: Выбранный интерес не найден');
      setLoading(false);
      return;
    }

    const res = await createDeal({
      leadId: showConvertModal.id,
      unitId: selectedInterest.unitId,
      interestId: selectedInterest.id,
      organizationId,
      managerId: currentManagerId
    });

    if (res.success) {
      await updateLeadStatus(showConvertModal.id, 'CONVERTED');
      alert('Лид успешно конвертирован в сделку!');
      setShowConvertModal(null);
      await refreshLeads();
    } else {
      alert('Ошибка при конвертации: ' + (res.message || 'Проверьте, указан ли у клиента телефон и источник.'));
    }
    setLoading(false);
  };

  const getLeadsByStatus = (status: string) => leads.filter(l => l.status === status);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px'}}>
          <div>
            <h1>🎯 Управление Лидами</h1>
            <p style={{ color: '#64748b', marginTop: '4px' }}>Канбан-доска с распределением и SLA контролем</p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
              <input type="checkbox" checked={autoAssign} onChange={e => setAutoAssign(e.target.checked)} />
              Автораспределение
            </label>
            <button className={styles.btnAction} style={{padding: '10px 20px', fontSize: '1rem'}} onClick={() => setShowAddModal(true)}>
              + Добавить лида
            </button>
          </div>
        </div>
      </header>

      <div className={styles.board}>
        {COLUMNS.map(col => {
          const colLeads = getLeadsByStatus(col.id);
          return (
            <div 
              key={col.id} 
              className={styles.column}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, col.id)}
              style={{ borderTop: `4px solid ${col.color}` }}
            >
              <div className={styles.columnHeader}>
                <div>
                  <span className={styles.columnTitle}>{col.title}</span>
                  <span className={styles.columnDesc}>{col.description}</span>
                </div>
                <span className={styles.columnCount}>{colLeads.length}</span>
              </div>
              
              <div className={styles.cards}>
                {colLeads.map(lead => {
                  const sla = getSLA(lead.createdAt, lead.status);
                  const isExpired = sla?.expired || false;
                  
                  return (
                    <div 
                      key={lead.id} 
                      className={`${styles.card} ${isExpired ? styles.cardExpired : ''}`}
                      draggable={lead.status !== 'LOST' && lead.status !== 'CONVERTED'}
                      onDragStart={(e) => handleDragStart(e, lead)}
                    >
                      <div className={styles.cardHeader}>
                        <span className={styles.leadName}>{lead.name}</span>
                        <span className={styles.leadSource}>{lead.source}</span>
                      </div>
                      
                      <div className={styles.leadPhone}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>📞 {lead.phone}</span>
                          {lead.callAttempts > 0 && (
                            <span className={styles.attempts}>Звонков: {lead.callAttempts}/3</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
                          <a href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', background: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)', color: 'white', padding: '4px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 'bold' }}>
                            WhatsApp
                          </a>
                          <a href={`https://t.me/+${lead.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', background: 'linear-gradient(135deg, #0088cc 0%, #005580 100%)', color: 'white', padding: '4px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 'bold' }}>
                            Telegram
                          </a>
                          <a href={`viber://add?number=${lead.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', background: 'linear-gradient(135deg, #7360F2 0%, #59449E 100%)', color: 'white', padding: '4px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 'bold' }}>
                            Viber
                          </a>
                        </div>
                      </div>
                      
                      {sla && (
                        <div className={styles.slaBar}>
                          <div className={`${styles.slaProgress} ${isExpired ? styles.slaExpired : ''}`} style={{ width: `${sla.percent}%` }} />
                          <span className={styles.slaText}>⏱ {sla.text}</span>
                        </div>
                      )}
                      
                      {lead.interestedProjectName && (
                        <div className={styles.qualifyBadge}>
                          🏢 {lead.interestedProjectName}
                          {lead.budgetMax && ` • до $${lead.budgetMax.toLocaleString()}`}
                        </div>
                      )}
                      
                      <div className={styles.cardFooter}>
                        {lead.status === 'NEW' ? (
                          <button className={styles.btnAction} onClick={() => onAssign(lead.id)}>📌 Взять в работу</button>
                        ) : lead.status === 'IN_QUALIFICATION' ? (
                          <button className={styles.btnAction} onClick={() => setShowQualifyModal(lead)}>📋 Заполнить анкету</button>
                        ) : lead.status === 'QUALIFIED' ? (
                          <button className={`${styles.btnAction} ${styles.btnSecondary}`} onClick={() => onChangeStatus(lead.id, 'IN_PROGRESS')}>🚀 Начать работу</button>
                        ) : lead.status === 'IN_PROGRESS' ? (
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {(lead.callAttempts || 0) < 3 && (
                              <button className={`${styles.btnAction} ${styles.btnSecondary}`} onClick={() => onCall(lead.id)}>📞 Позвонить ({lead.callAttempts || 0}/3)</button>
                            )}
                            <button className={styles.btnAction} onClick={() => handleOpenConvert(lead)}>✅ В сделку</button>
                            <button className={`${styles.btnAction} ${styles.btnSecondary}`} onClick={() => onChangeStatus(lead.id, 'LOST')}>❌ Отказ</button>
                          </div>
                        ) : lead.status === 'CONVERTED' ? (
                          <span className={styles.convertedBadge}>✅ Конвертирован в сделку</span>
                        ) : (
                          <span className={styles.lostBadge}>❌ {lead.lostReason || 'Закрыт без реализации'}</span>
                        )}
                      </div>

                      {/* КНОПКА ЗАПИСЬ НА ПРИЕМ - НОВЫЙ ЦВЕТ */}
                      {lead.status !== 'NEW' && lead.status !== 'LOST' && lead.status !== 'CONVERTED' && (
                        <button 
                          className={styles.btnAction} 
                          onClick={() => setShowScheduleModal(lead)}
                          style={{ 
                            marginTop: '10px', 
                            width: '100%',
                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                            borderColor: '#10b981'
                          }}
                        >
                          📅 Запись на прием
                        </button>
                      )}
                    </div>
                  );
                })}
                
                {colLeads.length === 0 && (
                  <div className={styles.emptyColumn}>
                    <span>📭</span>
                    <p>Нет лидов</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Модалки */}
      {showAddModal && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h2 style={{marginBottom: '1.5rem', fontWeight: 800}}>➕ Новый Лид</h2>
            {error && <div className={styles.errorBox}>{error}</div>}
            <div className={styles.formGroup}>
              <label>Имя клиента *</label>
              <input className={styles.input} value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Иван Иванов" />
            </div>
            <div className={styles.formGroup}>
              <label>Телефон *</label>
              <input className={styles.input} value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="+995 555 123 456" />
            </div>
            <div className={styles.formGroup}>
              <label>Источник</label>
              <select className={styles.input} value={formData.source} onChange={e => setFormData({...formData, source: e.target.value})}>
                <option value="WEBSITE">🌐 Сайт</option>
                <option value="INSTAGRAM">📸 Instagram</option>
                <option value="FACEBOOK">📘 Facebook</option>
                <option value="CALL">📞 Входящий звонок</option>
                <option value="WALKIN">🏢 Визит в офис</option>
                <option value="REFERRAL">🤝 Рекомендация</option>
              </select>
            </div>
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '2rem'}}>
              <button className={`${styles.btnAction} ${styles.btnSecondary}`} onClick={() => setShowAddModal(false)}>Отмена</button>
              <button className={styles.btnAction} onClick={handleCreate} disabled={loading || !formData.name || !formData.phone}>
                {loading ? 'Создание...' : 'Создать лида'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showQualifyModal && (
        <QualifyModal lead={showQualifyModal} onClose={() => setShowQualifyModal(null)} onQualify={onQualify} />
      )}
 
      {showLostModal && (
        <LostModal 
          leadId={showLostModal} 
          lostReason={lostReason} 
          setLostReason={setLostReason} 
          onConfirm={onConfirmLost} 
          onClose={() => setShowLostModal(null)} 
        />
      )}

      {showConvertModal && (
        <div className={styles.overlay}>
          <div className={styles.modal} style={{ maxWidth: '500px' }}>
            <h2>🤝 Конвертация лида в сделку</h2>
            <p style={{ color: '#64748b', margin: '8px 0 20px 0', fontSize: '0.9rem' }}>
              Создание сделки на основе интересов клиента <strong>{showConvertModal.name}</strong>.
            </p>
            
            {leadInterests.length > 0 ? (
              <div className={styles.formGroup}>
                <label>Выберите объект недвижимости (из интересов) *</label>
                <select className={styles.input} value={selectedInterestId} onChange={e => setSelectedInterestId(e.target.value)}>
                  {leadInterests.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.projectName} · №{i.unitNumber} (${Number(i.unitPrice).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', padding: '16px', borderRadius: '12px', color: '#b91c1c', marginBottom: '20px' }}>
                ⚠️ У лида нет выбранных интересов!
              </div>
            )}
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button className={`${styles.btnAction} ${styles.btnSecondary}`} onClick={() => setShowConvertModal(null)} disabled={loading}>Отмена</button>
              <button className={styles.btnAction} onClick={handleConfirmConvert} disabled={loading || leadInterests.length === 0} style={{ background: '#10b981' }}>
                {loading ? 'Секунду...' : 'Создать сделку'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка записи на прием */}
      {showScheduleModal && (
        <ScheduleModal 
          lead={showScheduleModal} 
          managerId={currentManagerId}
          onClose={() => setShowScheduleModal(null)} 
          onRefresh={refreshLeads}
        />
      )}
    </div>
  );
}