'use client';

import React, { useState, useEffect } from 'react';
import styles from './ClientManagement.module.css';
import WeekCalendar, { getLocalDateString } from '@/components/Leads/WeekCalendar';
import LeadModal from '@/components/Leads/LeadModal';
import LeadDossier from '@/components/Leads/LeadDossier';
import { useRouter } from 'next/navigation';
import {
  assignLeadToManager,
  assignLeadAutomatically,
  logCallAttempt,
  updateLeadStatus,
  qualifyLead,
  createDeal,
  getLeadInterests,
  bookScheduleSlot,
  cancelScheduleSlot,
  completeScheduleSlot,
  getLeadSchedule,
  getLeadById,
  createClient,
  getLeads
} from '@/app/actions/leads';
import { searchUnits, addInterest } from '@/app/actions/inventory';

import { canManageDeals, canViewAllDeals, isReadOnly, UserRole } from '@/lib/roles';

interface ClientManagementClientProps {
  initialLeads: any[];
  projects: any[];
  organizationId: string;
  userRole?: string;
  managerId?: string;
}

// Статусы лидов по ТЗ
const STATUSES = [
  { id: 'NEW', title: 'Новые лиды', description: 'Поступили, не разобраны', color: '#f59e0b' },
  { id: 'IN_QUALIFICATION', title: 'В квалификации', description: 'Офис-менеджер взял в работу', color: '#f97316' },
  { id: 'QUALIFIED', title: 'Квалифицирован', description: 'Передан менеджеру ОП', color: '#10b981' },
  { id: 'IN_PROGRESS', title: 'В работе', description: 'Менеджер ОП работает', color: '#3b82f6' },
  { id: 'CONVERTED', title: 'Конвертирован', description: 'Переведен в сделку', color: '#8b5cf6' },
  { id: 'LOST', title: 'Закрыт без реализации', description: 'Указана причина', color: '#6b7280' }
];

const LOST_REASONS = [
  'Не дозвонились (3 попытки)',
  'Явный отказ клиента',
  'Бюджет не совпал',
  'Купил у конкурента',
  'Передумал',
  'Не подходит локация',
  'Другое'
];

// Квалификационная анкета (Qualify)
function QualifyModal({ lead, projects, onClose, onQualify }: { 
  lead: any; 
  projects: any[];
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
        <h2 style={{ marginBottom: '10px' }}>Квалификация лида: {lead.name}</h2>
        <p style={{ color: '#64748b', marginBottom: '20px' }}>Заполните информацию о предпочтениях клиента</p>
        
        <div className={styles.formGroup}>
          <label>Жилой комплекс интереса</label>
          <select className={styles.input} value={form.interestedProjectId} onChange={e => setForm({...form, interestedProjectId: e.target.value})}>
            <option value="">Не выбран</option>
            {projects && projects.map((p: any) => (
              <option key={p.id} value={p.id}>{p.nameRu || p.name}</option>
            ))}
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
        
        {form.propertyType === 'Apartment' && (
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
        )}

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
          <input className={styles.input} placeholder="Как о нас узнал?" value={form.sourceInfo} onChange={e => setForm({...form, sourceInfo: e.target.value})} />
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <button className={styles.actionBtn} onClick={onClose}>Отмена</button>
          <button className={`${styles.actionBtn} ${styles.primaryActionBtn}`} onClick={() => onQualify(lead.id, form)}>Подтвердить</button>
        </div>
      </div>
    </div>
  );
}

// Причина отказа (Lost)
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
        <h2>Причина отказа</h2>
        <p style={{ color: '#64748b', margin: '8px 0 16px 0' }}>Укажите причину, по которой лид не был реализован:</p>
        
        <div className={styles.formGroup}>
          <select className={styles.input} value={lostReason} onChange={e => setLostReason(e.target.value)}>
            <option value="">Выберите причину...</option>
            {LOST_REASONS.map(reason => (
              <option key={reason} value={reason}>{reason}</option>
            ))}
          </select>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <button className={styles.actionBtn} onClick={onClose}>Отмена</button>
          <button className={`${styles.actionBtn} ${styles.dangerActionBtn}`} onClick={() => onConfirm(leadId)}>Подтвердить</button>
        </div>
      </div>
    </div>
  );
}

// Конвертация лида в сделку
function ConvertModal({ lead, onClose, onConvert, loading, onTriggerQualify, organizationId }: {
  lead: any;
  onClose: () => void;
  onConvert: (interestId: string, unitId: string) => void;
  loading: boolean;
  onTriggerQualify: () => void;
  organizationId: string;
}) {
  const [interests, setInterests] = useState<any[]>([]);
  const [selectedInterestId, setSelectedInterestId] = useState('');
  const [fetching, setFetching] = useState(false);
  const [freeUnits, setFreeUnits] = useState<any[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState('');

  useEffect(() => {
    setFetching(true);
    getLeadInterests(lead.id).then(res => {
      setInterests(res || []);
      if (res && res.length > 0) {
        setSelectedInterestId(res[0].id);
      }
      setFetching(false);
    });
  }, [lead]);

  useEffect(() => {
    if (!fetching && interests.length === 0 && lead.interestedProjectId) {
      setLoadingUnits(true);
      searchUnits({
        type: 'Apartment',
        organizationId
      }).then(res => {
        const filtered = res.filter((u: any) => 
          u.block?.project?.id === lead.interestedProjectId && 
          u.status === 'FREE'
        );
        setFreeUnits(filtered);
        if (filtered.length > 0) {
          setSelectedUnitId(filtered[0].id);
        }
        setLoadingUnits(false);
      });
    }
  }, [lead, interests, fetching, organizationId]);

  const hasInterests = interests.length > 0;
  const hasQuestionnaire = !!lead.interestedProjectId;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} style={{ maxWidth: '500px' }}>
        <h2>Конвертация лида в сделку</h2>
        <p style={{ color: '#64748b', margin: '8px 0 20px 0', fontSize: '0.9rem' }}>
          Создание сделки на основе интересов клиента <strong>{lead.name}</strong>.
        </p>
        
        {fetching ? (
          <div style={{ padding: '20px', textAlign: 'center' }}>Загрузка подборов...</div>
        ) : hasInterests ? (
          <div className={styles.formGroup}>
            <label>Выберите объект недвижимости (из интересов) *</label>
            <select className={styles.input} value={selectedInterestId} onChange={e => setSelectedInterestId(e.target.value)}>
              {interests.map(i => (
                <option key={i.id} value={i.id}>
                  {i.projectName} · №{i.unitNumber} (${Number(i.unitPrice).toLocaleString()})
                </option>
              ))}
            </select>
          </div>
        ) : !hasQuestionnaire ? (
          <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', padding: '16px', borderRadius: '12px', color: '#b45309', marginBottom: '20px' }}>
            <p style={{ margin: '0 0 12px 0', fontWeight: 600 }}>Анкета квалификации лида не заполнена!</p>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem' }}>Для перевода лида в статус «В сделку» необходимо сначала заполнить квалификационную анкету и указать ЖК интереса.</p>
            <button 
              className={`${styles.actionBtn} ${styles.primaryActionBtn}`} 
              style={{ width: '100%' }}
              onClick={onTriggerQualify}
            >
              Заполнить анкету квалификации
            </button>
          </div>
        ) : (
          <div style={{ background: '#eff6ff', border: '1px solid #dbeafe', padding: '16px', borderRadius: '12px', color: '#1e40af', marginBottom: '20px' }}>
            <p style={{ margin: '0 0 12px 0', fontWeight: 600 }}>У лида заполнен ЖК интереса, но не выбран конкретный объект.</p>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: '#1e3a8a' }}>Выберите свободную квартиру из ЖК <strong>«{lead.interestedProjectName || 'Выбранный ЖК'}»</strong>:</p>
            
            <div className={styles.formGroup}>
              {loadingUnits ? (
                <div style={{ fontSize: '0.9rem', color: '#64748b' }}>Поиск свободных квартир...</div>
              ) : freeUnits.length > 0 ? (
                <select className={styles.input} value={selectedUnitId} onChange={e => setSelectedUnitId(e.target.value)}>
                  {freeUnits.map(u => (
                    <option key={u.id} value={u.id}>
                      №{u.number} · {u.rooms} комн. · {u.area} м² (${Number(u.price).toLocaleString()})
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ color: '#b91c1c', fontSize: '0.85rem', fontWeight: 600 }}>
                  Нет свободных квартир в ЖК «{lead.interestedProjectName || 'Выбранный ЖК'}». Сначала добавьте свободные квартиры в шахматку этого ЖК.
                </div>
              )}
            </div>
          </div>
        )}
        
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <button className={styles.actionBtn} onClick={onClose} disabled={loading}>Отмена</button>
          <button 
            className={`${styles.actionBtn} ${styles.successActionBtn}`} 
            onClick={() => {
              if (hasInterests) {
                const selected = interests.find(i => i.id === selectedInterestId);
                if (selected) onConvert(selected.id, selected.unitId);
              } else {
                if (selectedUnitId) onConvert('', selectedUnitId);
              }
            }} 
            disabled={loading || (hasInterests ? interests.length === 0 : freeUnits.length === 0)}
          >
            {loading ? 'Секунду...' : 'Создать сделку'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Запись на прием (с Google-календарем слотов - компактный вид)
function ScheduleModal({ lead, managerId, onClose, onRefresh }: { 
  lead: any; 
  managerId: string; 
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleBook = async (dateStr: string, timeStr: string) => {
    const confirmBook = window.confirm(`Записать клиента ${lead.name} на прием ${dateStr} в ${timeStr}?`);
    if (!confirmBook) return;

    setLoading(true);
    const res = await bookScheduleSlot({
      leadId: lead.id,
      managerId,
      date: dateStr,
      time: timeStr
    });
    setLoading(false);

    if (res.success) {
      alert('Запись успешно добавлена!');
      onRefresh();
      onClose();
    } else {
      alert(res.message || 'Ошибка при записи');
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} style={{ maxWidth: '740px', width: '95%', borderRadius: '20px', padding: '0', overflow: 'hidden' }}>
        <div style={{ 
          background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', 
          padding: '16px 20px',
          color: 'white',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>Запись на прием: {lead.name}</h3>
            <p style={{ margin: '2px 0 0 0', opacity: 0.9, fontSize: '0.8rem' }}>Выберите свободное время из сетки Google Календаря</p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'white', fontSize: '1.4rem', cursor: 'pointer' }}>&times;</button>
        </div>

        <div style={{ padding: '16px' }}>
          <WeekCalendar managerId={managerId} onBookSlot={handleBook} />
        </div>
      </div>
    </div>
  );
}

// Просмотр приема в графике
function AppointmentDetailModal({ slot, onClose, onRefresh, readOnly = false }: {
  slot: any;
  onClose: () => void;
  onRefresh: () => void;
  readOnly?: boolean;
}) {
  const [loading, setLoading] = useState(false);

  const handleCancel = async () => {
    const reason = window.prompt('Укажите причину отмены приема:');
    if (reason === null) return;
    if (!reason.trim()) {
      alert('Причина отмены обязательна!');
      return;
    }

    setLoading(true);
    const res = await cancelScheduleSlot(slot.id, reason);
    setLoading(false);
    if (res.success) {
      alert('Запись отменена');
      onRefresh();
      onClose();
    } else {
      alert('Ошибка при отмене');
    }
  };

  const handleComplete = async () => {
    const confirmComp = window.confirm('Отметить встречу как выполненную?');
    if (!confirmComp) return;

    setLoading(true);
    const res = await completeScheduleSlot(slot.id);
    setLoading(false);
    if (res.success) {
      alert('Встреча состоялась!');
      onRefresh();
      onClose();
    } else {
      alert('Ошибка при выполнении');
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} style={{ maxWidth: '450px' }}>
        <h2>Детали приема</h2>
        <div style={{ margin: '16px 0', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
          <p style={{ margin: '6px 0' }}><strong>Клиент:</strong> {slot.leadName}</p>
          <p style={{ margin: '6px 0' }}><strong>Телефон:</strong> {slot.leadPhone}</p>
          <p style={{ margin: '6px 0' }}><strong>Дата:</strong> {new Date(slot.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p style={{ margin: '6px 0' }}><strong>Время:</strong> {slot.time.slice(0, 5)}</p>
          <p style={{ margin: '6px 0' }}>
            <strong>Статус: </strong>
            <span className={`${styles.statusBadge} ${styles[`status_${slot.status}`]}`}>
              {slot.status === 'BOOKED' ? 'Запланирован' : slot.status === 'COMPLETED' ? 'Состоялся' : 'Отменен'}
            </span>
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
          <button className={styles.actionBtn} onClick={onClose} disabled={loading}>Закрыть</button>
          
          {slot.status === 'BOOKED' && !readOnly && (
            <>
              <button className={`${styles.actionBtn} ${styles.dangerActionBtn}`} onClick={handleCancel} disabled={loading}>Отменить прием</button>
              <button className={`${styles.actionBtn} ${styles.successActionBtn}`} onClick={handleComplete} disabled={loading}>Проведен &check;</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ClientManagementClient({ initialLeads, projects, organizationId, userRole = 'manager', managerId = '' }: ClientManagementClientProps) {
  const role = userRole as UserRole;
  const canManage = canManageDeals(role);
  const canViewAllLeads = canViewAllDeals(role);
  const readOnly = isReadOnly(role);

  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'leads' | 'clients' | 'schedule'>('leads');
  const [leads, setLeads] = useState(initialLeads);
  
  // Фильтры лидов
  const [leadSearch, setLeadSearch] = useState('');
  const [leadSourceFilter, setLeadSourceFilter] = useState('');
  const [leadProjectFilter, setLeadProjectFilter] = useState('');
  const [draggedLead, setDraggedLead] = useState<any>(null);
  
  const [clientSearch, setClientSearch] = useState({ query: '', sources: [] as string[], dateFrom: '', dateTo: '' });
  const [clientSourceDropdownOpen, setClientSourceDropdownOpen] = useState(false);
  const CLIENT_SOURCE_OPTIONS = ['Instagram', 'Krisha.kz', 'Facebook', 'Website', 'Referral'];
  function toggleClientSourceFilter(value: string) {
    setClientSearch(prev => ({
      ...prev,
      sources: prev.sources.includes(value) ? prev.sources.filter(v => v !== value) : [...prev.sources, value],
    }));
  }

  // Модальные окна
  const [isClientModalOpen, setIsClientModalOpen] = useState(false); // Для добавления клиентов
  const [isAddLeadModalOpen, setIsAddLeadModalOpen] = useState(false); // Для добавления лидов (простая форма)
  const [selectedClient, setSelectedClient] = useState<any | null>(null); // Для открытия досье
  
  const [showQualifyModal, setShowQualifyModal] = useState<any>(null);
  const [showLostModal, setShowLostModal] = useState<any>(null);
  const [showConvertModal, setShowConvertModal] = useState<any>(null);
  const [showScheduleModal, setShowScheduleModal] = useState<any>(null);
  const [selectedAppSlot, setSelectedAppSlot] = useState<any>(null);

  const [lostReason, setLostReason] = useState('');
  const [leadFormData, setLeadFormData] = useState({ name: '', phone: '', source: 'WEBSITE' });
  const [leadError, setLeadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoAssign, setAutoAssign] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // КРИТИЧНО: раньше тут стоял organizationId вместо реального managerId (проп из JWT payload.sub) —
  // из-за этого "Взять в работу"/конвертация в сделку присваивали managerId = id организации,
  // а не id конкретного менеджера, и лид/сделка потом не находились ни у кого по фильтру managerId.
  const currentManagerId = managerId || organizationId;
  // Таймер для SLA
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const int = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(int);
  }, []);

  // Автооткрытие досье при возврате с Шахматки (openLeadId)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const openLeadId = params.get('openLeadId');
    if (openLeadId) {
      getLeadById(openLeadId).then(fullLead => {
        if (fullLead) {
          setSelectedClient(fullLead);
        }
      });
      // Очищаем query-параметр из URL
      const url = new URL(window.location.href);
      url.searchParams.delete('openLeadId');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, []);
  // ОБНОВЛЕННАЯ ФУНКЦИЯ REFRESH - теперь вызывает getLeads для получения полных объектов с интересами и логами
  const refreshLeads = async () => {
    const fresh = await getLeads(organizationId);
    setLeads(fresh || []);
    setRefreshTrigger(prev => prev + 1);
    router.refresh();
  };

  // Рассчет SLA
  const getSLA = (createdAt: string, status: string) => {
    if (status !== 'NEW') return null;
    const diffMin = Math.floor((now - new Date(createdAt).getTime()) / 60000);
    const left = 15 - diffMin;
    if (left > 0) return { expired: false, text: `${left} мин`, percent: (diffMin / 15) * 100 };
    return { expired: true, text: `Просрочено на ${Math.abs(left)} мин`, percent: 100 };
  };

  // Действия лидов
  const onAssign = async (id: string) => {
    await assignLeadToManager(id, currentManagerId);
    await refreshLeads();
  };

  const onCall = async (id: string) => {
    const res = await logCallAttempt(id);
    if (res.attempts >= 3) {
      alert('Выполнено 3 попытки звонка. Лид переведен в LOST.');
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

  const onConvert = async (interestId: string, unitId: string) => {
    if (!showConvertModal) return;
    setLoading(true);
    let finalInterestId = interestId;

    if (!finalInterestId) {
      const resInterest = await addInterest(showConvertModal.id, unitId);
      if (resInterest.success && resInterest.interestId) {
        finalInterestId = resInterest.interestId;
      } else {
        setLoading(false);
        alert('Ошибка при добавлении интереса: ' + (resInterest.error || 'Неизвестная ошибка'));
        return;
      }
    }

    const res = await createDeal({
      leadId: showConvertModal.id,
      unitId,
      interestId: finalInterestId,
      organizationId,
      // Сделка должна принадлежать менеджеру-владельцу лида, а не тому, кто нажал "В сделку"
      // (например, старший менеджер/РОП может конвертировать чужой лид — сделка всё равно закрепляется за его менеджером)
      managerId: showConvertModal.managerId || currentManagerId
    });
    setLoading(false);

    if (res.success) {
      await updateLeadStatus(showConvertModal.id, 'CONVERTED');
      alert('Лид успешно конвертирован в сделку!');
      setShowConvertModal(null);
      await refreshLeads();
    } else {
      alert('Ошибка при конвертации: ' + (res.message || 'Проверьте данные.'));
    }
  };

  // Простая форма добавления лида
  const handleCreateLead = async () => {
    setLeadError(null);
    setLoading(true);
    const res = await createClient({ ...leadFormData, organizationId, type: 'LEAD' });
    if (!res.success) {
      if (res.error === 'DUPLICATE') {
        setLeadError(` Обнаружен дубликат! Лид с таким номером уже существует.`);
      } else {
        setLeadError('Произошла ошибка при создании лида');
      }
    } else {
      setIsAddLeadModalOpen(false);
      setLeadFormData({ name: '', phone: '', source: 'WEBSITE' });
      if (autoAssign && res.client) {
        await assignLeadAutomatically(res.client.id, organizationId);
      }
      await refreshLeads();
    }
    setLoading(false);
  };

  // Жесткая фильтрация лидов (исключая CONVERTED)
  // Менеджер видит только свои лиды + ещё не назначенные (managerId пуст) — чтобы можно было взять в работу.
  // Юрист/РОП/старший менеджер/админ видят все лиды.
  const activeLeads = leads.filter(l => 
    (l.type === 'LEAD' || !l.type) && l.status !== 'CONVERTED' &&
    (canViewAllLeads || l.managerId === managerId || !l.managerId)
  );

  const getFilteredLeads = (status: string) => {
    return activeLeads.filter(lead => {
      if (lead.status !== status) return false;
      const matchQuery = lead.name.toLowerCase().includes(leadSearch.toLowerCase()) || 
                         lead.phone.includes(leadSearch);
      const matchSource = leadSourceFilter ? lead.source === leadSourceFilter : true;
      const matchProject = leadProjectFilter ? lead.interestedProjectId === leadProjectFilter : true;
      return matchQuery && matchSource && matchProject;
    });
  };

  // Drag and Drop для лидов
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
      if (targetStatus === 'LOST') {
        setShowLostModal(draggedLead.id);
      } else if (targetStatus === 'CONVERTED') {
        setShowConvertModal(draggedLead);
      } else {
        await updateLeadStatus(draggedLead.id, targetStatus);
        await refreshLeads();
      }
    }
    setDraggedLead(null);
  };

  // Жесткая фильтрация клиентов
  const activeClients = leads.filter(l => 
    (l.type && l.type !== 'LEAD') || l.status === 'CONVERTED'
  );

  const filteredClients = activeClients.filter(client => {
    const matchQuery = client.name.toLowerCase().includes(clientSearch.query.toLowerCase()) || 
                       client.phone.includes(clientSearch.query);
    const matchSource = clientSearch.sources.length > 0 ? clientSearch.sources.includes(client.source) : true;
    const clientDate = new Date(client.createdAt);
    const matchDateFrom = clientSearch.dateFrom ? clientDate >= new Date(clientSearch.dateFrom) : true;
    const matchDateTo = clientSearch.dateTo ? clientDate <= new Date(new Date(clientSearch.dateTo).getTime() + 24 * 60 * 60 * 1000 - 1) : true;
    return matchQuery && matchSource && matchDateFrom && matchDateTo;
  });

  return (
    <div className={styles.container}>
      {/* Шапка */}
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <h1>Управление клиентами</h1>
          <p>База лидов, клиентов и сетка графика приемов</p>
        </div>
        
        {activeTab === 'leads' && canManage && !readOnly && (
          <button className={styles.addBtn} onClick={() => setIsAddLeadModalOpen(true)}>
            Добавить лида
          </button>
        )}
        {activeTab === 'clients' && canManage && !readOnly && (
          <button className={styles.addBtn} onClick={() => setIsClientModalOpen(true)}>
            Добавить клиента
          </button>
        )}
      </header>

      {/* Вкладки */}
      <div className={styles.tabsContainer}>
        <button 
          className={`${styles.tabButton} ${activeTab === 'leads' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('leads')}
        >
          База лидов ({activeLeads.length})
        </button>
        <button 
          className={`${styles.tabButton} ${activeTab === 'clients' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('clients')}
        >
          База клиентов ({activeClients.length})
        </button>
        <button 
          className={`${styles.tabButton} ${activeTab === 'schedule' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('schedule')}
        >
          График приема (Неделя)
        </button>
      </div>

      {/* Вкладка 1: ЛИДЫ (Список карточек с кнопками) */}
      {activeTab === 'leads' && (
        <>
          {/* Поиск для лидов */}
          <div className={styles.toolbar} style={{ marginBottom: '16px' }}>
            <div className={styles.searchWrapper}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Поиск лида по имени или телефону..."
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <select 
                className={styles.selectInput}
                value={leadSourceFilter}
                onChange={e => setLeadSourceFilter(e.target.value)}
              >
                <option value="">Все источники</option>
                <option value="WEBSITE">Сайт</option>
                <option value="INSTAGRAM">Instagram</option>
                <option value="FACEBOOK">Facebook</option>
                <option value="CALL">Входящий звонок</option>
                <option value="WALKIN">Визит в офис</option>
                <option value="REFERRAL">Рекомендация</option>
              </select>
              <select 
                className={styles.selectInput}
                value={leadProjectFilter}
                onChange={e => setLeadProjectFilter(e.target.value)}
              >
                <option value="">Все ЖК интереса</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.nameRu || p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Канбан-доска лидов (Leads Kanban Board) */}
          <div className={styles.board}>
            {STATUSES.map(col => {
              const colLeads = getFilteredLeads(col.id);
              return (
                <div 
                  key={col.id} 
                  className={styles.column} 
                  style={{ borderTop: `4px solid ${col.color}` }}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, col.id)}
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
                          onClick={async () => {
                            const full = await getLeadById(lead.id);
                            setSelectedClient(full || lead);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <div>
                            {/* Заголовок карточки */}
                            <div className={styles.cardHeader}>
                              <span className={styles.leadNameText}>{lead.name}</span>
                              <span className={styles.leadSourceLabel}>{lead.source}</span>
                            </div>

                            {/* Телефон и мессенджеры */}
                            <div className={styles.leadPhoneBlock}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>Тел: {lead.phone}</span>
                                <a
                                  href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Открыть WhatsApp"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', borderRadius: '50%', background: '#25D366', flexShrink: 0 }}
                                >
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="white">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                                    <path d="M12.001 2C6.478 2 2 6.478 2 12c0 1.822.487 3.53 1.338 5.003L2 22l5.144-1.34A9.94 9.94 0 0012 22c5.523 0 10-4.478 10-10S17.523 2 12.001 2zm0 18.2a8.17 8.17 0 01-4.267-1.19l-.306-.182-3.058.797.817-2.981-.199-.307A8.17 8.17 0 013.8 12c0-4.526 3.674-8.2 8.2-8.2 4.526 0 8.2 3.674 8.2 8.2 0 4.526-3.674 8.2-8.199 8.2z" />
                                  </svg>
                                </a>
                              </div>
                            </div>

                            {/* SLA Таймер */}
                            {sla && (
                              <div className={styles.slaBar}>
                                <div className={`${styles.slaProgress} ${isExpired ? styles.slaExpired : ''}`} style={{ width: `${sla.percent}%` }} />
                                <span className={styles.slaText}>SLA: {sla.text}</span>
                              </div>
                            )}

                            {/* ЖК интереса */}
                            {lead.interestedProjectName && (
                              <div className={styles.qualifyBadge}>
                                ЖК: {lead.interestedProjectName} {lead.budgetMax && ` • до $${lead.budgetMax.toLocaleString()}`}
                              </div>
                            )}
                          </div>

                          {/* Кнопки действий */}
                          <div className={styles.cardFooter}>
                            {canManage && !readOnly && (
                              <div className={styles.cardActionsRow}>
                                {lead.status === 'NEW' ? (
                                  <button 
                                    className={`${styles.cardBtn} ${styles.primaryActionBtn}`} 
                                    style={{ width: '100%' }} 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onAssign(lead.id);
                                    }}
                                  >
                                    Взять в работу
                                  </button>
                                ) : lead.status === 'IN_QUALIFICATION' ? (
                                  <button
                                    className={`${styles.cardBtn} ${styles.primaryActionBtn}`}
                                    style={{ width: '100%' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowQualifyModal(lead);
                                    }}
                                  >
                                    Заполнить анкету
                                  </button>
                                ) : lead.status === 'QUALIFIED' ? (
                                  <button 
                                    className={`${styles.cardBtn} ${styles.primaryActionBtn}`} 
                                    style={{ width: '100%' }} 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onChangeStatus(lead.id, 'IN_PROGRESS');
                                    }}
                                  >
                                    Начать работу
                                  </button>
                                ) : lead.status === 'IN_PROGRESS' ? (
                                  <>
                                    {(lead.callAttempts || 0) < 3 && (
                                      <button
                                        className={`${styles.cardBtn} ${styles.cardBtnSecondary}`}
                                        style={{ flex: '1 1 100%' }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onCall(lead.id);
                                        }}
                                      >
                                        Звонок ({(lead.callAttempts || 0)}/3)
                                      </button>
                                    )}
                                    <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: '4px' }}>
                                      <button
                                        className={`${styles.cardBtn} ${styles.successActionBtn}`}
                                        style={{ flex: 1 }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setShowConvertModal(lead);
                                        }}
                                      >
                                        В сделку
                                      </button>
                                      <button
                                        className={`${styles.cardBtn} ${styles.cardBtnSecondary}`}
                                        style={{ flex: 1 }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onChangeStatus(lead.id, 'LOST');
                                        }}
                                      >
                                        Отказ
                                      </button>
                                    </div>
                                  </>
                                ) : lead.status === 'LOST' ? (
                                  <span className={styles.lostBadge}>Отказ: {lead.lostReason || 'Отказ клиента'}</span>
                                ) : (
                                  <span className={styles.convertedBadge}>Конвертирован</span>
                                )}
                              </div>
                            )}
                            {readOnly && (lead.status === 'LOST' || lead.status === 'CONVERTED') && (
                              <div className={styles.cardActionsRow}>
                                {lead.status === 'LOST' ? (
                                  <span className={styles.lostBadge}>Отказ: {lead.lostReason || 'Отказ клиента'}</span>
                                ) : (
                                  <span className={styles.convertedBadge}>Конвертирован</span>
                                )}
                              </div>
                            )}

                            {/* Запись на прием — только в статусе "В работе" */}
                            {lead.status === 'IN_PROGRESS' && canManage && !readOnly && (
                              <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: '8px' }}>
                                <button 
                                  className={styles.cardBtnSchedule} 
                                  style={{ flex: 1 }} 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowScheduleModal(lead);
                                  }}
                                >
                                  Запись на прием
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {colLeads.length === 0 && (
                      <div className={styles.emptyColumn}>
                        <p>В этом статусе нет лидов</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Вкладка 2: КЛИЕНТЫ (Полноценная база с досье и паспортами) */}
      {activeTab === 'clients' && (
        <>
          {/* Фильтры клиентов */}
          <div className={styles.toolbar}>
            <div className={styles.searchWrapper}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Поиск клиента по имени или телефону..."
                value={clientSearch.query}
                onChange={(e) => setClientSearch({...clientSearch, query: e.target.value})}
              />
            </div>
            
            <div className={styles.filterGroup}>
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className={styles.selectInput}
                  onClick={() => setClientSourceDropdownOpen(o => !o)}
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                >
                  {clientSearch.sources.length > 0 ? `Источники (${clientSearch.sources.length})` : 'Все источники'}
                </button>
                {clientSourceDropdownOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setClientSourceDropdownOpen(false)} />
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 11,
                      background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.1)', padding: '8px', minWidth: '180px',
                    }}>
                      {CLIENT_SOURCE_OPTIONS.map(opt => (
                        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', fontSize: '0.85rem', fontWeight: 600, color: '#1e293b', cursor: 'pointer', borderRadius: '6px' }}>
                          <input type="checkbox" checked={clientSearch.sources.includes(opt)} onChange={() => toggleClientSourceFilter(opt)} />
                          {opt === 'Website' ? 'Сайт' : opt === 'Referral' ? 'Рекомендация' : opt}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Дата создания:</span>
                <input
                  type="date"
                  className={styles.dateInput}
                  title="От"
                  value={clientSearch.dateFrom}
                  onChange={(e) => setClientSearch({...clientSearch, dateFrom: e.target.value})}
                />
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}></span>
                <input
                  type="date"
                  className={styles.dateInput}
                  title="До"
                  value={clientSearch.dateTo}
                  onChange={(e) => setClientSearch({...clientSearch, dateTo: e.target.value})}
                />
              </div>
            </div>
          </div>

          {/* Таблица клиентов */}
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th>ИИН</th>
                  <th>Источник</th>
                  <th>Дата создания</th>
                  <th>Интересы</th>
                  <th style={{ textAlign: 'right' }}>Действие</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((client) => (
                  <tr key={client.id}>
                    <td onClick={async () => {
                      const full = await getLeadById(client.id);
                      setSelectedClient(full || client);
                    }} style={{ cursor: 'pointer' }}>
                      <span className={styles.clientName}>{client.name}</span>
                      <span className={styles.clientPhone}>{client.phone}</span>
                    </td>
                    <td className={styles.dateCell}>{client.iin || '—'}</td>
                    <td>
                      <span className={styles.sourceBadge}>{client.source || 'Не указан'}</span>
                    </td>
                    <td className={styles.dateCell}>
                      {new Date(client.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      {client.interests?.length > 0 ? (
                        <span className={styles.interestCount}>{client.interests.length} объекта</span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>Нет подборов</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className={styles.actionBtn} onClick={async () => {
                        const full = await getLeadById(client.id);
                        setSelectedClient(full || client);
                      }}>Открыть досье</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredClients.length === 0 && (
              <div style={{ textAlign: 'center', padding: '80px', color: '#64748b' }}>
                <h3>Клиенты не найдены</h3>
              </div>
            )}
          </div>
        </>
      )}

      {/* Вкладка 3: ГРАФИК ПРИЕМА (Google Calendar Неделя) */}
      {activeTab === 'schedule' && (
        <WeekCalendar 
          managerId={currentManagerId}
          onSelectSlot={(slot) => setSelectedAppSlot(slot)}
          refreshTrigger={refreshTrigger}
        />
      )}

      {/* ========================================================
          МОДАЛЬНЫЕ ОКНА
          ======================================================== */}
      
      {/* 1. Форма добавления лида (простая: ФИО, тел, источник) */}
      {isAddLeadModalOpen && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h2 style={{ marginBottom: '1.5rem', fontWeight: 800 }}>Новый Лид</h2>
            {leadError && <div className={styles.errorBox}>{leadError}</div>}
            
            <div className={styles.formGroup}>
              <label>Имя клиента *</label>
              <input className={styles.input} value={leadFormData.name} onChange={e => setLeadFormData({...leadFormData, name: e.target.value})} placeholder="Иван Иванов" />
            </div>
            
            <div className={styles.formGroup}>
              <label>Телефон *</label>
              <input className={styles.input} value={leadFormData.phone} onChange={e => setLeadFormData({...leadFormData, phone: e.target.value})} placeholder="+995 555 123 456" />
            </div>
            
            <div className={styles.formGroup}>
              <label>Источник</label>
              <select className={styles.input} value={leadFormData.source} onChange={e => setLeadFormData({...leadFormData, source: e.target.value})}>
                <option value="WEBSITE">Сайт</option>
                <option value="INSTAGRAM">Instagram</option>
                <option value="FACEBOOK">Facebook</option>
                <option value="CALL">Входящий звонок</option>
                <option value="WALKIN">Визит в офис</option>
                <option value="REFERRAL">Рекомендация</option>
              </select>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '2rem' }}>
              <button className={styles.actionBtn} onClick={() => setIsAddLeadModalOpen(false)}>Отмена</button>
              <button className={`${styles.actionBtn} ${styles.primaryActionBtn}`} onClick={handleCreateLead} disabled={loading || !leadFormData.name || !leadFormData.phone}>
                {loading ? 'Создание...' : 'Создать лида'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Расширенная форма добавления клиента */}
      {isClientModalOpen && (
        <LeadModal
          onClose={() => setIsClientModalOpen(false)}
          organizationId={organizationId}
          onSuccess={() => refreshLeads()}
          onSelectExisting={async (id) => {
            setIsClientModalOpen(false); 
            const fullLead = await getLeadById(id.toString());
            if (fullLead) {
              setSelectedClient(fullLead);
            }
          }}
        />
      )}

      {/* 3. Досье клиента */}
      {selectedClient && (
        <LeadDossier
          lead={selectedClient}
          projects={projects}
          onClose={() => setSelectedClient(null)}
          organizationId={organizationId}
          userRole={userRole}
          managerId={currentManagerId}
        />
      )}

      {/* 4. Квалификация лида */}
      {showQualifyModal && (
        <QualifyModal 
          lead={showQualifyModal} 
          projects={projects}
          onClose={() => setShowQualifyModal(null)} 
          onQualify={onQualify} 
        />
      )}

      {/* 5. Отказ лида */}
      {showLostModal && (
        <LostModal 
          leadId={showLostModal} 
          lostReason={lostReason} 
          setLostReason={setLostReason} 
          onConfirm={onConfirmLost} 
          onClose={() => setShowLostModal(null)} 
        />
      )}

      {/* 6. Конвертация лида */}
      {showConvertModal && (
        <ConvertModal 
          lead={showConvertModal} 
          onClose={() => setShowConvertModal(null)} 
          onConvert={onConvert}
          loading={loading}
          onTriggerQualify={() => {
            setShowConvertModal(null);
            setShowQualifyModal(showConvertModal);
          }}
          organizationId={organizationId}
        />
      )}

      {/* 7. Запись лида на прием */}
      {showScheduleModal && (
        <ScheduleModal 
          lead={showScheduleModal} 
          managerId={currentManagerId}
          onClose={() => setShowScheduleModal(null)} 
          onRefresh={refreshLeads}
        />
      )}

      {/* 8. Детали приема из графика */}
      {selectedAppSlot && (
        <AppointmentDetailModal 
          slot={selectedAppSlot} 
          onClose={() => setSelectedAppSlot(null)} 
          onRefresh={refreshLeads}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}