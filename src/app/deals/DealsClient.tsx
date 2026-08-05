'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './Deals.module.css';
import { updateDealStatus, updateDealMortgage,
  getDealClients,
  addDealClient,
  removeDealClient,
  setPrimaryClient,
  getDealUnits,
  addDealUnit,
  removeDealUnit,
  searchLeads,
  searchUnits,
  getDealHistory } from '@/app/actions/deals';
import { logCallAttempt, createClient } from '@/app/actions/leads';
import { getDealGifts, addDealGift, removeDealGift, getAvailableGiftUnits } from '@/app/actions/gifts';
import { getPendingDiscountRequest, approveDiscountRequest, rejectDiscountRequest } from '@/app/actions/discountApprovals';
import LeadModal from '@/components/Leads/LeadModal';
import { useRouter } from 'next/navigation';

type StageType = 'normal' | 'group' | 'child';

// Строго 17 этапов в соответствии с Process flow.xlsx
const STAGES: { id: string; label: string; color: string; type: StageType; children?: string[] }[] = [
  { id: 'NEW_LEAD', label: 'Новый лид', color: '#6366f1', type: 'normal' },
  { id: 'CLARIFICATION', label: 'Обработанный лид', color: '#818cf8', type: 'normal' },

  // Колл-центр — три отдельные горизонтальные колонки
  { id: 'CALL', label: 'Коллцентр 1', color: '#3b82f6', type: 'normal' },
  { id: 'SECOND_CALL', label: 'Коллцентр 2', color: '#2563eb', type: 'normal' },
  { id: 'THIRD_CALL', label: 'Обработанный Звонок', color: '#1d4ed8', type: 'normal' },

  { id: 'PRE_RESERVATION', label: '1-й звонок', color: '#fbbf24', type: 'normal' },
  { id: 'RESERVATION', label: '2-й звонок', color: '#f97316', type: 'normal' },
  { id: 'CONTRACT_PREPARATION', label: '3-й звонок', color: '#a855f7', type: 'normal' },
  { id: 'CONSULTATION', label: 'Распределён', color: '#f59e0b', type: 'normal' },
  { id: 'MEETING', label: 'Встреча назначена', color: '#8b5cf6', type: 'normal' },
  { id: 'CLIENT_CONFIRMATION', label: 'Встреча проведена', color: '#059669', type: 'normal' },
  { id: 'CONTRACT', label: 'Запрошено бронирование', color: '#0d9488', type: 'normal' },
  { id: 'PAYMENT_CONFIRMED', label: 'Бронирование подтверждено', color: '#10b981', type: 'normal' },
  { id: 'DEAL', label: 'Договор', color: '#0ea5e9', type: 'normal' },
  { id: 'WAITING_PAYMENT', label: 'Ожидание оплаты', color: '#ec4899', type: 'normal' },

  { id: 'SUCCESS', label: 'WON/Продано', color: '#15803d', type: 'normal' },
  // FAILED и CANCELLED объединены в одну колонку "Cancelled"
  { id: 'LOST_CANCELLED', label: 'Cancelled', color: '#94a3b8', type: 'group', children: ['FAILED', 'CANCELLED'] },
];

// Порядковые номера статусов для проверки направления
const STATUS_ORDER: Record<string, number> = {
  NEW_LEAD: 0,
  CLARIFICATION: 1,
  CALL: 2,
  SECOND_CALL: 3,
  THIRD_CALL: 4,
  PRE_RESERVATION: 5,
  RESERVATION: 6,
  CONTRACT_PREPARATION: 7,
  CONSULTATION: 8,
  MEETING: 9,
  CLIENT_CONFIRMATION: 10,
  CONTRACT: 11,
  PAYMENT_CONFIRMED: 12,
  DEAL: 13,
  WAITING_PAYMENT: 14,
  SUCCESS: 15,
  FAILED: 16,
  CANCELLED: 17
};

// Человекочитаемые названия статусов для Хронологии (DEA-029) — берём из STAGES,
// сгруппированные FAILED/CANCELLED получают подпись своей группы ("Cancelled").
const DEAL_STATUS_LABELS: Record<string, string> = {};
STAGES.forEach(s => {
  if (s.children) {
    s.children.forEach(c => { DEAL_STATUS_LABELS[c] = s.label; });
  } else {
    DEAL_STATUS_LABELS[s.id] = s.label;
  }
});

const STAGE_DESCRIPTIONS: Record<string, string> = {
  NEW_LEAD: 'Автоматически создаются из маркетинга: мессенджеры и Instagram.',
  CLARIFICATION: 'Обработка лидов из мессенджеров и Instagram.',
  CALL: 'Автоматически создаются из входящих звонков в колл-центр, а также из WhatsApp-звонков и сообщений.',
  SECOND_CALL: 'Номера, которые не ответили.',
  THIRD_CALL: 'Обработка номеров – квалифицирован ли клиент.',
  CONSULTATION: 'Квалифицированные лиды из маркетинга и колл-центра. С этого этапа ответственность переходит к менеджерам по продажам.',
  PRE_RESERVATION: 'Первый звонок менеджера.',
  RESERVATION: 'Второй звонок (обязательный повторный контакт).',
  CONTRACT_PREPARATION: 'Третий звонок (при необходимости).',
  MEETING: 'Назначены встречи. Менеджер отмечает точные дату и время, получает уведомление о предстоящей встрече.',
  CLIENT_CONFIRMATION: 'Встреча проведена. Менеджер вносит комментарии о потребностях клиента.',
  CONTRACT: 'Запрошено бронирование. Два типа: стандартное (на 2 дня, автоматически переходит в подтверждённое) и нестандартное (на конкретную дату по запросу клиента, требует утверждения РОП).',
  PAYMENT_CONFIRMED: 'Подтверждённые бронирования. Стандартные переходят автоматически, нестандартные – после утверждения РОП. В каталоге квартира меняет статус на «зарезервировано» (жёлтый цвет).',
  DEAL: 'Договор подписан. На этом этапе менеджер может сгенерировать все документы по клиенту. После утверждения документов РОП сделка переходит в «Ожидание оплаты».',
  WAITING_PAYMENT: 'Запрос на оплату направляется главному бухгалтеру. После подтверждения сделка автоматически переходит в WON.',
  SUCCESS: 'Квартира продана.',
  FAILED: 'Потерянные сделки, перенесённые с разных этапов с указанием причины и комментария.',
  CANCELLED: 'Потерянные сделки, перенесённые с разных этапов с указанием причины и комментария.',
  LOST_CANCELLED: 'Потерянные сделки, перенесённые с разных этапов с указанием причины и комментария.', // для группы
};

// Финальные статусы — из них нельзя двигаться никуда
const FINAL_STATUSES = ['SUCCESS', 'FAILED', 'CANCELLED', 'LOST_CANCELLED'];

// Статусы свободной зоны (до и включая звонки)
const FREE_ZONE = ['NEW_LEAD', 'CLARIFICATION', 'CALL', 'SECOND_CALL', 'THIRD_CALL'];

// Статусы строгой зоны (после Soft брони включительно)
const STRICT_ZONE = ['PRE_RESERVATION', 'RESERVATION', 'MEETING', 'CONTRACT_PREPARATION', 'CONTRACT', 'CLIENT_CONFIRMATION', 'WAITING_PAYMENT'];

function isTransitionAllowed(from: string, to: string): { allowed: boolean; reason?: string } {
  // Из SUCCESS (закрытая сделка) разрешено переносить ТОЛЬКО в CANCELLED (Расторжение)
  if (from === 'SUCCESS') {
    if (to === 'CANCELLED') {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Закрытую сделку можно переместить только в "Расторжение" (Cancelled)' };
  }

  // Из остальных финальных статусов — никуда
  if (FINAL_STATUSES.includes(from)) {
    return { allowed: false, reason: `Сделка в финальном статусе "${from}" — движение заблокировано` };
  }

  // В Won — нельзя вручную, только автоматически
  if (to === 'SUCCESS') {
    return { allowed: false, reason: 'Статус Won присваивается автоматически после регистрации в NAPR' };
  }

  // В Lost и Cancelled — можно из любого статуса
  if (to === 'FAILED' || to === 'CANCELLED' || to === 'LOST_CANCELLED') {
    return { allowed: true };
  }

  // Внутри звонков — только вперёд
  const callOrder: Record<string, number> = { CALL: 0, SECOND_CALL: 1, THIRD_CALL: 2 };
  if (from in callOrder && to in callOrder) {
    if (callOrder[to] !== callOrder[from] + 1) {
      return { allowed: false, reason: 'Звонки идут строго по порядку: 1-й → 2-й → 3-й, перепрыгнуть нельзя' };
    }
    return { allowed: true };
  }

  // Из звонков (1-й и 2-й) можно на Личную консультацию
  if ((from === 'CALL' || from === 'SECOND_CALL') && to === 'CONSULTATION') {
    return { allowed: true };
  }

  // Из свободной зоны — на Личную консультацию и дальше (вперёд)
  if (FREE_ZONE.includes(from)) {
    const fromOrder = STATUS_ORDER[from] ?? 0;
    const toOrder = STATUS_ORDER[to] ?? 0;
    if (toOrder >= fromOrder) return { allowed: true };
    // Назад в свободной зоне — разрешено
    if (FREE_ZONE.includes(to)) return { allowed: true };
    return { allowed: false, reason: 'Нельзя вернуться назад из свободной зоны в более ранний статус' };
  }

  // Из строгой зоны — на Личную консультацию разрешено (с сохранением предыдущего статуса)
  if (STRICT_ZONE.includes(from) && to === 'CONSULTATION') {
    return { allowed: true };
  }

  // В строгой зоне — только вперёд
  if (STRICT_ZONE.includes(from) && STRICT_ZONE.includes(to)) {
    const fromOrder = STATUS_ORDER[from] ?? 0;
    const toOrder = STATUS_ORDER[to] ?? 0;
    if (toOrder > fromOrder) return { allowed: true };
    return { allowed: false, reason: 'После Soft-брони сделки можно двигать только вперёд' };
  }

  // Всё остальное — вперёд разрешено
  const fromOrder = STATUS_ORDER[from] ?? 0;
  const toOrder = STATUS_ORDER[to] ?? 0;
  if (toOrder >= fromOrder) return { allowed: true };

  return { allowed: false, reason: 'Этот переход не разрешён' };
}

import { canManageDeals, canViewAllDeals, isReadOnly, canApprovePromotions, UserRole } from '@/lib/roles';

interface DealsClientProps {
  initialDeals: any[];
  organizationId: string;
  userRole?: string;
  managerId?: string;
}

export default function DealsClient({ initialDeals, organizationId, userRole = 'manager', managerId = '' }: DealsClientProps) {
  const role = userRole as UserRole;
  const canManage = canManageDeals(role);
  const canApprove = canApprovePromotions(role);
  const canViewAll = canViewAllDeals(role);
  const readOnly = isReadOnly(role);

  // Менеджер видит только свои сделки (плюс ещё не назначенные — managerId пуст)
  const filteredInitialDeals = canViewAll
    ? initialDeals
    : initialDeals.filter(d => d.managerId === managerId || !d.managerId);

  const router = useRouter();
  const [deals, setDeals] = useState(filteredInitialDeals);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ LOST_CANCELLED: false });
  const [draggingDealStatus, setDraggingDealStatus] = useState<string | null>(null);
  const [undoActions, setUndoActions] = useState<{
    id: string;
    dealId: string;
    dealName: string;
    fromStatus: string;
    toStatus: string;
    fromPreviousStatus?: string;
    secondsLeft: number;
  }[]>([]);
  const undoTimersRef = useRef<Record<string, { timer: NodeJS.Timeout; interval: NodeJS.Timeout }>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollAnimRef = useRef<number | null>(null);

  const startAutoScroll = (clientX: number) => {
    if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);

    const container = scrollContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const edgeSize = 120; // зона у края в пикселях
    const maxSpeed = 18;  // макс скорость прокрутки

    const step = () => {
      const distFromLeft = clientX - rect.left;
      const distFromRight = rect.right - clientX;

      let speed = 0;
      if (distFromLeft < edgeSize) {
        speed = -((edgeSize - distFromLeft) / edgeSize) * maxSpeed;
      } else if (distFromRight < edgeSize) {
        speed = ((edgeSize - distFromRight) / edgeSize) * maxSpeed;
      }

      if (speed !== 0) {
        container.scrollLeft += speed;
      }

      scrollAnimRef.current = requestAnimationFrame(step);
    };

    scrollAnimRef.current = requestAnimationFrame(step);
  };

  const stopAutoScroll = () => {
    if (scrollAnimRef.current) {
      cancelAnimationFrame(scrollAnimRef.current);
      scrollAnimRef.current = null;
    }
  };

  const clearUndoTimer = (toastId: string) => {
    const t = undoTimersRef.current[toastId];
    if (t) {
      clearTimeout(t.timer);
      clearInterval(t.interval);
      delete undoTimersRef.current[toastId];
    }
  };

  const startUndoTimer = (dealId: string, dealName: string, fromStatus: string, toStatus: string, fromPreviousStatus?: string) => {
    const toastId = `undo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Добавляем новый тост сразу — без задержки
    setUndoActions(prev => [{
      id: toastId, dealId, dealName, fromStatus, toStatus, fromPreviousStatus, secondsLeft: 10
    }, ...prev]);

    const interval = setInterval(() => {
      setUndoActions(prev => prev
        .map(t => t.id === toastId ? { ...t, secondsLeft: t.secondsLeft - 1 } : t)
        .filter(t => t.secondsLeft > 0)
      );
    }, 1000);

    const timer = setTimeout(() => {
      setUndoActions(prev => prev.filter(t => t.id !== toastId));
      clearUndoTimer(toastId);
    }, 10000);

    undoTimersRef.current[toastId] = { timer, interval };
  };

  const handleUndo = async (toastId: string) => {
    const action = undoActions.find(t => t.id === toastId);
    if (!action) return;
    clearUndoTimer(toastId);
    setUndoActions(prev => prev.filter(t => t.id !== toastId));

    // Откатываем визуально
    setDeals((prev: any[]) =>
      prev.map((d: any) => d.id === action.dealId ? {
        ...d,
        status: action.fromStatus,
        previousStatus: action.fromPreviousStatus || null,
      } : d)
    );

    // Откатываем в БД и после этого делаем refresh
    await updateDealStatus(action.dealId, action.fromStatus, action.fromPreviousStatus, true);
    router.refresh();
  };

  const [selectedDeal, setSelectedDeal] = useState<any | null>(null);

  // Поля для редактирования ипотеки в модалке
  const [mortgageBank, setMortgageBank] = useState('');
  const [mortgageStatus, setMortgageStatus] = useState('NONE');
  const [mortgageComment, setMortgageComment] = useState('');
  const [loading, setLoading] = useState(false);

  // Состояния для множественных клиентов и объектов
const [dealClients, setDealClients] = useState<any[]>([]);
const [dealUnits, setDealUnits] = useState<any[]>([]);
const [dealGifts, setDealGifts] = useState<any[]>([]);
const [pendingDiscountRequest, setPendingDiscountRequest] = useState<any>(null);
const [dealHistory, setDealHistory] = useState<any[]>([]);
const [historyTypeFilter, setHistoryTypeFilter] = useState('ALL');
const [historySearch, setHistorySearch] = useState('');
const [showAddGiftModal, setShowAddGiftModal] = useState(false);
const [giftType, setGiftType] = useState<'DESCRIPTION' | 'UNIT'>('DESCRIPTION');
const [giftDescription, setGiftDescription] = useState('');
const [giftUnitId, setGiftUnitId] = useState('');
const [availableGiftUnits, setAvailableGiftUnits] = useState<any[]>([]);
const [showAddClientModal, setShowAddClientModal] = useState(false);
const [showAddUnitModal, setShowAddUnitModal] = useState(false);
const [showRemoveUnitModal, setShowRemoveUnitModal] = useState<{ id: string; number: string } | null>(null);
const [searchQuery, setSearchQuery] = useState('');
const [searchResults, setSearchResults] = useState<any[]>([]);
const [searchLoading, setSearchLoading] = useState(false);
const [selectedClient, setSelectedClient] = useState<any>(null);
const [selectedUnit, setSelectedUnit] = useState<any>(null);
const [isPrimaryClient, setIsPrimaryClient] = useState(false);
const [showRegisterNewClient, setShowRegisterNewClient] = useState(false);
const [deleteReason, setDeleteReason] = useState('');
const [customDeleteReason, setCustomDeleteReason] = useState('');

  useEffect(() => {
    setDeals(filteredInitialDeals);
  }, [initialDeals]);

  const handleDragStart = (e: React.DragEvent, dealId: string) => {
    e.dataTransfer.setData('text/plain', dealId);
    const deal = deals.find((d: any) => d.id === dealId);
    if (deal) setDraggingDealStatus(deal.status);
  };

  const handleDragEnd = () => {
    setDraggingDealStatus(null);
    stopAutoScroll();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    startAutoScroll(e.clientX);
  };

  const handleDrop = async (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    setDraggingDealStatus(null);
    stopAutoScroll();
    const dealId = e.dataTransfer.getData('text/plain');
    if (!dealId) return;

    const deal = deals.find((d: any) => d.id === dealId);
    if (!deal) return;

    const targetStage = targetStageId;

    const { allowed, reason } = isTransitionAllowed(deal.status, targetStage);
    if (!allowed) {
      alert(reason || 'Этот переход не разрешён');
      return;
    }

    let cancelReasonText = '';
    let resolvedStage = targetStage;

    if (targetStage === 'LOST_CANCELLED') {
      resolvedStage = 'CANCELLED';
    }

    if (resolvedStage === 'CANCELLED') {
      const userInput = prompt('Укажите причину расторжения сделки:');
      if (userInput === null) {
        return;
      }
      cancelReasonText = userInput.trim() || 'Причина не указана';
    }

    const previousStatus = STRICT_ZONE.includes(deal.status) && resolvedStage === 'CONSULTATION'
      ? deal.status
      : undefined;

    const originalDeals = [...deals];
    setDeals((prev: any[]) =>
      prev.map((d: any) => d.id === dealId ? {
        ...d,
        status: resolvedStage,
        ...(previousStatus ? { previousStatus } : {})
      } : d)
    );

    const res = await updateDealStatus(dealId, resolvedStage, previousStatus, false, cancelReasonText);
    if (!res.success) {
      alert(res.message || 'Ошибка при обновлении статуса сделки в БД!');
      setDeals(originalDeals);
    } else {
      const fromStatus = deal.status;
      startUndoTimer(dealId, deal.clientName || 'Сделка', fromStatus, targetStage, previousStatus);
      // router.refresh() не вызываем здесь — он сбрасывает стейт тостов.
      // Данные уже обновлены оптимистично через setDeals выше.
    }
  };

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const calculateConversion = (count: number) => {
    const total = deals.length;
    return total > 0 ? Math.round((count / total) * 100) : 0;
  };

// Загрузить дополнительных клиентов и объекты для сделки
const loadDealExtras = async (dealId: string) => {
  const clients = await getDealClients(dealId);
  const units = await getDealUnits(dealId);
  const gifts = await getDealGifts(dealId);
  const pendingDiscount = await getPendingDiscountRequest(dealId);
  const historyRes = await getDealHistory(dealId);
  setDealClients(clients);
  setDealUnits(units);
  setDealGifts(gifts);
  setPendingDiscountRequest(pendingDiscount);
  setDealHistory(historyRes.success ? historyRes.history : []);
  setHistoryTypeFilter('ALL');
  setHistorySearch('');
};

// Обновленный handleCardClick
const handleCardClick = async (deal: any) => {
  setSelectedDeal(deal);
  fetch('/api/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actionName: `Пользователь открыл сделку по квартире №${deal.unitNumber}`,
      details: { dealId: deal.id, client: deal.clientName, price: deal.unitPrice, status: deal.status }
    })
  }).catch(() => {});
  setMortgageBank(deal.mortgageBank || '');
  setMortgageStatus(deal.mortgageStatus || 'NONE');
  setMortgageComment(deal.mortgageComment || '');
  await loadDealExtras(deal.id);
};

// Автооткрытие карточки сделки по ссылке (highlightDealId), например из карточки договора
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const highlightDealId = params.get('highlightDealId');
  if (highlightDealId && deals.length > 0) {
    const found = deals.find((d: any) => d.id === highlightDealId);
    if (found) {
      handleCardClick(found);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('highlightDealId');
    window.history.replaceState({}, '', url.pathname + url.search);
  }
}, [deals]);

// Закрыть карточку сделки — если открыта из договора (backToContractId), вернуться туда
const closeDealModal = () => {
  setSelectedDeal(null);
  const params = new URLSearchParams(window.location.search);
  const backToContractId = params.get('backToContractId');
  if (backToContractId) {
    // Полная перезагрузка страницы — иначе роутер Next.js иногда отдаёт
    // закэшированный список договоров без только что открытого контракта.
    window.location.href = `/contracts?openContractId=${backToContractId}`;
  }
};

const UNIT_DELETE_REASONS = [
  'Клиент передумал',
  'Не подходит по планировке',
  'Не подходит по бюджету',
  'Квартира уже продана',
  'Не устраивает срок сдачи',
  'Другое'
];

  // Сохранение ипотеки
  const handleSaveMortgage = async () => {
    if (!selectedDeal) return;
    setLoading(true);
    const res = await updateDealMortgage({
      dealId: selectedDeal.id,
      bank: mortgageBank,
      status: mortgageStatus,
      comment: mortgageComment
    });
    if (res.success) {
      alert('Ипотечный статус успешно сохранен!');
      setSelectedDeal({
        ...selectedDeal,
        mortgageBank,
        mortgageStatus,
        mortgageComment
      });
      router.refresh();
    } else {
      alert('Ошибка при сохранении статуса ипотеки');
    }
    setLoading(false);
  };

  // Кнопка быстрого звонка в Kanban
  const handleQuickCall = async (e: React.MouseEvent, deal: any) => {
    e.stopPropagation();
    const res = await logCallAttempt(deal.lead?.id || deal.id);
    if (res.success) {
      // Инкрементируем статус звонка в соответствии с ТЗ 8.1.2: 1-й -> 2-й -> 3-й
      let nextStatus = deal.status;
      if (deal.status === 'CALL') nextStatus = 'SECOND_CALL';
      else if (deal.status === 'SECOND_CALL') nextStatus = 'THIRD_CALL';

      if (nextStatus !== deal.status) {
        await updateDealStatus(deal.id, nextStatus);
      }

      if (res.attempts >= 3) {
        alert('Достигнуто 3 попытки звонка без ответа. Рекомендуется перевести сделку в статус LOST.');
      }
      router.refresh();
    }
  };

  // Поиск лидов
const handleSearchLeads = async () => {
  if (!searchQuery.trim()) return;
  setSearchLoading(true);
  const results = await searchLeads(organizationId, searchQuery);
  setSearchResults(results);
  setSearchLoading(false);
};

// Добавить клиента
const handleAddClient = async () => {
  if (!selectedClient || !selectedDeal) return;
  const res = await addDealClient(selectedDeal.id, selectedClient.id, isPrimaryClient);
  if (res.success) {
    await loadDealExtras(selectedDeal.id);
    // Если добавили как основного — обновляем имя на доске
    if (isPrimaryClient) {
      setDeals((prev: any[]) => prev.map((d: any) =>
        d.id === selectedDeal.id ? { ...d, clientName: selectedClient.name } : d
      ));
      setSelectedDeal((prev: any) => ({ ...prev, clientName: selectedClient.name }));
    }
    setShowAddClientModal(false);
    setSelectedClient(null);
    setIsPrimaryClient(false);
    setSearchQuery('');
    setSearchResults([]);
    alert('Клиент добавлен в сделку');
  } else {
    alert(res.message || 'Ошибка при добавлении клиента');
  }
};

// Поиск объектов
const handleSearchUnits = async () => {
  if (!searchQuery.trim()) return;
  setSearchLoading(true);
  const results = await searchUnits(organizationId, searchQuery);
  setSearchResults(results);
  setSearchLoading(false);
};

// Добавить объект
const handleAddUnit = async () => {
  if (!selectedUnit || !selectedDeal) return;
  const res = await addDealUnit(selectedDeal.id, selectedUnit.id);
  if (res.success) {
    await loadDealExtras(selectedDeal.id);
    setShowAddUnitModal(false);
    setSelectedUnit(null);
    setSearchQuery('');
    setSearchResults([]);
    // alert() блокирует поток синхронно — откладываем на следующий тик,
    // чтобы браузер успел отрисовать закрытие модалки ДО показа диалога
    setTimeout(() => alert('Объект добавлен в сделку'), 0);
  } else {
    alert(res.message || 'Ошибка при добавлении объекта');
  }
};

// Удалить объект с причиной
const handleRemoveUnit = async () => {
  if (!showRemoveUnitModal) return;
  const finalReason = deleteReason === 'Другое' ? customDeleteReason : deleteReason;
  if (!finalReason) {
    alert('Укажите причину удаления');
    return;
  }
  const res = await removeDealUnit(showRemoveUnitModal.id, deleteReason, customDeleteReason);
  if (res.success) {
    await loadDealExtras(selectedDeal!.id);
    router.refresh();
    setShowRemoveUnitModal(null);
    setDeleteReason('');
    setCustomDeleteReason('');
    alert('Объект удален из сделки');
  } else {
    alert('Ошибка при удалении объекта');
  }
};

// Сменить основного клиента
const handleSetPrimaryClient = async (leadId: string) => {
  if (!selectedDeal) return;

  // Находим данные нового основного клиента
  const newPrimaryClient = dealClients.find(c => c.leadId === leadId);
  if (!newPrimaryClient) return;

  // Обновляем в базе данных
  const res = await setPrimaryClient(selectedDeal.id, leadId);

  if (res.success) {
    // Обновляем локальный state selectedDeal
    setSelectedDeal({
      ...selectedDeal,
      lead: {
        id: newPrimaryClient.leadId,
        name: newPrimaryClient.name,
        phone: newPrimaryClient.phone,
        email: newPrimaryClient.email,
        iin: newPrimaryClient.iin
      },
      clientName: newPrimaryClient.name
    });

    // Перезагружаем список клиентов
    await loadDealExtras(selectedDeal.id);
    alert('Основной клиент изменен');
  }
};

  return (
    <div className={styles.kanbanWrapper}>
      <header style={{marginBottom: '20px'}}>
        <h1 style={{fontSize: '2rem', fontWeight: 800, color: '#1e293b'}}></h1>
        <p style={{color: '#64748b', fontSize: '0.95rem'}}></p>
      </header>

      <div
        className={styles.kanbanScroll}
        ref={scrollContainerRef}
        onDragOver={(e) => { e.preventDefault(); startAutoScroll(e.clientX); }}
        onDragLeave={stopAutoScroll}
      >
        <div className={styles.kanbanBoardInner}>
        <div className={styles.kanbanBoardVertical}>
        {STAGES.map((stage) => {
          if (stage.type === 'child') return null;

          let stageDeals: any[] = [];
          if (stage.type === 'group' && stage.children) {
            stageDeals = deals.filter(d => stage.children?.includes(d.status));
          } else {
            stageDeals = deals.filter(d => d.status === stage.id);
          }

          const conversion = calculateConversion(stageDeals.length);
          // По ТЗ деньги суммируем только со стадии Личная консультация (CONSULTATION, ранг >= 5)
          const isFinancialStage = !['NEW_LEAD', 'CLARIFICATION', 'CALL', 'SECOND_CALL', 'THIRD_CALL', 'LOST_CANCELLED'].includes(stage.id);
          const stageRevenue = isFinancialStage
            ? stageDeals.reduce((sum, deal) => sum + (deal.workingPrice ?? deal.unit?.price ?? 0), 0)
            : 0;

          return (
            <div
              key={stage.id}
              className={`${styles.verticalStage} ${stage.type === 'group' ? styles.groupStage : ''} ${['CALL', 'SECOND_CALL', 'THIRD_CALL'].includes(stage.id) ? styles.callStage : ''} ${stage.id === 'LOST_CANCELLED' ? styles.lostStage : ''}`}
              style={{
                opacity: (() => {
                  if (!draggingDealStatus) return 1;
                  if (stage.type === 'group' && stage.children) {
                    // Для группы звонков — затемняем если ни один дочерний статус недоступен
                    const anyAllowed = stage.children.some(
                      child => isTransitionAllowed(draggingDealStatus, child).allowed
                    );
                    return anyAllowed ? 1 : 0.35;
                  }
                  return isTransitionAllowed(draggingDealStatus, stage.id).allowed ? 1 : 0.35;
                })(),
                transition: 'opacity 0.2s',
              }}
            >
              <div
                className={styles.stageHeader}
                style={{ borderLeftColor: stage.color }}
                onClick={stage.type === 'group' ? () => toggleGroup(stage.id) : undefined}
              >
                <div className={styles.stageMainInfo}>
                  {stage.type === 'group' && (
                    <span className={styles.expandArrow}>
                      {expandedGroups[stage.id] ? '' : ''}
                    </span>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
  <h4 style={{ margin: 0 }}>{stage.label}</h4>
  <span 
    className={styles.infoIcon} 
    title={STAGE_DESCRIPTIONS[stage.id] || ''}
  >
    ⓘ
  </span>
</div>
                  <span className={styles.countBadge}>{stageDeals.length}</span>
                </div>

                <div className={styles.stageStats}>
                  {isFinancialStage && (
                    <span className={styles.revenue}>${stageRevenue.toLocaleString()}</span>
                  )}
                  <span className={styles.conversion}>{conversion}%</span>
                </div>
              </div>

              <div
                className={styles.verticalCardList}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage.id)}
              >
                {stageDeals.length > 0 ? (
                  stageDeals.map((deal) => {
                    const daysInStatus = Math.floor((Date.now() - new Date(deal.updatedAt).getTime()) / (1000 * 60 * 60 * 24));
                    const isSlaOverdue = daysInStatus >= 3;

                    // Полоска предыдущего статуса — только в колонке Личная консультация
                    const prevStatusColor = stage.id === 'CONSULTATION' && deal.previousStatus
                      ? STAGES.find(s => s.id === deal.previousStatus)?.color
                      : null;

                    return (
                      <div
                        key={deal.id}
                        className={styles.dealCardVertical}
                        draggable={canManage && !readOnly}
                        onDragStart={canManage && !readOnly ? (e) => handleDragStart(e, deal.id) : undefined}
                        onDragEnd={canManage && !readOnly ? handleDragEnd : undefined}
                        onClick={() => handleCardClick(deal)}
                        style={prevStatusColor ? {
                          borderLeft: `4px solid ${prevStatusColor}`,
                          paddingLeft: '10px',
                        } : undefined}
                      >
                        <div className={styles.cardHeaderSmall}>
                          <span className={styles.unitTagSmall}>{deal.unit?.number ? `№${deal.unit.number}` : 'Без объекта'}</span>
                          <span className={styles.dealIdSmall}>{deal.dealNumber || `#${deal.id.slice(0, 6)}`}</span>
                        </div>
                        <div className={styles.clientNameSmall}>{deal.clientName || 'Без имени'}</div>

                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px'}}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span className={styles.priceTagSmall} title={deal.priceLocked ? 'Цена зафиксирована (Договор)' : undefined}>
                              {deal.unit?.price ? `$${Math.round(deal.unit.price).toLocaleString()}` : '—'}
                            </span>
                            {deal.hasActivePromo && deal.workingPrice != null && (
                              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#dc2626' }}>
                                С учётом акций: ${Math.round(deal.workingPrice).toLocaleString()}
                              </span>
                            )}
                          </div>

                          {/* SLA тикер дней на этапе */}
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: isSlaOverdue ? '#fee2e2' : '#f1f5f9',
                            color: isSlaOverdue ? '#ef4444' : '#64748b'
                          }}>
                            ⏱ {daysInStatus} дн.
                          </span>
                        </div>

                        {/* Звонки и под-статусы ТЗ 8.1.2 */}
                        {stage.id === 'CALL_GROUP' && (
                          <div style={{marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                            <span style={{
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              color: '#2563eb',
                              background: '#eff6ff',
                              padding: '2px 6px',
                              borderRadius: '4px'
                            }}>
                              {deal.status === 'CALL' ? '1-й звонок' : deal.status === 'SECOND_CALL' ? '2-й звонок' : '3-й звонок'}
                            </span>
                            <button
                              className={styles.quickCallBtn}
                              onClick={(e) => handleQuickCall(e, deal)}
                            >
                               Набрать
                            </button>
                          </div>
                        )}

                        {/* Отображение статуса ипотеки на карточке */}
                        {deal.mortgageStatus && deal.mortgageStatus !== 'NONE' && (
                          <div style={{marginTop: '8px', display: 'flex', gap: '5px'}}>
                            <span style={{
                              fontSize: '0.7rem',
                              fontWeight: 800,
                              background: deal.mortgageStatus === 'APPROVED' ? '#d1fae5' : deal.mortgageStatus === 'REJECTED' ? '#fee2e2' : '#fef3c7',
                              color: deal.mortgageStatus === 'APPROVED' ? '#065f46' : deal.mortgageStatus === 'REJECTED' ? '#991b1b' : '#92400e',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              textTransform: 'uppercase'
                            }}>
                               {deal.mortgageBank}: {deal.mortgageStatus === 'APPROVED' ? 'Одобрено' : deal.mortgageStatus === 'REJECTED' ? 'Отказ' : 'На рассмотрении'}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className={styles.emptyStage}>Нет сделок</div>
                )}
              </div>

              {/* Отображение развернутой группы для Звонков */}
              {stage.type === 'group' && expandedGroups[stage.id] && stage.children && (
                <div className={styles.childStages}>
                  {stage.children.map((childId) => {
                    const child = STAGES.find((s) => s.id === childId);
                    const childDeals = deals.filter((d) => d.status === childId);

                    return (
                      <div key={childId} className={styles.childStageCard}>
                        <div
                          className={styles.stageHeader}
                          style={{ borderLeftColor: child?.color }}
                        >
                          <div className={styles.stageMainInfo}>
                            <span className={styles.childLine}>↓</span>
                            <h4>{child?.label}</h4>
                            <span className={styles.countBadge}>{childDeals.length}</span>
                          </div>
                        </div>

                        <div
                          className={styles.verticalCardList}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, childId)}
                        >
                          {childDeals.length > 0 ? (
                            childDeals.map((deal) => (
                              <div
                                key={deal.id}
                                className={styles.dealCardVertical}
                                draggable={canManage && !readOnly}
                                onDragStart={canManage && !readOnly ? (e) => handleDragStart(e, deal.id) : undefined}
                                onDragEnd={canManage && !readOnly ? handleDragEnd : undefined}
                                onClick={() => handleCardClick(deal)}
                              >
                                <div className={styles.cardHeaderSmall}>
                                  <span className={styles.unitTagSmall}>{deal.unit?.number ? `№${deal.unit.number}` : 'Без объекта'}</span>
                                  <span className={styles.dealIdSmall}>
                                    {deal.dealNumber || `#${deal.id.slice(0, 6)}`}
                                  </span>
                                </div>

                                <div className={styles.clientNameSmall}>
                                  {deal.clientName || 'Без имени'}
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <div className={styles.priceTagSmall} title={deal.priceLocked ? 'Цена зафиксирована (Договор)' : undefined}>
                                    {deal.unit?.price ? `$${Math.round(deal.unit.price).toLocaleString()}` : '—'}
                                  </div>
                                  {deal.hasActivePromo && deal.workingPrice != null && (
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#dc2626' }}>
                                      С учётом акций: ${Math.round(deal.workingPrice).toLocaleString()}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className={styles.emptyStage}>Нет сделок</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>
      </div>

      {/* Модальное окно деталей сделки с блоком Ипотеки */}
      {selectedDeal && (
  <div className={styles.overlay} onClick={closeDealModal}>
    <div className={styles.modalFullscreen} onClick={(e) => e.stopPropagation()}>
      <header className={styles.modalHeader}>
              <h2 style={{fontWeight: 800, color: '#0f172a', fontSize: '1.7rem'}}>Карточка сделки {selectedDeal.dealNumber || `#${selectedDeal.id.slice(0, 8)}`}</h2>
              {/* Кнопка закрытия скрыта по заданию */}
        <button className={styles.closeBtn} onClick={closeDealModal}>✕</button>
            </header>

            <main className={styles.modalBody}>
  {pendingDiscountRequest && canApprove && (
    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
      <strong style={{ color: '#b45309' }}> На согласовании: скидка {pendingDiscountRequest.proposedDiscountPercent}%</strong>
      <div style={{ fontSize: '0.82rem', color: '#78350f', margin: '4px 0 10px' }}>
        Предложил: {pendingDiscountRequest.submittedByName || 'менеджер'}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          className={styles.saveMortgageBtn}
          onClick={async () => {
            const res = await approveDiscountRequest(pendingDiscountRequest.id, managerId, organizationId);
            if (res.success) {
              alert('Скидка согласована и график сохранён.');
              await loadDealExtras(selectedDeal.id);
            } else {
              alert('Ошибка: ' + (res.error || ''));
            }
          }}
        >
          Согласовать
        </button>
        <button
          className={styles.quickCallBtn}
          style={{ background: '#fee2e2', color: '#ef4444' }}
          onClick={async () => {
            if (!confirm('Отклонить скидку?')) return;
            const res = await rejectDiscountRequest(pendingDiscountRequest.id, managerId, organizationId);
            if (res.success) {
              alert('Скидка отклонена.');
              await loadDealExtras(selectedDeal.id);
            } else {
              alert('Ошибка: ' + (res.error || ''));
            }
          }}
        >
          Отклонить
        </button>
      </div>
    </div>
  )}
  {pendingDiscountRequest && !canApprove && (
    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px 14px', marginBottom: '16px', fontSize: '0.85rem', color: '#b45309' }}>
       Скидка {pendingDiscountRequest.proposedDiscountPercent}% ожидает согласования РОП.
    </div>
  )}
  {/* БЛОК ДАННЫЕ КЛИЕНТА С ПЛЮСИКОМ */}
  <div className={styles.infoSection}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
      <h3 style={{ fontWeight: 800, fontSize: '1.25rem', color: '#1e293b', borderBottom: '1px solid #f1f5f9', paddingBottom: '5px', margin: 0 }}>
         Данные клиента
      </h3>
      <button
        className={styles.quickCallBtn}
        onClick={() => {
          setSearchQuery('');
          setSearchResults([]);
          setSelectedClient(null);
          setIsPrimaryClient(false);
          setShowAddClientModal(true);
        }}
        style={{ fontSize: '1.2rem', padding: '4px 12px' }}
      >
        +
      </button>
    </div>

    {/* Все клиенты сделки из dealClients */}
    {dealClients.map(client => (
      <div key={client.id} style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>{client.name}</strong>
            {client.isPrimary && (
              <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', marginLeft: '8px' }}>
                ОСНОВНОЙ
              </span>
            )}
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{client.phone}</div>
            {client.email && <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{client.email}</div>}
          </div>
          <div>
            {!client.isPrimary && (
              <button
                className={styles.quickCallBtn}
                style={{ marginRight: '8px' }}
                onClick={() => handleSetPrimaryClient(client.leadId)}
              >
                Сделать основным
              </button>
            )}
            <button
              className={styles.quickCallBtn}
              style={{ background: '#fee2e2', color: '#ef4444', display: 'none' }}
              onClick={async () => {
                if (confirm('Удалить клиента из сделки?')) {
                  await removeDealClient(client.id);
                  await loadDealExtras(selectedDeal.id);
                }
              }}
            >

            </button>
          </div>
        </div>
      </div>
    ))}
  </div>

  {/* БЛОК ОБЪЕКТ НЕДВИЖИМОСТИ С ПЛЮСИКОМ */}
  <div className={styles.infoSection}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
      <h3 style={{ fontWeight: 800, fontSize: '1.25rem', color: '#1e293b', borderBottom: '1px solid #f1f5f9', paddingBottom: '5px', margin: 0 }}>
         Объект недвижимости
      </h3>
      <button
        className={styles.quickCallBtn}
        onClick={() => {
          setSearchQuery('');
          setSearchResults([]);
          setSelectedUnit(null);
          setShowAddUnitModal(true);
        }}
        style={{ fontSize: '1.2rem', padding: '4px 12px' }}
      >
        +
      </button>
    </div>

    {/* Основной объект (из сделки) */}
    {selectedDeal.unit ? (
      <div style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>{selectedDeal.unit.projectName || 'ЖК'}</strong> – №{selectedDeal.unit.number}
            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
              {selectedDeal.unit.rooms} комн. • {selectedDeal.unit.area} м² • ${selectedDeal.unit.price?.toLocaleString()} (каталог)
            </div>
            {(selectedDeal.workingPrice != null && Math.round(selectedDeal.workingPrice) !== Math.round(selectedDeal.unit.price || 0)) && (
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#dc2626', marginTop: '2px' }}>
                {selectedDeal.priceLocked ? 'Зафиксировано: ' : 'С учётом акций: '}
                ${Math.round(selectedDeal.workingPrice).toLocaleString()}
              </div>
            )}
          </div>
          <a
            href={`/shakhmatka?highlightUnitId=${selectedDeal.unit.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.quickCallBtn}
            style={{ textDecoration: 'none', fontSize: '0.8rem' }}
            title="Открыть карточку помещения"
          >
             В шахматке
          </a>
        </div>
      </div>
    ) : (
      <p style={{ color: '#94a3b8', fontStyle: 'italic' }}>Квартира к сделке еще не привязана</p>
    )}

    {/* Дополнительные объекты */}
    {dealUnits.map(unit => (
      <div key={unit.id} style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>{unit.projectName}</strong> – №{unit.number}
            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
              {unit.rooms} комн. • {unit.area} м² • ${Number(unit.price).toLocaleString()}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <a
              href={`/shakhmatka?highlightUnitId=${unit.unitId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.quickCallBtn}
              style={{ textDecoration: 'none', fontSize: '0.8rem' }}
              title="Открыть карточку помещения"
            >
               В шахматке
            </a>
            <button
              className={styles.quickCallBtn}
              style={{ background: '#fee2e2', color: '#ef4444' }}
              onClick={() => setShowRemoveUnitModal({ id: unit.id, number: unit.number })}
            >
              Удалить
            </button>
          </div>
        </div>
      </div>
    ))}
  </div>

  {/* Блок "Бенефиты" скрыт по запросу — код оставлен на случай, если понадобится вернуть */}
  {false && (
  <div className={styles.infoSection}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
      <h3 style={{ fontWeight: 800, fontSize: '1.25rem', color: '#1e293b', borderBottom: '1px solid #f1f5f9', paddingBottom: '5px', margin: 0 }}>
         Бенефиты
      </h3>
      {canManage && (
        <button
          className={styles.quickCallBtn}
          onClick={() => setShowAddGiftModal(true)}
          style={{ fontSize: '1.2rem', padding: '4px 12px' }}
        >
          +
        </button>
      )}
    </div>
    {dealGifts.length === 0 ? (
      <p style={{ color: '#94a3b8', fontStyle: 'italic' }}>Бенефитов к сделке не добавлено</p>
    ) : (
      dealGifts.map((g: any) => (
        <div key={g.id} style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {g.giftType === 'UNIT' ? (
                <>
                  <strong>{g.unitType === 'Parking' ? 'Паркинг' : 'Кладовая'} №{g.unitNumber}</strong>
                  <div style={{ fontSize: '0.85rem', color: '#64748b' }}>{g.projectName}, корпус {g.blockNumber} — в подарок</div>
                </>
              ) : (
                <strong>{g.description}</strong>
              )}
            </div>
            {canManage && (
              <button
                className={styles.quickCallBtn}
                style={{ background: '#fee2e2', color: '#ef4444' }}
                onClick={async () => {
                  if (!confirm('Удалить подарок?')) return;
                  const res = await removeDealGift(g.id, organizationId);
                  if (res.success) setDealGifts(await getDealGifts(selectedDeal.id));
                  else alert('Ошибка: ' + (res.error || ''));
                }}
              >
                Удалить
              </button>
            )}
          </div>
        </div>
      ))
    )}
  </div>
  )}

  {/* Блок Ипотека (остается без изменений) */}
  <div className={styles.infoSection} style={{ background: 'rgba(59, 130, 246, 0.03)', border: '1px solid rgba(59, 130, 246, 0.1)', padding: '15px', borderRadius: '10px' }}>
    <h3 style={{ fontWeight: 800, marginBottom: '12px', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '8px' }}>
       Блок «Ипотека» (Статус одобрения)
    </h3>

    <div style={{ display: 'flex', gap: '15px', marginBottom: '12px' }}>
      <div style={{ flex: 1 }}>
        <label style={{ display: 'block', fontWeight: 800, fontSize: '0.8rem', color: '#475569', marginBottom: '5px' }}>Выбор банка</label>
        <select
          className={styles.modalInput}
          value={mortgageBank}
          onChange={e => setMortgageBank(e.target.value)}
        >
          <option value="">Не выбрано</option>
          <option value="TBC Bank">TBC Bank</option>
          <option value="Bank of Georgia">Bank of Georgia</option>
          <option value="VTB Bank">VTB Bank</option>
          <option value="Other Bank">Другой банк</option>
        </select>
      </div>

      <div style={{ flex: 1 }}>
        <label style={{ display: 'block', fontWeight: 800, fontSize: '0.8rem', color: '#475569', marginBottom: '5px' }}>Статус одобрения</label>
        <select
          className={styles.modalInput}
          value={mortgageStatus}
          onChange={e => setMortgageStatus(e.target.value)}
        >
          <option value="NONE">Нет ипотеки</option>
          <option value="PENDING">На рассмотрении</option>
          <option value="APPROVED">Одобрено банком</option>
          <option value="REJECTED">Отказ банка</option>
          <option value="ISSUED">Ипотека выдана</option>
        </select>
      </div>
    </div>

    <div style={{ marginBottom: '15px' }}>
      <label style={{ display: 'block', fontWeight: 800, fontSize: '0.8rem', color: '#475569', marginBottom: '5px' }}>Комментарий по ипотеке</label>
      <textarea
        className={styles.modalInput}
        style={{ minHeight: '60px' }}
        value={mortgageComment}
        onChange={e => setMortgageComment(e.target.value)}
        placeholder="Например: Одобрено под 7% годовых, ждем документы..."
      />
    </div>

    <button
      className={styles.saveMortgageBtn}
      onClick={handleSaveMortgage}
      disabled={loading}
    >
      {loading ? 'Сохранение...' : ' Сохранить статус ипотеки'}
    </button>
  </div>

  {/* Хронология событий сделки (DEA-029) */}
  <div className={styles.infoSection}>
    <h3 style={{ fontWeight: 800, fontSize: '1.25rem', color: '#1e293b', borderBottom: '1px solid #f1f5f9', paddingBottom: '5px', margin: '0 0 10px 0' }}>
       Хронология
    </h3>
    <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
      <select
        value={historyTypeFilter}
        onChange={e => setHistoryTypeFilter(e.target.value)}
        className={styles.modalInput}
        style={{ width: 'auto', minWidth: '160px' }}
      >
        <option value="ALL">Все события</option>
        {Array.from(new Set(dealHistory.map((h: any) => h.fieldName || h.action))).map((type: any) => (
          <option key={type} value={type}>{type === 'status' ? 'Смена статуса' : type}</option>
        ))}
      </select>
      <input
        type="text"
        placeholder="Поиск по менеджеру, значению, причине..."
        value={historySearch}
        onChange={e => setHistorySearch(e.target.value)}
        className={styles.modalInput}
        style={{ flex: 1, minWidth: '200px' }}
      />
    </div>

    {(() => {
      const filtered = dealHistory.filter((h: any) => {
        if (historyTypeFilter !== 'ALL' && (h.fieldName || h.action) !== historyTypeFilter) return false;
        if (historySearch.trim()) {
          const q = historySearch.trim().toLowerCase();
          const haystack = [
            h.managerName,
            h.fieldName === 'status' ? DEAL_STATUS_LABELS[h.oldValue] : h.oldValue,
            h.fieldName === 'status' ? DEAL_STATUS_LABELS[h.newValue] : h.newValue,
            h.reason,
          ].filter(Boolean).join(' ').toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        return (
          <p style={{ color: '#94a3b8', fontStyle: 'italic' }}>
            {dealHistory.length === 0 ? 'История событий пока пуста' : 'Ничего не найдено по заданным условиям'}
          </p>
        );
      }

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
          {filtered.map((h: any) => (
            <div key={h.id} style={{ padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748b', marginBottom: '4px' }}>
                <span style={{ fontWeight: 700, color: '#1e293b' }}>{h.managerName}</span>
                <span>{new Date(h.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#334155' }}>
                {h.fieldName === 'status'
                  ? <>Смена статуса: <strong>{DEAL_STATUS_LABELS[h.oldValue] || h.oldValue}</strong> → <strong>{DEAL_STATUS_LABELS[h.newValue] || h.newValue}</strong></>
                  : <>{h.fieldName || h.action}: {h.oldValue} → {h.newValue}</>
                }
              </div>
              {h.reason && (
                <div style={{ fontSize: '0.78rem', color: '#b45309', marginTop: '4px', fontStyle: 'italic' }}>
                  Причина: {h.reason}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    })()}
  </div>
</main>

{/* Модалка добавления клиента */}
{showAddClientModal && (
  <div className={styles.overlay} onClick={() => setShowAddClientModal(false)}>
    <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '500px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
      <header className={styles.modalHeader}>
        <h2 style={{ fontWeight: 800 }}> Добавить участника сделки</h2>
        <button className={styles.closeBtn} onClick={() => setShowAddClientModal(false)}></button>
      </header>
      <div style={{ overflowY: 'auto', flex: 1, padding: '0 4px' }}>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        <input
          type="text"
          className={styles.modalInput}
          placeholder="Имя, телефон или email..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <button className={styles.quickCallBtn} onClick={handleSearchLeads}> Поиск</button>
      </div>

      {searchLoading && <p>Поиск...</p>}

      {searchResults.length > 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', maxHeight: '250px', overflowY: 'auto', marginBottom: '16px' }}>
          {searchResults.map(lead => (
            <div
              key={lead.id}
              style={{ padding: '12px', cursor: 'pointer', background: selectedClient?.id === lead.id ? '#eff6ff' : 'white', borderBottom: '1px solid #e2e8f0' }}
              onClick={() => setSelectedClient(lead)}
            >
              <strong>{lead.name}</strong> – {lead.phone}
            </div>
          ))}
        </div>
      )}

      {selectedClient && (
        <div style={{ marginBottom: '16px', padding: '10px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
          <strong>Выбран:</strong> {selectedClient.name} — {selectedClient.phone}
        </div>
      )}

      {selectedClient && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" checked={isPrimaryClient} onChange={e => setIsPrimaryClient(e.target.checked)} />
            Сделать основным клиентом (на кого оформляется договор)
          </label>
        </div>
      )}

      {/* Разделитель */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '16px 0' }}>
        <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
        <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>или</span>
        <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
      </div>

      <button
        className={styles.quickCallBtn}
        style={{ width: '100%', marginBottom: '16px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', fontWeight: 700 }}
        onClick={() => setShowRegisterNewClient(true)}
      >
         Зарегистрировать нового клиента
      </button>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <button className={styles.quickCallBtn} onClick={() => setShowAddClientModal(false)}>Отмена</button>
        <button className={styles.saveMortgageBtn} onClick={handleAddClient} disabled={!selectedClient}>
          Добавить
        </button>
      </div>
      </div>
    </div>
  </div>
)}

{/* Модалка регистрации нового клиента поверх модалки добавления участника */}
{showRegisterNewClient && (
  <LeadModal
    onClose={() => setShowRegisterNewClient(false)}
    organizationId={organizationId}
    onSuccess={async () => {
      // После создания — ничего не делаем здесь, всё обрабатывается в onCreated
    }}
    onCreated={async (newClientId: string, newClientName: string, newClientPhone: string) => {
      // Закрываем модалку регистрации
      setShowRegisterNewClient(false);
      // Автоматически выбираем нового клиента в модалке добавления участника
      setSelectedClient({ id: newClientId, name: newClientName, phone: newClientPhone });
    }}
  />
)}

{/* Модалка добавления объекта */}
{showAddUnitModal && (
  <div className={styles.overlay} onClick={() => setShowAddUnitModal(false)}>
    <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
      <header className={styles.modalHeader}>
        <h2 style={{ fontWeight: 800 }}> Добавить объект недвижимости</h2>
        <button className={styles.closeBtn} onClick={() => setShowAddUnitModal(false)}></button>
      </header>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        <input
          type="text"
          className={styles.modalInput}
          placeholder="Номер квартиры или ЖК..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <button className={styles.quickCallBtn} onClick={handleSearchUnits}> Поиск</button>
      </div>

      {searchLoading && <p>Поиск...</p>}

      {searchResults.length > 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', maxHeight: '250px', overflowY: 'auto', marginBottom: '16px' }}>
          {searchResults.map(unit => (
            <div
              key={unit.id}
              style={{ padding: '12px', cursor: 'pointer', background: selectedUnit?.id === unit.id ? '#eff6ff' : 'white', borderBottom: '1px solid #e2e8f0' }}
              onClick={() => setSelectedUnit(unit)}
            >
              <strong>{unit.projectName}</strong> – №{unit.number} – ${Number(unit.price).toLocaleString()}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <button className={styles.quickCallBtn} onClick={() => setShowAddUnitModal(false)}>Отмена</button>
        <button className={styles.saveMortgageBtn} onClick={handleAddUnit} disabled={!selectedUnit}>
          Добавить
        </button>
      </div>
    </div>
  </div>
)}

{/* Модалка удаления объекта с причиной */}
{showRemoveUnitModal && (
  <div className={styles.overlay} onClick={() => setShowRemoveUnitModal(null)}>
    <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
      <header className={styles.modalHeader}>
        <h2 style={{ fontWeight: 800 }}> Удаление объекта №{showRemoveUnitModal.number}</h2>
        <button className={styles.closeBtn} onClick={() => setShowRemoveUnitModal(null)}></button>
      </header>

      <p style={{ marginBottom: '16px', color: '#64748b' }}>Укажите причину отказа от объекта:</p>

      <select
        className={styles.modalInput}
        value={deleteReason}
        onChange={e => setDeleteReason(e.target.value)}
        style={{ marginBottom: '12px' }}
      >
        <option value="">-- Выберите причину --</option>
        {UNIT_DELETE_REASONS.map(reason => (
          <option key={reason} value={reason}>{reason}</option>
        ))}
      </select>

      {deleteReason === 'Другое' && (
        <input
          type="text"
          className={styles.modalInput}
          placeholder="Укажите причину..."
          value={customDeleteReason}
          onChange={e => setCustomDeleteReason(e.target.value)}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
        <button className={styles.quickCallBtn} onClick={() => setShowRemoveUnitModal(null)}>Отмена</button>
        <button className={styles.saveMortgageBtn} onClick={handleRemoveUnit}>
          Подтвердить удаление
        </button>
      </div>
    </div>
  </div>
)}

{showAddGiftModal && (
  <div className={styles.overlay} onClick={() => setShowAddGiftModal(false)}>
    <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
      <header className={styles.modalHeader}>
        <h2 style={{ fontWeight: 800 }}> Добавить бенефит</h2>
        <button className={styles.closeBtn} onClick={() => setShowAddGiftModal(false)}></button>
      </header>

      <label style={{ display: 'block', fontWeight: 800, fontSize: '0.8rem', color: '#475569', marginBottom: '5px' }}>Тип бенефита</label>
      <select
        className={styles.modalInput}
        value={giftType}
        onChange={async (e) => {
          const val = e.target.value as 'DESCRIPTION' | 'UNIT';
          setGiftType(val);
          if (val === 'UNIT' && availableGiftUnits.length === 0) {
            setAvailableGiftUnits(await getAvailableGiftUnits(organizationId));
          }
        }}
        style={{ marginBottom: '12px' }}
      >
        <option value="DESCRIPTION">Немонетарный бонус (текстом)</option>
        <option value="UNIT">Паркинг / Кладовая из каталога</option>
      </select>

      {giftType === 'DESCRIPTION' ? (
        <input
          type="text"
          className={styles.modalInput}
          placeholder="Например: Кухонная техника"
          value={giftDescription}
          onChange={e => setGiftDescription(e.target.value)}
        />
      ) : (
        <select className={styles.modalInput} value={giftUnitId} onChange={e => setGiftUnitId(e.target.value)}>
          <option value="">— Выберите свободный паркинг/кладовую —</option>
          {availableGiftUnits.map((u: any) => (
            <option key={u.id} value={u.id}>
              {u.projectName}, корпус {u.blockNumber} — {u.type === 'Parking' ? 'Паркинг' : 'Кладовая'} №{u.number}
            </option>
          ))}
        </select>
      )}
      <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '6px' }}>
        Паркинг/кладовая, выданные как бенефит, автоматически резервируются и не смогут попасть в другую сделку.
      </p>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
        <button className={styles.quickCallBtn} onClick={() => setShowAddGiftModal(false)}>Отмена</button>
        <button
          className={styles.saveMortgageBtn}
          onClick={async () => {
            const res = await addDealGift({
              dealId: selectedDeal.id,
              giftType,
              description: giftDescription || undefined,
              unitId: giftUnitId || undefined,
              organizationId,
              initiatorId: managerId,
            });
            if (res.success) {
              setDealGifts(await getDealGifts(selectedDeal.id));
              setShowAddGiftModal(false);
              setGiftDescription('');
              setGiftUnitId('');
              setGiftType('DESCRIPTION');
            } else {
              alert('Ошибка: ' + (res.error || ''));
            }
          }}
        >
          Добавить
        </button>
      </div>
    </div>
  </div>
)}
          </div>
        </div>
      )}

      {/* Стопка тостов отмены */}
      {undoActions.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '32px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 9999,
          alignItems: 'center',
        }}>
          {undoActions.map((action, index) => (
            <div
              key={action.id}
              style={{
                background: '#1e293b',
                color: 'white',
                borderRadius: '12px',
                padding: '14px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
                minWidth: '340px',
                opacity: 1,
                transform: 'scale(1)',
                transition: 'all 0.3s ease',
                animation: index === undoActions.length - 1 ? 'slideUp 0.25s ease' : 'none',
              }}
            >
              <div style={{ flex: 1, fontSize: '0.9rem' }}>
                <strong>{action.dealName}</strong>
                <span style={{ color: '#94a3b8', marginLeft: '6px' }}>
                  → {STAGES.find(s => s.id === action.toStatus)?.label}
                </span>
              </div>
              <button
                onClick={() => handleUndo(action.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '8px',
                  color: 'white',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="8" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2"/>
                  <circle
                    cx="10" cy="10" r="8"
                    fill="none"
                    stroke="#60a5fa"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 8}`}
                    strokeDashoffset={`${2 * Math.PI * 8 * (1 - action.secondsLeft / 10)}`}
                    transform="rotate(-90 10 10)"
                    style={{ transition: 'stroke-dashoffset 1s linear' }}
                  />
                  <text x="10" y="10" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="7" fontWeight="bold">
                    {action.secondsLeft}
                  </text>
                </svg>
                Отменить
              </button>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}