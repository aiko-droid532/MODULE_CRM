'use client';
 
import React, { useState, useEffect, useMemo } from 'react';
import styles from './Shakhmatka.module.css';
import { createDemoProject, getPriceHistory, createUnit, updateUnit, deleteUnit, getBlocksForSelect, getUnitActionHistory, getUnitAssociatedClient, createProjectAction, generateBlockAndUnitsAction, getUnitRooms, terminateUnitContract } from '@/app/actions/units';
import { createBooking, releaseBooking, addToWaitingListAction, removeFromWaitingListAction, getWaitingListAction } from '@/app/actions/booking';
import { getExchangeRate } from '@/app/actions/exchange';
import { importUnitsFromExcel } from '@/app/actions/import';
import { getActiveDealsForUnit, saveInstallmentPlanAction, getLockedUnitDealsMap, getInstallmentPlanForDeal } from '@/app/actions/deals';
import { useRouter } from 'next/navigation';
import LeadDossier from '@/components/Leads/LeadDossier';
import * as XLSX from 'xlsx';
import UnitLayoutSvg from '@/components/Shakhmatka/UnitLayoutSvg';
import { getLivePromotionsMap } from '@/app/actions/promotions';
import { getApplicableCumulativeDiscount } from '@/app/actions/loyalty';
import { calcPromoPrice, formatEffectSummary, formatGeorgiaDateTime, type PromotionEffectType } from '@/lib/promotionCalculator';
import {
  calculateInstallmentPlan,
  applyCumulativeDiscount,
  applyStandardPreset,
  calcBasePrice,
  calcFinalPrice,
  calcDiscountTotal,
  computeAutoScheduleDates,
  calcPeriodsCount,
  isUnitDelivered,
  formatDateRu,
  toDateInputValue,
  exportScheduleCsv,
  PERIODICITY_LABELS,
  type InstallmentResult,
} from '@/lib/installmentCalculator';

import { canManageUnits, canManagePrices, canManageDeals, isReadOnly, canApplyDiscountPercent, getMaxDiscountPercent, getRequiredApproverLabel, UserRole } from '@/lib/roles';

interface ShakhmatkaClientProps {
  projects: any[];
  leads: any[];
  organizationId: string;
  userRole?: string;
  managerId?: string;
}

export default function ShakhmatkaClient({ projects: initialProjects, leads, organizationId, userRole = 'manager', managerId = '' }: ShakhmatkaClientProps) {
  const role = userRole as UserRole;
  const canUnits = canManageUnits(role);
  const canPrices = canManagePrices(role);
  const canDeals = canManageDeals(role);
  const readOnly = isReadOnly(role);

  // Дата/время акции форматируются в локальном часовом поясе браузера смотрящего
  // (см. formatGeorgiaDateTime) — на сервере при SSR его нет, поэтому первый рендер
  // до монтирования в браузере не должен пытаться его показывать (иначе hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // getLeadsList теперь сразу отдаёт только клиентов (CONVERTED/не LEAD) — фильтр по всей
  // таблице лидов организации перенесён на сервер, здесь достаточно использовать leads как есть.
  const clients = leads;

  // Данные и фильтры
  const [projects, setProjects] = useState(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState(projects[0]?.id || null);
  const [activeBlockId, setActiveBlockId] = useState(projects[0]?.blocks?.[0]?.id || null);
  // Для ЖК с несколькими зданиями (Park Boulevard: 1,2,3,6,9,11) — выбор здания через
  // dropdown-кнопку; корпуса (A,B,C) выбранного здания показываются все разом, колонками.
  const [activeBuildingNumber, setActiveBuildingNumber] = useState<string | null>(null);
  const [buildingDropdownOpen, setBuildingDropdownOpen] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
    { value: 'FREE', label: 'Свободные' },
    { value: 'SOFT', label: 'Стандартная бронь' },
    { value: 'HARD', label: 'Хард бронь' },
    { value: 'CONTRACT_SIGNED', label: 'Договор подписан' },
    { value: 'SOLD', label: 'Продано / Оплачено' },
    { value: 'SERVICE', label: 'Служебное резервирование' },
    { value: 'NFS', label: 'Не для продажи (кладовка/офис)' },
  ];
  function toggleStatusFilterOption(value: string) {
    setStatusFilter(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  }
  function unitMatchesStatusCode(unit: any, code: string): boolean {
    switch (code) {
      case 'SOFT': return unit.status === 'SOFT_BOOKED' || unit.status === 'RESERVATION_ORAL';
      case 'HARD': return unit.status === 'HARD_BOOKED' || unit.status === 'RESERVATION_PAID';
      case 'SOLD': return unit.status === 'FULLY_PAID' || unit.status === 'SOLD';
      default: return unit.status === code;
    }
  }
  const [roomsFilter, setRoomsFilter] = useState<string[]>([]);
  const [roomsDropdownOpen, setRoomsDropdownOpen] = useState(false);
  const ROOMS_FILTER_OPTIONS = ['1', '2', '3', '4', '5+'];
  function toggleRoomsFilterOption(value: string) {
    setRoomsFilter(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  }
  const [priceFilter, setPriceFilter] = useState({ min: '', max: '' });
  const [areaFilter, setAreaFilter] = useState({ min: '', max: '' });

  // Состояния для массового изменения цен (CAT-007)
  // Массовое изменение цен перенесено на страницу /pricing
  const [priceHistory, setPriceHistory] = useState<any[]>([]);

  // UI Состояния
  const [selectedUnit, setSelectedUnit] = useState<any>(null);
  const [selectedUnitRooms, setSelectedUnitRooms] = useState<any[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [loading, setLoading] = useState(false);
  const [exchangeRate, setExchangeRate] = useState('2.70');
  // Карта активных акций по объектам организации (Модуль "Акции")
  // Опрашивается периодически (не только при монтировании), чтобы бейдж/цена сами
  // "гасли" по факту окончания акции, без ручной перезагрузки страницы.
  const [promoMap, setPromoMap] = useState<Record<string, any>>({});
  // Карта объектов с зафиксированной ценой (снапшот на "Договоре") — держится, даже когда
  // сама акция уже истекла, поэтому опрашивается отдельно и не зависит от promoMap.
  const [lockedDealMap, setLockedDealMap] = useState<Record<string, any>>({});
  useEffect(() => {
    async function loadPromotions() {
      const rows = await getLivePromotionsMap(organizationId);
      // rows отсортированы по startAt ASC — при пересечении акций на одном
      // помещении оставляем первую (самую раннюю), не перезаписываем более поздней.
      const map: Record<string, any> = {};
      rows.forEach((r: any) => { if (!map[r.unitId]) map[r.unitId] = r; });
      setPromoMap(map);

      const lockedRows = await getLockedUnitDealsMap(organizationId);
      const lockedMap: Record<string, any> = {};
      lockedRows.forEach((r: any) => { lockedMap[r.unitId] = r; });
      setLockedDealMap(lockedMap);
    }
    loadPromotions();
    const interval = setInterval(loadPromotions, 30000);
    return () => clearInterval(interval);
  }, [organizationId]);
  const [rateLoading, setRateLoading] = useState(true);
  const [panelTab, setPanelTab] = useState<'INFO' | 'DEAL' | 'CALC' | 'HISTORY'>('INFO');
  const [activeAccordions, setActiveAccordions] = useState<Record<string, boolean>>({
    info: true,
    deal: false,
    calc: false,
    history: false
  });

  const toggleAccordion = (key: string) => {
    setActiveAccordions(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // Досье привязанного клиента и история действий квартиры (Замечание аналитика)
  const [dossierLead, setDossierLead] = useState<any | null>(null);
  const [actionHistory, setActionHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);


  // Состояния для импорта Excel
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  // В файле заказчика нет колонки с названием ЖК (только корпус) — ЖК выбирается
  // здесь заранее, все строки файла импортируются в него.
  const [importProjectId, setImportProjectId] = useState('');
  const [importResult, setImportResult] = useState<any>(null);

  // Состояния для конструктора ЖК и корпусов
  const [showConstructorModal, setShowConstructorModal] = useState(false);
  const [constructorTab, setConstructorTab] = useState<'PROJECT' | 'BLOCK'>('PROJECT');
  const [newProjectData, setNewProjectData] = useState({
    name: '',
    code: '',
    address: '',
    description: '',
    expectedCompletionDate: ''
  });
  const [newBlockData, setNewBlockData] = useState({
    projectId: projects[0]?.id || '',
    blockNumber: '',
    floorCount: 10,
    entranceCount: 4,
    unitsPerFloorPerEntrance: 3,
    defaultArea: 60,
    defaultPricePerSqm: 1500,
    defaultRooms: 2,
    expectedCommissioningDate: ''
  });

  // Шаблоны квартир по позициям (idx) — для конструктора
  const [unitTemplates, setUnitTemplates] = useState<{ area: number; pricePerSqm: number; rooms: number }[]>([]);

  // Пересчитываем шаблоны при изменении кол-ва квартир на этаж/подъезд
  const syncTemplates = (count: number, defaults: { area: number; pricePerSqm: number; rooms: number }) => {
    setUnitTemplates(prev => {
      const next = [];
      for (let i = 0; i < count; i++) {
        next.push(prev[i] || { ...defaults });
      }
      return next;
    });
  };

  // Состояния для CAT-004 (CRUD)
  const [showCreateUnitModal, setShowCreateUnitModal] = useState(false);
  const [showEditUnitModal, setShowEditUnitModal] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState('');
  const [blocksList, setBlocksList] = useState<any[]>([]);
  const [layoutTab, setLayoutTab] = useState<'2d' | '3d'>('2d');
  const [editUnitData, setEditUnitData] = useState({
    number: '',
    floor: '',
    area: '',
    rooms: '',
    price: '',
    type: 'Apartment',
    viewType: '',
    livingArea: '',
    layoutUrl: '',
    layout3dUrl: '',
    balconyArea: '',
    contractNumber: '',
    deliveryYear: '',
    deliveryMonth: '',
    deliveryDate: '',
    registeredInPublicRegistry: false,
    availableForSale: true,
    pricePerSqmVAT: ''
  });

  const router = useRouter();

  // Загрузка курса валют
  useEffect(() => {
    async function loadExchangeRate() {
      try {
        setRateLoading(true);
        const rate = await getExchangeRate();
        setExchangeRate(rate.toString());
      } catch (error) {
        console.error('Failed to load exchange rate:', error);
        setExchangeRate('2.70');
      } finally {
        setRateLoading(false);
      }
    }
    loadExchangeRate();
  }, []);

  // Синхронизация локального стейта при изменении пропсов (например, после router.refresh())
  useEffect(() => {
    setProjects(initialProjects);
    if (selectedUnit) {
      let updatedUnit = null;
      for (const p of initialProjects) {
        for (const b of p.blocks || []) {
          const unit = b.units?.find((u: any) => u.id === selectedUnit.id);
          if (unit) {
            updatedUnit = unit;
            break;
          }
        }
        if (updatedUnit) break;
      }
      if (updatedUnit) {
        setSelectedUnit(updatedUnit);
      }
    }
  }, [initialProjects]);

  // Загрузка списка блоков для CRUD
  useEffect(() => {
    async function loadBlocks() {
      const blocks = await getBlocksForSelect(organizationId);
      setBlocksList(blocks);
    }
    loadBlocks();
  }, [organizationId]);

  // Автоматическое открытие карточки квартиры при переходе по ссылке (highlightUnitId)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const highlightUnitId = params.get('highlightUnitId');
    if (highlightUnitId && projects.length > 0) {
      let foundUnit = null;
      let foundBlockId = null;
      let foundProjectId = null;

      for (const p of projects) {
        for (const b of p.blocks || []) {
          const unit = b.units?.find((u: any) => u.id === highlightUnitId);
          if (unit) {
            foundUnit = unit;
            foundBlockId = b.id;
            foundProjectId = p.id;
            break;
          }
        }
        if (foundUnit) break;
      }

      if (foundUnit) {
        // Установим проект и корпус активными, чтобы пользователь видел подсветку в сетке
        setActiveProjectId(foundProjectId);
        setActiveBlockId(foundBlockId);
        // Откроем карточку квартиры
        handleUnitClick(foundUnit);
      }

      // Очищаем параметры URL, чтобы при обновлении страницы она не открывалась постоянно
      const url = new URL(window.location.href);
      url.searchParams.delete('highlightUnitId');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, [projects]);

  // Загрузка истории действий и связанного клиента по выбранной квартире (Замечание аналитика)
  useEffect(() => {
    async function loadUnitDetails() {
      if (selectedUnit) {
        setLoadingHistory(true);
        try {
          const [history, client] = await Promise.all([
            getUnitActionHistory(selectedUnit.id),
            getUnitAssociatedClient(selectedUnit.id)
          ]);
          setActionHistory(history);

          // Обновляем selectedUnit только если id совпадает (чтобы избежать гонки при быстром перекликивании)
          setSelectedUnit((prev: any) => {
            if (prev && prev.id === selectedUnit.id) {
              return {
                ...prev,
                associatedLeadId: client ? client.leadId : null,
                associatedLeadName: client ? client.leadName : null
              };
            }
            return prev;
          });
        } catch (err) {
          console.error(err);
        } finally {
          setLoadingHistory(false);
        }
      } else {
        setActionHistory([]);
      }
    }
    loadUnitDetails();
  }, [selectedUnit?.id]);

  // Обработчик открытия досье клиента по клику
  const handleOpenClientDossier = async (leadId: string) => {
    setLoading(true);
    try {
      const { getLeadById } = await import('@/app/actions/leads');
      const lead = await getLeadById(leadId);
      if (lead) {
        setDossierLead(lead);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Прямое скачивание паспорта квартиры в PDF на стороне клиента
  const handleDownloadPdfClient = async () => {
    if (!selectedUnit) return;
    setLoading(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');

      const element = document.getElementById('pdf-print-template');
      if (!element) {
        alert('Элемент для генерации PDF не найден');
        setLoading(false);
        return;
      }

      // Генерируем canvas с высокими параметрами рендеринга для четкости
      const canvas = await html2canvas(element, {
        scale: 2, // улучшает четкость в 2 раза
        useCORS: true, // разрешает загрузку сторонних картинок по ссылкам
        logging: false
      });

      const imgData = canvas.toDataURL('image/png');

      // Создаем A4 PDF-документ (210мм x 297мм)
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const imgWidth = 210; // Ширина A4
      const pageHeight = 297; // Высота A4
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      pdf.save(`Паспорт_Квартира_№${selectedUnit.number}_${currentProject?.name || 'ЖК'}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Ошибка при автоматическом скачивании PDF. Используйте печатную версию браузера.');
    } finally {
      setLoading(false);
    }
  };

  // Калькулятор рассрочки (новая система по ТЗ заказчика)
  const [calcDealId, setCalcDealId] = useState('');
  const [unitDeals, setUnitDeals] = useState<any[]>([]);
  const [calcScheduleType, setCalcScheduleType] = useState<'STANDARD' | 'CUSTOM'>('STANDARD');
  const [calcPeriodicity, setCalcPeriodicity] = useState<'MONTHLY' | 'QUARTERLY' | 'BIWEEKLY'>('MONTHLY');
  const [calcCustomFileUrl, setCalcCustomFileUrl] = useState('');
  const [calcDiscountApplyType, setCalcDiscountApplyType] = useState<'TOTAL_AREA' | 'PER_SQM'>('PER_SQM');
  const [calcDiscountAmount, setCalcDiscountAmount] = useState(0);
  const [calcNbgRate, setCalcNbgRate] = useState(2.7);
  // Как только реальный курс (НБГ) подгрузится — используем его как значение по умолчанию в калькуляторе
  useEffect(() => {
    const parsed = parseFloat(exchangeRate);
    if (!isNaN(parsed) && parsed > 0) setCalcNbgRate(parsed);
  }, [exchangeRate]);
  const [calcFirstPaymentDate, setCalcFirstPaymentDate] = useState('');
  const [calcFirstPaymentAmount, setCalcFirstPaymentAmount] = useState(0);
  const [calcRecurringAmount, setCalcRecurringAmount] = useState(0);
  const [calcLastPaymentAmount, setCalcLastPaymentAmount] = useState(0);
  const [calcAutoRow, setCalcAutoRow] = useState<'first' | 'recurring' | 'last'>('last');
  const [calcComment, setCalcComment] = useState('');
  const [calcResult, setCalcResult] = useState<InstallmentResult | null>(null);
  const [calcSaving, setCalcSaving] = useState(false);
  const [calcFullPaymentDate, setCalcFullPaymentDate] = useState('');
  const [calcCumulativeDiscount, setCalcCumulativeDiscount] = useState<any>(null);
  // Заготовка коллеги под будущий блок "Ипотека" в калькуляторе (по аналогии с карточкой
  // сделки на странице Сделки) — пока не подключена к UI/сохранению, оставлена как есть.
  const [calcMortgageBank, setCalcMortgageBank] = useState('');
  const [calcMortgageStatus, setCalcMortgageStatus] = useState<'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'>('NONE');
  // Накопительные скидки скрыты (см. Pricing.SHOW_LOYALTY_TAB) — механика не должна нигде
  // действовать, поэтому она отключена и здесь, а не только на вкладке в Ценообразовании.
  const SHOW_CUMULATIVE_DISCOUNT = false;
  // Сохранённый план рассрочки по выбранной сделке — если есть, вкладка калькулятора
  // превращается в read-only "План рассрочки" (см. loadSavedPlan ниже)
  const [savedPlan, setSavedPlan] = useState<any>(null);
  const [savedPlanLoading, setSavedPlanLoading] = useState(false);

  useEffect(() => {
    async function loadUnitDeals() {
      if (selectedUnit) {
        const list = await getActiveDealsForUnit(selectedUnit.id, organizationId);
        setUnitDeals(list);
        setCalcDealId(list[0]?.id || '');
      } else {
        setUnitDeals([]);
        setCalcDealId('');
      }
      // Сбрасываем расчёт при смене объекта
      setCalcResult(null);
      setCalcFirstPaymentDate('');
      setCalcFirstPaymentAmount(0);
      setCalcRecurringAmount(0);
      setCalcLastPaymentAmount(0);
      setCalcAutoRow('last');
      setCalcDiscountAmount(0);
      setCalcComment('');
      setCalcScheduleType('STANDARD');
    }
    loadUnitDeals();
  }, [selectedUnit, organizationId]);

  // Накопительная скидка клиента — зависит от того, какая сделка (какой клиент) выбрана в блоке "Объект"
  useEffect(() => {
    async function loadCumulative() {
      if (!SHOW_CUMULATIVE_DISCOUNT) { setCalcCumulativeDiscount(null); return; }
      const deal = unitDeals.find((d: any) => d.id === calcDealId);
      if (deal?.leadId) {
        const cumulative = await getApplicableCumulativeDiscount(deal.leadId, organizationId);
        setCalcCumulativeDiscount(cumulative);
      } else {
        setCalcCumulativeDiscount(null);
      }
    }
    loadCumulative();
  }, [calcDealId, unitDeals, organizationId]);

  // Уже сохранённый план по этой сделке — переключает вкладку в read-only режим
  useEffect(() => {
    async function loadSavedPlan() {
      if (!calcDealId) { setSavedPlan(null); return; }
      setSavedPlanLoading(true);
      const plan = await getInstallmentPlanForDeal(calcDealId, organizationId);
      setSavedPlan(plan);
      setSavedPlanLoading(false);
    }
    loadSavedPlan();
  }, [calcDealId, organizationId]);

  // Дата сдачи: своя у квартиры, иначе — тянем от даты сдачи ЖК
  const calcEffectiveDeliveryDate: string = selectedUnit
    ? (toDateInputValue(selectedUnit.deliveryDate) || (() => {
        const proj = projects.find((p: any) => p.id === activeProjectId);
        return toDateInputValue(proj?.expectedCompletionDate);
      })())
    : '';
  const calcUnitDelivered = calcEffectiveDeliveryDate ? isUnitDelivered(calcEffectiveDeliveryDate) : false;

  // Если объект сейчас в акции — калькулятор рассрочки берёт за базу акционную цену, а не обычную
  const calcActivePromo = selectedUnit ? promoMap[selectedUnit.id] : null;
  const calcUnitEffectivePricePerSqm: number = selectedUnit
    ? (calcActivePromo
        ? calcPromoPrice(selectedUnit.price, selectedUnit.area, calcActivePromo, calcActivePromo.nbgRate).promoPricePerSqmUSD
        : (selectedUnit.pricePerSqmVAT || (selectedUnit.price / selectedUnit.area)))
    : 0;

  // Итоговая цена "вживую" — для двусторонней конвертации $ ↔ % ещё до нажатия "Рассчитать"
  const calcLiveFinalPrice: number = selectedUnit
    ? calcFinalPrice(selectedUnit.area, calcUnitEffectivePricePerSqm, calcDiscountApplyType, calcDiscountAmount)
    : 0;
  // Накопительная скидка — применяется автоматически поверх итоговой цены
  const calcCumulativePercent = calcCumulativeDiscount?.discountPercent || 0;
  const calcFinalPriceWithCumulative = Math.round((calcLiveFinalPrice * (1 - calcCumulativePercent / 100)) * 100) / 100;
  // Индивидуальная скидка — пороги согласования по ролям.
  // Порог сверяется по СУММАРНОМУ эффекту: акция + индивидуальная + накопительная
  const calcBasePriceForDiscount = selectedUnit ? calcBasePrice(selectedUnit.area, calcUnitEffectivePricePerSqm) : 0;
  // Эффект самой акции — разница между каталожной ценой и ценой после акции (до индивидуальной скидки)
  const calcPromoDiscountPercent = selectedUnit && selectedUnit.price > 0
    ? Math.round(((selectedUnit.price - calcBasePriceForDiscount) / selectedUnit.price) * 1000) / 10
    : 0;
  const calcDiscountPercent = calcBasePriceForDiscount > 0
    ? Math.round(((calcBasePriceForDiscount - calcLiveFinalPrice) / calcBasePriceForDiscount) * 1000) / 10
    : 0;
  const calcCombinedDiscountPercent = Math.round((calcPromoDiscountPercent + calcDiscountPercent + calcCumulativePercent) * 10) / 10;
  // Менеджер: любая скидка уходит на согласование РОП, а не сохраняется напрямую —
  // порог его роли не должен блокировать кнопку (иначе отправить на согласование нечем).
  const calcDiscountAllowed = role === 'manager' ? true : canApplyDiscountPercent(role, calcCombinedDiscountPercent);
  const calcAutoDates = computeAutoScheduleDates(calcFirstPaymentDate, calcEffectiveDeliveryDate);
  const calcMonthsCount = Math.max(1, calcPeriodsCount(calcAutoDates.scheduleStartDate, calcAutoDates.scheduleEndDate, calcPeriodicity));
  // Стандартный тип выбран, но дата первого взноса ещё не указана — поля % показывают
  // 10/20/70 как подсказку (placeholder), а не реальное значение, до ввода даты.
  const calcShowStandardPlaceholder = calcScheduleType === 'STANDARD' && !calcFirstPaymentDate;

  function markCustom() {
    setCalcScheduleType('CUSTOM');
  }

  // ── Одна из трёх строк всегда авто-расчётная (по умолчанию — «Остаток»),
  // чтобы контрольная сумма всегда точно совпадала с итоговой ценой без ручных подгонок.
  function handleAutoRowChange(row: 'first' | 'recurring' | 'last') {
    setCalcAutoRow(row);
    markCustom();
  }

  // "Сырые" (введённые вручную) суммы двух не-авто строк, из которых считается авто-строка:
  const rawFirstAmount = calcFirstPaymentAmount;
  const rawRecurringTotal = calcRecurringAmount * calcMonthsCount;
  const rawLastAmount = calcLastPaymentAmount;

  let derivedFirstAmount = rawFirstAmount;
  let derivedRecurringAmount = calcRecurringAmount;
  let derivedLastAmount = rawLastAmount;

  if (calcAutoRow === 'first') {
    derivedFirstAmount = round2(calcLiveFinalPrice - rawRecurringTotal - rawLastAmount);
  } else if (calcAutoRow === 'recurring') {
    const residual = calcLiveFinalPrice - rawFirstAmount - rawLastAmount;
    derivedRecurringAmount = calcMonthsCount > 0 ? round2(residual / calcMonthsCount) : 0;
  } else {
    derivedLastAmount = round2(calcLiveFinalPrice - rawFirstAmount - rawRecurringTotal);
  }

  function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // Склонение "платёж/платежа/платежей" — периодичность в подписи не нужна, только количество
  function pluralizePayments(n: number): string {
    const abs = Math.abs(n);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} платёж`;
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${n} платежа`;
    return `${n} платежей`;
  }

  // Контролируемые number-инпуты с value=0 не дают стереть ноль бэкспейсом — React
  // тут же перерисовывает "0" обратно. Показываем пустую строку вместо нуля, пока поле
  // активно для ввода — тогда бэкспейс реально очищает поле. Для disabled-полей ноль
  // показываем как есть (просто светлее — см. .input:disabled), чтобы не выглядело пустым местом.
  function displayNum(v: number, disabled?: boolean): number | string {
    if (disabled) return v;
    return v === 0 ? '' : v;
  }

  const calcFirstPercent = calcLiveFinalPrice > 0 ? Math.round((derivedFirstAmount / calcLiveFinalPrice) * 1000) / 10 : 0;
  const calcRecurringTotalDerived = derivedRecurringAmount * calcMonthsCount;
  const calcRecurringPercent = calcLiveFinalPrice > 0 ? Math.round((calcRecurringTotalDerived / calcLiveFinalPrice) * 1000) / 10 : 0;
  const calcLastPercent = calcLiveFinalPrice > 0 ? Math.round((derivedLastAmount / calcLiveFinalPrice) * 1000) / 10 : 0;

  // ── Первый взнос: $ ↔ % (если строка сейчас авто — редактирование "забирает" её из авто и отдаёт auto-роль другой строке) ──
  function handleFirstAmountChange(v: number) {
    if (calcAutoRow === 'first') setCalcAutoRow('last');
    setCalcFirstPaymentAmount(v);
    markCustom();
  }
  function handleFirstPercentChange(pct: number) {
    if (calcAutoRow === 'first') setCalcAutoRow('last');
    setCalcFirstPaymentAmount(calcLiveFinalPrice > 0 ? Math.round((pct / 100) * calcLiveFinalPrice) : 0);
    markCustom();
  }

  // ── Периодический платёж: $ за платёж ↔ % от общей суммы за весь период ──
  function handleRecurringAmountChange(v: number) {
    if (calcAutoRow === 'recurring') setCalcAutoRow('first');
    setCalcRecurringAmount(v);
    markCustom();
  }
  function handleRecurringPercentChange(pct: number) {
    if (calcAutoRow === 'recurring') setCalcAutoRow('first');
    const totalForPeriod = (pct / 100) * calcLiveFinalPrice;
    setCalcRecurringAmount(calcMonthsCount > 0 ? Math.round(totalForPeriod / calcMonthsCount) : 0);
    markCustom();
  }

  // ── Остаток: $ ↔ % ──
  function handleLastAmountChange(v: number) {
    if (calcAutoRow === 'last') setCalcAutoRow('recurring');
    setCalcLastPaymentAmount(v);
    markCustom();
  }
  function handleLastPercentChange(pct: number) {
    if (calcAutoRow === 'last') setCalcAutoRow('recurring');
    setCalcLastPaymentAmount(calcLiveFinalPrice > 0 ? Math.round((pct / 100) * calcLiveFinalPrice) : 0);
    markCustom();
  }

  function handleRunCalculation() {
    if (!selectedUnit) return;
    const input = {
      area: selectedUnit.area,
      basePricePerSqm: calcUnitEffectivePricePerSqm,
      discountApplyType: calcDiscountApplyType,
      discountAmount: calcDiscountAmount,
      nbgRate: calcNbgRate,
      firstPaymentDate: calcFirstPaymentDate,
      firstPaymentAmount: derivedFirstAmount,
      recurringAmount: derivedRecurringAmount,
      periodicity: calcPeriodicity,
      deliveryDate: calcEffectiveDeliveryDate,
      lastPaymentAmount: derivedLastAmount,
    };
    const rawResult = calculateInstallmentPlan(input);
    // Накопительная скидка применяется здесь же, до показа результата на экране,
    // чтобы то, что видит менеджер, и то, что уйдёт в БД при сохранении, совпадали.
    setCalcResult(
      calcCumulativePercent > 0
        ? applyCumulativeDiscount(rawResult, calcCumulativePercent, calcNbgRate)
        : rawResult
    );
  }

  function handleApplyStandardPreset() {
    if (!selectedUnit || !calcFirstPaymentDate) {
      alert('Сначала укажите дату первого взноса.');
      return;
    }
    const { firstPaymentAmount, recurringAmount, lastPaymentAmount } = applyStandardPreset(
      calcLiveFinalPrice, calcFirstPaymentDate, calcEffectiveDeliveryDate, calcPeriodicity
    );
    setCalcFirstPaymentAmount(firstPaymentAmount);
    setCalcRecurringAmount(recurringAmount);
    setCalcLastPaymentAmount(lastPaymentAmount);
    setCalcAutoRow('last');
    setCalcScheduleType('STANDARD');
  }

  // Дата первого взноса: при Стандартном типе — сразу подтягивает пресет 10/20/70,
  // не переключая тип на Нестандартный (переключение — только если менеджер вручную
  // тронет суммы/проценты, см. markCustom в handleFirst/Recurring/LastAmountChange).
  function handleFirstPaymentDateChange(dateValue: string) {
    setCalcFirstPaymentDate(dateValue);
    if (calcScheduleType === 'STANDARD') {
      if (dateValue && calcEffectiveDeliveryDate) {
        const { firstPaymentAmount, recurringAmount, lastPaymentAmount } = applyStandardPreset(
          calcLiveFinalPrice, dateValue, calcEffectiveDeliveryDate, calcPeriodicity
        );
        setCalcFirstPaymentAmount(firstPaymentAmount);
        setCalcRecurringAmount(recurringAmount);
        setCalcLastPaymentAmount(lastPaymentAmount);
        setCalcAutoRow('last');
      }
    } else {
      markCustom();
    }
  }

  async function handleSaveInstallmentPlan() {
    if (!calcResult || !calcDealId) {
      alert('Выберите сделку и выполните расчёт перед сохранением.');
      return;
    }
    setCalcSaving(true);
    try {
      // calcResult уже включает накопительную скидку (см. handleRunCalculation) —
      // сохраняем ровно то, что показано на экране, без повторного пересчёта.
      const lastRow = calcResult.schedule[calcResult.schedule.length - 1];
      const res = await saveInstallmentPlanAction({
        dealId: calcDealId,
        scheduleType: calcScheduleType,
        periodicity: calcPeriodicity,
        basePriceUSD: calcResult.basePriceUSD,
        // Каталожная цена (до акции) — нужна серверу, чтобы порог согласования считался
        // по СУММАРНОМУ эффекту (акция + индивидуальная + накопительная), а не только по индивидуальной
        catalogPriceUSD: selectedUnit?.price || 0,
        discountApplyType: calcDiscountApplyType,
        discountAmountUSD: calcResult.discountTotalUSD,
        finalPriceUSD: calcResult.finalPriceUSD,
        nbgRate: calcNbgRate,
        firstPaymentDate: calcFirstPaymentDate,
        firstPaymentPercent: calcFirstPercent,
        scheduleStartDate: calcResult.scheduleStartDate,
        scheduleEndDate: calcResult.scheduleEndDate,
        recurringAmountUSD: derivedRecurringAmount,
        lastPaymentDate: calcResult.lastPaymentDate,
        lastPaymentAmountUSD: lastRow?.amountUSD ?? 0,
        lastPaymentPercent: calcLastPercent,
        installmentComment: calcComment,
        customScheduleFileUrl: calcCustomFileUrl,
        schedule: calcResult.schedule,
        organizationId,
        initiatorId: managerId,
      });
      if (res.success) {
        alert((res as any).pendingApproval
          ? 'Скидка отправлена на согласование руководителю ОП. График будет сохранён после подтверждения.'
          : 'График рассрочки сохранён и привязан к сделке.');
        if (!(res as any).pendingApproval) {
          const plan = await getInstallmentPlanForDeal(calcDealId, organizationId);
          setSavedPlan(plan);
        }
      } else {
        alert('Ошибка сохранения: ' + (res.error || ''));
      }
    } finally {
      setCalcSaving(false);
    }
  }

  function handleFullPaymentSave() {
    if (!selectedUnit || !calcDealId || !calcFullPaymentDate) {
      alert('Выберите сделку и дату платежа.');
      return;
    }
    setCalcSaving(true);
    saveInstallmentPlanAction({
      dealId: calcDealId,
      scheduleType: 'STANDARD',
      periodicity: 'MONTHLY',
      basePriceUSD: selectedUnit.price,
      discountApplyType: 'PER_SQM',
      discountAmountUSD: 0,
      finalPriceUSD: selectedUnit.price,
      nbgRate: calcNbgRate,
      firstPaymentDate: calcFullPaymentDate,
      firstPaymentPercent: 100,
      scheduleStartDate: '',
      scheduleEndDate: '',
      recurringAmountUSD: 0,
      lastPaymentDate: calcFullPaymentDate,
      lastPaymentAmountUSD: 0,
      lastPaymentPercent: 0,
      installmentComment: 'Полная оплата (объект сдан)',
      schedule: [{ date: calcFullPaymentDate, amountUSD: selectedUnit.price, amountGEL: Math.round(selectedUnit.price * calcNbgRate) }],
      organizationId,
      initiatorId: managerId,
    }).then(async res => {
      alert(res.success ? 'Платёж сохранён.' : 'Ошибка: ' + (res.error || ''));
      if (res.success) {
        const plan = await getInstallmentPlanForDeal(calcDealId, organizationId);
        setSavedPlan(plan);
      }
    }).finally(() => setCalcSaving(false));
  }

  // Состояния для бронирования (SOFT, HARD, SERVICE)
  const [bookingType, setBookingType] = useState<'SOFT' | 'HARD' | 'SERVICE'>('SOFT');
  // Стандартная бронь теперь всегда на фиксированный срок — 2 дня (см. onBook), без выбора длительности.
  const SOFT_BOOKING_HOURS = 48;
  const [hardDuration, setHardDuration] = useState('14'); // days
  const [customHardDateTime, setCustomHardDateTime] = useState('');

  // Лист ожидания
  const [waitingList, setWaitingList] = useState<any[]>([]);
  const [wlLeadId, setWlLeadId] = useState('');
  const [wlSubmitting, setWlSubmitting] = useState(false);

  useEffect(() => {
    async function loadWaitingList() {
      if (selectedUnit) {
        const list = await getWaitingListAction(selectedUnit.id, organizationId);
        setWaitingList(list);
      } else {
        setWaitingList([]);
      }
    }
    loadWaitingList();
  }, [selectedUnit, organizationId]);

  // Текущее время для обратного отсчета
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, []);

  const getRemainingTime = (expiresAtStr?: string) => {
    if (!expiresAtStr) return '00:00';
    const expiresAt = new Date(expiresAtStr).getTime();
    const diffMs = expiresAt - now;
    if (diffMs <= 0) return '00:00';

    const diffMinsTotal = Math.max(0, Math.floor(diffMs / 60000));
    const hours = Math.floor(diffMinsTotal / 60);
    const mins = diffMinsTotal % 60;

    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  // SSE (Real-time обновления)
  useEffect(() => {
    const eventSource = new EventSource('/api/stream');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'STATUS_CHANGED') {
        setProjects(prevProjects => {
          const newProjects = [...prevProjects];
          for (let p of newProjects) {
            for (let b of p.blocks || []) {
              const unit = b.units?.find((u: any) => u.id === data.unitId);
              if (unit) {
                unit.status = data.newStatus;
                unit.version = (unit.version || 0) + 1;
              }
            }
          }
          return newProjects;
        });
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  async function handleCalcFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      const res = await response.json();
      if (res.success && res.url) {
        setCalcCustomFileUrl(res.url);
      } else {
        alert('Ошибка при загрузке: ' + (res.error || 'Неизвестная ошибка'));
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при загрузке файла');
    }
  }

  // Обработка клика по квартире
  const handleUnitClick = async (unit: any) => {
    setSelectedUnit(unit);
    setSelectedUnitRooms([]);
    setLayoutTab('2d');
    
    // Загружаем комнаты
    getUnitRooms(unit.id).then(rooms => {
      setSelectedUnitRooms(rooms);
    }).catch(e => console.error('Ошибка загрузки комнат:', e));

    fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionName: `Пользователь открыл карточку квартиры №${unit.number}`,
        details: { unitId: unit.id, floor: unit.floor, area: unit.area, price: unit.price }
      })
    }).catch(() => {});
    setPanelTab('INFO');
    setActiveAccordions({
      info: true,
      deal: false,
      calc: false,
      history: false
    });
    setPriceHistory([]);
    setCalcFirstPaymentAmount(Math.round(unit.price * 0.1));
    if (clients.length > 0) setSelectedLeadId(clients[0].id);
    setBookingType('SOFT');
    setHardDuration('14');
  };

  // Закрыть side-panel
  const closePanel = () => {
    if (selectedUnit) {
      fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionName: `Пользователь закрыл карточку квартиры №${selectedUnit.number}`,
          details: { unitId: selectedUnit.id }
        })
      }).catch(() => {});
    }
    setSelectedUnit(null);
    setSelectedUnitRooms([]);
    setPriceHistory([]);

    // Если есть backToLeadId / backToContractId в URL, возвращаемся назад с автооткрытием
    const params = new URLSearchParams(window.location.search);
    const backToLeadId = params.get('backToLeadId');
    const backToContractId = params.get('backToContractId');
    if (backToLeadId) {
      router.push(`/clients?openLeadId=${backToLeadId}`);
    } else if (backToContractId) {
      router.push(`/contracts?openContractId=${backToContractId}`);
    }
  };

  // Загрузка истории цен квартиры (CAT-006)
  const loadUnitPriceHistory = async () => {
    if (!selectedUnit) return;
    const history = await getPriceHistory(selectedUnit.id);
    setPriceHistory(history);
  };

  // ========== CAT-004: CRUD операции ==========

  // Создание квартиры
  const handleCreateUnit = async () => {
    if (!selectedBlockId) {
      alert('Выберите корпус');
      return;
    }

    const unitData = {
      number: editUnitData.number,
      floor: parseInt(editUnitData.floor),
      area: parseFloat(editUnitData.area),
      rooms: parseInt(editUnitData.rooms),
      price: parseFloat(editUnitData.price),
      type: editUnitData.type,
      viewType: editUnitData.viewType || undefined,
      livingArea: editUnitData.livingArea ? parseFloat(editUnitData.livingArea) : undefined,
      layoutUrl: editUnitData.layoutUrl || undefined,
      layout3dUrl: editUnitData.layout3dUrl || undefined,
      balconyArea: editUnitData.balconyArea ? parseFloat(editUnitData.balconyArea) : undefined,
      contractNumber: editUnitData.contractNumber || undefined,
      deliveryYear: editUnitData.deliveryYear ? parseInt(editUnitData.deliveryYear) : undefined,
      deliveryMonth: editUnitData.deliveryMonth ? parseInt(editUnitData.deliveryMonth) : undefined,
      deliveryDate: editUnitData.deliveryDate || undefined,
      registeredInPublicRegistry: editUnitData.registeredInPublicRegistry,
      availableForSale: editUnitData.availableForSale,
      pricePerSqmVAT: editUnitData.pricePerSqmVAT ? parseFloat(editUnitData.pricePerSqmVAT) : undefined,
      blockId: selectedBlockId,
      organizationId,
      createdById: organizationId
    };

    if (!unitData.number || !unitData.floor || !unitData.area || !unitData.rooms || !unitData.price) {
      alert('Заполните все обязательные поля');
      return;
    }

    setLoading(true);
    const res = await createUnit(unitData);
    if (res.success) {
      alert(' Квартира успешно создана');
      setShowCreateUnitModal(false);
      setEditUnitData({ number: '', floor: '', area: '', rooms: '', price: '', type: 'Apartment', viewType: '', livingArea: '', layoutUrl: '', layout3dUrl: '', balconyArea: '', contractNumber: '', deliveryYear: '', deliveryMonth: '', deliveryDate: '', registeredInPublicRegistry: false, availableForSale: true, pricePerSqmVAT: '' });
      router.refresh();
    } else {
      alert(' Ошибка: ' + res.error);
    }
    setLoading(false);
  };

  // Обновление квартиры
  const handleUpdateUnit = async () => {
    const reason = prompt('Укажите причину изменения:', 'Редактирование карточки квартиры');
    if (!reason) return;

    const updates: any = { unitId: selectedUnit.id, reason, organizationId, initiatorId: organizationId };

    if (editUnitData.number && editUnitData.number !== selectedUnit.number.toString()) updates.number = editUnitData.number;
    if (editUnitData.floor && parseInt(editUnitData.floor) !== selectedUnit.floor) updates.floor = parseInt(editUnitData.floor);
    if (editUnitData.area && parseFloat(editUnitData.area) !== selectedUnit.area) updates.area = parseFloat(editUnitData.area);
    if (editUnitData.rooms && parseInt(editUnitData.rooms) !== selectedUnit.rooms) updates.rooms = parseInt(editUnitData.rooms);
    if (editUnitData.price && parseFloat(editUnitData.price) !== selectedUnit.price) updates.price = parseFloat(editUnitData.price);
    if (editUnitData.type !== selectedUnit.type) updates.type = editUnitData.type;
    if (editUnitData.viewType !== (selectedUnit.viewType || '')) updates.viewType = editUnitData.viewType || null;
    if (editUnitData.livingArea && parseFloat(editUnitData.livingArea) !== (selectedUnit.livingArea || 0)) updates.livingArea = parseFloat(editUnitData.livingArea);
    if (editUnitData.layoutUrl !== (selectedUnit.layoutUrl || '')) updates.layoutUrl = editUnitData.layoutUrl || null;
    if (editUnitData.layout3dUrl !== (selectedUnit.layout3dUrl || '')) updates.layout3dUrl = editUnitData.layout3dUrl || null;
    if (editUnitData.balconyArea !== (selectedUnit.balconyArea?.toString() || '')) updates.balconyArea = editUnitData.balconyArea ? parseFloat(editUnitData.balconyArea) : null;
    if (editUnitData.contractNumber !== (selectedUnit.contractNumber || '')) updates.contractNumber = editUnitData.contractNumber || null;
    if (editUnitData.deliveryYear !== (selectedUnit.deliveryYear?.toString() || '')) updates.deliveryYear = editUnitData.deliveryYear ? parseInt(editUnitData.deliveryYear) : null;
    if (editUnitData.deliveryMonth !== (selectedUnit.deliveryMonth?.toString() || '')) updates.deliveryMonth = editUnitData.deliveryMonth ? parseInt(editUnitData.deliveryMonth) : null;
    if (editUnitData.deliveryDate !== (selectedUnit.deliveryDate || '')) updates.deliveryDate = editUnitData.deliveryDate || null;
    if (editUnitData.registeredInPublicRegistry !== !!selectedUnit.registeredInPublicRegistry) updates.registeredInPublicRegistry = editUnitData.registeredInPublicRegistry;
    if (editUnitData.availableForSale !== (selectedUnit.availableForSale ?? true)) updates.availableForSale = editUnitData.availableForSale;
    if (editUnitData.pricePerSqmVAT !== (selectedUnit.pricePerSqmVAT?.toString() || '')) updates.pricePerSqmVAT = editUnitData.pricePerSqmVAT ? parseFloat(editUnitData.pricePerSqmVAT) : null;

    setLoading(true);
    const res = await updateUnit(updates);
    if (res.success) {
      alert(` Квартира обновлена\nИзменения: ${res.changes?.join(', ')}`);
      setShowEditUnitModal(false);
      router.refresh();
      closePanel();
    } else {
      alert(' Ошибка: ' + res.error);
    }
    setLoading(false);
  };

  // Удаление квартиры (мягкое)
  const handleDeleteUnit = async () => {
    const reason = prompt('Укажите причину исключения квартиры из продаж:', 'Исключена из плана продаж');
    if (!reason) return;

    const confirmed = confirm('ВНИМАНИЕ! Квартира будет исключена из продаж (статус EXCLUDED). Это действие нельзя отменить через интерфейс. Продолжить?');
    if (!confirmed) return;

    setLoading(true);
    const res = await deleteUnit(selectedUnit.id, reason, organizationId, organizationId);
    if (res.success) {
      alert(' Квартира исключена из продаж');
      closePanel();
      router.refresh();
    } else {
      alert(' Ошибка: ' + res.error);
    }
    setLoading(false);
  };

  // Конструктор ЖК - отправка формы
  const handleCreateProject = async () => {
    if (!newProjectData.name || !newProjectData.code) {
      alert('Укажите название и код ЖК!');
      return;
    }
    setLoading(true);
    const res = await createProjectAction({
      ...newProjectData,
      organizationId
    });
    setLoading(false);
    if (res.success) {
      alert(' ЖК успешно создан!');
      setNewProjectData({ name: '', code: '', address: '', description: '', expectedCompletionDate: '' });
      setConstructorTab('BLOCK');
      // Обновляем id проекта для создания корпуса
      setNewBlockData(prev => ({ ...prev, projectId: res.projectId || '' }));
      router.refresh();
    } else {
      alert(' Ошибка: ' + res.error);
    }
  };

  // Конструктор корпуса - генерация шахматки
  const handleGenerateBlock = async () => {
    if (!newBlockData.projectId || !newBlockData.blockNumber) {
      alert('Заполните обязательные поля (ЖК и номер/код корпуса)!');
      return;
    }
    setLoading(true);
    const res = await generateBlockAndUnitsAction({
      ...newBlockData,
      organizationId,
      unitTemplates: unitTemplates.length > 0 ? unitTemplates : undefined
    });
    setLoading(false);
    if (res.success) {
      alert(' Корпус создан, шахматка сгенерирована!');
      setShowConstructorModal(false);

      // Автоматически переключимся на сгенерированный ЖК и корпус
      setActiveProjectId(newBlockData.projectId);
      setActiveBlockId(res.blockId || null);

      setNewBlockData({
        projectId: newBlockData.projectId,
        blockNumber: '',
        floorCount: 10,
        entranceCount: 4,
        unitsPerFloorPerEntrance: 3,
        defaultArea: 60,
        defaultPricePerSqm: 1500,
        defaultRooms: 2,
        expectedCommissioningDate: ''
      });
      setUnitTemplates([]);
      router.refresh();
    } else {
      alert(' Ошибка: ' + res.error);
    }
  };

  // Открытие формы редактирования
  const openEditModal = () => {
    if (!selectedUnit) return;
    setEditUnitData({
      number: selectedUnit.number?.toString() || '',
      floor: selectedUnit.floor?.toString() || '',
      area: selectedUnit.area?.toString() || '',
      rooms: selectedUnit.rooms?.toString() || '',
      price: selectedUnit.price?.toString() || '',
      type: selectedUnit.type || 'Apartment',
      viewType: selectedUnit.viewType || '',
      livingArea: selectedUnit.livingArea?.toString() || '',
      layoutUrl: selectedUnit.layoutUrl || '',
      layout3dUrl: selectedUnit.layout3dUrl || '',
      balconyArea: selectedUnit.balconyArea?.toString() || '',
      contractNumber: selectedUnit.contractNumber || '',
      deliveryYear: selectedUnit.deliveryYear?.toString() || '',
      deliveryMonth: selectedUnit.deliveryMonth?.toString() || '',
      deliveryDate: selectedUnit.deliveryDate ? selectedUnit.deliveryDate.slice(0, 10) : '',
      registeredInPublicRegistry: !!selectedUnit.registeredInPublicRegistry,
      availableForSale: selectedUnit.availableForSale ?? true,
      pricePerSqmVAT: selectedUnit.pricePerSqmVAT?.toString() || ''
    });
    setShowEditUnitModal(true);
  };

  // Загрузка файла планировки
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, mode: 'create' | 'edit', field: 'layoutUrl' | 'layout3dUrl' = 'layoutUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setLoading(true);
    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const res = await response.json();
      if (res.success && res.url) {
        setEditUnitData(prev => ({
          ...prev,
          [field]: res.url
        }));
        alert(' Файл успешно загружен и прикреплен!');
      } else {
        alert(' Ошибка при загрузке: ' + (res.error || 'Неизвестная ошибка'));
      }
    } catch (err: any) {
      console.error(err);
      alert(' Ошибка сети при загрузке файла');
    } finally {
      setLoading(false);
    }
  };

  // ========== Импорт из Excel ==========
  const handleImport = async () => {
    if (!importFile) {
      alert('Выберите файл Excel');
      return;
    }
    if (!importProjectId) {
      alert('Выберите ЖК, в который импортировать квартиры');
      return;
    }

    setLoading(true);
    setImportResult(null);
    const formData = new FormData();
    formData.append('file', importFile);

    const res = await importUnitsFromExcel(formData, organizationId, organizationId, importProjectId);

    if (res.success) {
      alert(` Импорт завершен!\n Добавлено: ${res.imported}\n Обновлено: ${res.updated}\n Всего строк: ${res.total}\n${res.errors ? ` Ошибок: ${res.errors.length}` : ''}`);
      router.refresh();
      setShowImportModal(false);
      setImportFile(null);
      setImportProjectId('');
      setImportResult(null);
    } else {
      alert(' Ошибка импорта: ' + res.error);
      setImportResult(res);
    }
    setLoading(false);
  };

  // Скачивание шаблона Excel — колонки как в реальной выгрузке заказчика (лист
  // "Products"). "#" и "PTD" приняты в шаблоне по их просьбе, но не идут в базу —
  // у нас нет для них соответствующих полей (см. import.ts).
  const downloadTemplate = () => {
    try {
      const template = [
        { '#': 1, 'Building/Block': '6A', Floor: 1, '№ Flat': '1', PTD: 1, Status: 'Available', Rooms: '1 Rooms Studio', 'Area (sq meters)': 45.5, 'Living Area (sq meters)': 42.1, 'Balcony (sq meters)': 3.4, 'Contract #': '', Year: 2028, Month: 1, Date: '15.06.2026', 'Registration in the Public Registry': 'No', 'Available for sale': 'Yes', 'Price Incl. VAT (Sq meters/$)': 1180, 'Full Price ($)': 180000 },
        { '#': 2, 'Building/Block': '6A', Floor: 1, '№ Flat': '2', PTD: 2, Status: 'Available', Rooms: 'Commercial', 'Area (sq meters)': 65.2, 'Living Area (sq meters)': 65.2, 'Balcony (sq meters)': 0, 'Contract #': '', Year: 2028, Month: 1, Date: '15.06.2026', 'Registration in the Public Registry': 'No', 'Available for sale': 'Yes', 'Price Incl. VAT (Sq meters/$)': 1000, 'Full Price ($)': 250000 }
      ];
      const worksheet = XLSX.utils.json_to_sheet(template);
      worksheet['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 6 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
      XLSX.writeFile(workbook, 'import_template.xlsx');
    } catch (error) {
      console.error('Error downloading template:', error);
      alert('Ошибка при скачивании шаблона');
    }
  };

  // Бронирование
  const onBook = async () => {
    if (!selectedLeadId) return alert('Выберите клиента!');
    if (bookingType === 'HARD' && hardDuration === 'CUSTOM' && !customHardDateTime) {
      return alert('Выберите дату и время окончания платной брони на календаре!');
    }
    setLoading(true);

    const duration = bookingType === 'SOFT'
      ? SOFT_BOOKING_HOURS
      : (bookingType === 'HARD' && hardDuration !== 'CUSTOM' ? Number(hardDuration) : 0);

    const customExpiresAt = bookingType === 'HARD' && hardDuration === 'CUSTOM' ? new Date(customHardDateTime) : undefined;

    const res = await createBooking({
      leadId: selectedLeadId,
      unitId: selectedUnit.id,
      organizationId,
      type: bookingType,
      duration: duration,
      customExpiresAt: customExpiresAt
    });

    if (res.success) {
      setSelectedUnit(null);
      alert(' Объект успешно забронирован!');
      router.refresh();
    } else {
      alert(' Ошибка: ' + (res.message || 'Не удалось выполнить бронирование.'));
    }
    setLoading(false);
  };

  // Снятие бронирования
  const onReleaseBook = async () => {
    const confirmed = confirm('Вы уверены, что хотите снять бронирование с этого объекта?');
    if (!confirmed) return;

    setLoading(true);
    const res = await releaseBooking({
      unitId: selectedUnit.id,
      organizationId,
      userRole
    });

    if (res.success) {
      setSelectedUnit(null);
      alert('Бронирование успешно снято.');
      router.refresh();
    } else {
      alert('Ошибка: ' + (res.message || 'Не удалось снять бронирование.'));
    }
    setLoading(false);
  };

  // Расторжение договора (см. "Расторжение договора.pdf") — только для проданных объектов.
  // Не трогает сделку, не создаёт денежных операций — только статус юнита и приостановка
  // ещё не оплаченных платежей графика (реализация — units.ts, terminateUnitContract).
  const onTerminateContract = async () => {
    const confirmed = confirm(
      'Расторгнуть договор по этому помещению? Помещение станет свободным, ещё не оплаченные платежи по графику будут приостановлены. Сделка не изменится, деньги не возвращаются автоматически.'
    );
    if (!confirmed) return;

    setLoading(true);
    const res = await terminateUnitContract(selectedUnit.id, organizationId, managerId);

    if (res.success) {
      setSelectedUnit(null);
      alert(
        res.pausedPaymentsCount
          ? `Договор расторгнут. Приостановлено платежей по графику: ${res.pausedPaymentsCount}.`
          : 'Договор расторгнут.'
      );
      router.refresh();
    } else {
      alert('Ошибка: ' + (res.message || 'Не удалось расторгнуть договор.'));
    }
    setLoading(false);
  };

  const handleAddToQueue = async () => {
    if (!selectedUnit || !wlLeadId) return;
    setWlSubmitting(true);
    const res = await addToWaitingListAction({
      unitId: selectedUnit.id,
      leadId: wlLeadId,
      organizationId
    });
    setWlSubmitting(false);
    if (res.success) {
      setWlLeadId('');
      // Reload queue
      const list = await getWaitingListAction(selectedUnit.id, organizationId);
      setWaitingList(list);
    } else {
      alert(res.message || 'Не удалось добавить в очередь.');
    }
  };

  const handleRemoveFromQueue = async (waitingListId: string) => {
    const confirmed = confirm('Вы уверены, что хотите убрать клиента из листа ожидания?');
    if (!confirmed) return;

    setWlSubmitting(true);
    const res = await removeFromWaitingListAction({
      waitingListId,
      organizationId
    });
    setWlSubmitting(false);
    if (res.success) {
      // Reload queue
      if (selectedUnit) {
        const list = await getWaitingListAction(selectedUnit.id, organizationId);
        setWaitingList(list);
      }
    } else {
      alert(res.message || 'Не удалось убрать из очереди.');
    }
  };

  // Helper: Получение стилей по статусу
  const getStatusClass = (status: string) => {
    switch (status) {
      case 'FREE': return styles.free;
      case 'SOFT_BOOKED': return styles.softBooked;
      case 'RESERVATION_ORAL': return styles.softBooked;
      case 'HARD_BOOKED': return styles.hardBooked;
      case 'RESERVATION_PAID': return styles.hardBooked;
      case 'CONTRACT_SIGNED': return styles.contractSigned;
      case 'DOWN_PAYMENT_RECEIVED': return styles.downPayment;
      case 'FULLY_PAID': return styles.fullyPaid;
      case 'SOLD': return styles.fullyPaid;
      case 'SERVICE': return styles.service;
      case 'NFS': return styles.excluded;
      case 'EXCLUDED': return styles.excluded;
      default: return styles.free;
    }
  };

  const getStatusName = (status: string) => {
    switch (status) {
      case 'FREE': return 'Свободна';
      case 'SOFT_BOOKED': return 'Стандартная бронь';
      case 'RESERVATION_ORAL': return 'Стандартная бронь';
      case 'HARD_BOOKED': return 'Хард бронь';
      case 'RESERVATION_PAID': return 'Хард бронь';
      case 'CONTRACT_SIGNED': return 'Договор подписан';
      case 'DOWN_PAYMENT_RECEIVED': return 'Взнос оплачен';
      case 'FULLY_PAID': return 'Полная оплата';
      case 'SOLD': return 'Продано';
      case 'SERVICE': return 'Служебная';
      case 'NFS': return 'Не для продажи';
      case 'EXCLUDED': return 'Исключена';
      default: return 'Свободна';
    }
  };

  const currentProject = projects.find(p => p.id === activeProjectId);

  // Есть ли у текущего ЖК деление на здания (buildingNumber на блоках) — сейчас только
  // у Park Boulevard. У остальных ЖК ничего не меняем — старое плоское поведение.
  const projectHasBuildings = !!currentProject?.blocks?.some((b: any) => b.buildingNumber);
  const buildingNumbers: string[] = projectHasBuildings
    ? (Array.from(new Set(currentProject!.blocks.map((b: any) => b.buildingNumber).filter(Boolean))) as string[])
        .sort((a: string, b: string) => Number(a) - Number(b))
    : [];
  const effectiveBuildingNumber = projectHasBuildings
    ? (activeBuildingNumber && buildingNumbers.includes(activeBuildingNumber) ? activeBuildingNumber : buildingNumbers[0])
    : null;
  // Все корпуса выбранного здания (A, B, C по порядку) — показываются одновременно, колонками.
  const visibleBlocks = projectHasBuildings
    ? (currentProject?.blocks || [])
        .filter((b: any) => b.buildingNumber === effectiveBuildingNumber)
        .sort((a: any, b: any) => String(a.number).localeCompare(String(b.number)))
    : [];

  const currentBlock = currentProject?.blocks?.find((b: any) => b.id === activeBlockId);

  // Сборка этажей и квартир (Замечание аналитика - группировка по подъездам)
  // — старое поведение "один блок за раз", используется только когда у ЖК нет зданий.
  const unitsByFloor: Record<number, any[]> = {};
  currentBlock?.units?.forEach((unit: any) => {
    if (!unitsByFloor[unit.floor]) unitsByFloor[unit.floor] = [];
    unitsByFloor[unit.floor].push(unit);
  });

  // Сортируем квартиры на каждом этаже по подъезду, а внутри подъезда по номеру квартиры
  Object.keys(unitsByFloor).forEach(floorStr => {
    const f = Number(floorStr);
    unitsByFloor[f].sort((a, b) => {
      const entA = a.entrance || 1;
      const entB = b.entrance || 1;
      if (entA !== entB) return entA - entB;
      return String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
    });
  });

  const floors = Object.keys(unitsByFloor).map(Number).sort((a, b) => b - a);

  // Для зданий (Park Boulevard): квартиры сразу всех видимых корпусов, сгруппированные
  // по этажу и по корпусу — рисуем колонками рядом друг с другом, как на скриншоте AS Group.
  const buildingUnitsByFloor: Record<number, Record<string, any[]>> = {};
  if (projectHasBuildings) {
    visibleBlocks.forEach((block: any) => {
      (block.units || []).forEach((unit: any) => {
        if (!buildingUnitsByFloor[unit.floor]) buildingUnitsByFloor[unit.floor] = {};
        if (!buildingUnitsByFloor[unit.floor][block.id]) buildingUnitsByFloor[unit.floor][block.id] = [];
        buildingUnitsByFloor[unit.floor][block.id].push(unit);
      });
    });
    Object.values(buildingUnitsByFloor).forEach(byBlock => {
      Object.values(byBlock).forEach((list: any) => {
        list.sort((a: any, b: any) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
      });
    });
  }
  const buildingFloors = projectHasBuildings
    ? Object.keys(buildingUnitsByFloor).map(Number).sort((a, b) => b - a)
    : [];

  // Ширина колонки каждого корпуса — фиксированная, по САМОМУ ШИРОКОМУ этажу этого
  // корпуса. Иначе на этажах, где в корпусе меньше квартир (например -1/-2), колонка
  // сжимается и все заголовки/колонки правее съезжают влево относительно других этажей.
  const UNIT_W = 180;
  const UNIT_GAP = 6;
  const blockColumnWidth = (block: any): number => {
    const maxCount = Math.max(
      1,
      ...buildingFloors.map(f => ((buildingUnitsByFloor[f] && buildingUnitsByFloor[f][block.id]) || []).length)
    );
    return maxCount * UNIT_W + (maxCount - 1) * UNIT_GAP;
  };

  // Проверка фильтров
  const isFilteredOut = (unit: any) => {
    if (statusFilter.length > 0) {
      if (!statusFilter.some(code => unitMatchesStatusCode(unit, code))) return true;
    }

    if (roomsFilter.length > 0) {
      const matches = roomsFilter.some(f => {
        if (f === '5+') return unit.rooms >= 5;
        return unit.rooms?.toString() === f;
      });
      if (!matches) return true;
    }

    if (priceFilter.min && unit.price < Number(priceFilter.min)) return true;
    if (priceFilter.max && unit.price > Number(priceFilter.max)) return true;
    if (areaFilter.min && unit.area < Number(areaFilter.min)) return true;
    if (areaFilter.max && unit.area > Number(areaFilter.max)) return true;
    return false;
  };

  // Статистика
  const stats = useMemo(() => {
    let free = 0, soft = 0, hard = 0, sold = 0;
    currentBlock?.units?.forEach((u: any) => {
      if (u.status === 'FREE') free++;
      if (['SOFT_BOOKED', 'RESERVATION_ORAL'].includes(u.status)) soft++;
      if (['HARD_BOOKED', 'RESERVATION_PAID'].includes(u.status)) hard++;
      if (['FULLY_PAID', 'SOLD', 'CONTRACT_SIGNED', 'DOWN_PAYMENT_RECEIVED'].includes(u.status)) sold++;
    });
    return { free, soft, hard, sold, total: currentBlock?.units?.length || 0 };
  }, [currentBlock]);

  if (!projects || projects.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <h3>Нет проектов для отображения</h3>
          <p>В базе данных пока нет ни одного жилого комплекса.</p>
          <button className={styles.createDemoBtn} onClick={async () => {
            const res = await createDemoProject(organizationId);
            if(res.success) router.refresh();
          }}>Создать демо-проект "Астана Тауэр"</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Основной контент - сдвигается когда открыт side-panel */}
      <div className={`${styles.mainContent} ${selectedUnit ? styles.mainContentShifted : ''}`}>
        <header className={styles.header}>
          <div className={styles.titleArea}>
            <h1>Шахматка</h1>
            <p>Курс: {rateLoading ? 'Загрузка...' : `${exchangeRate} ₾/$`}</p>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {canUnits && <button className={styles.importBtn} onClick={() => setShowImportModal(true)}>Импорт Excel</button>}
            {canUnits && (
              <button
                className={styles.massPriceBtn}
                style={{ background: '#f8fafc', color: '#0f172a', border: '1.5px solid #cbd5e1' }}
                onClick={() => router.push('/shakhmatka/constructor')}
              >
                Конструктор ЖК
              </button>
            )}
            {canUnits && (
              <button
                className={styles.massPriceBtn}
                style={{ background: '#f8fafc', color: '#0f172a', border: '1.5px solid #cbd5e1' }}
                onClick={() => setShowCreateUnitModal(true)}
              >
                Новое помещение
              </button>
            )}
          </div>
        </header>

        {/* Статистика */}
        <div className={styles.statsRow}>
          <div className={styles.statMini}><div className={styles.statNum}>{stats.total}</div><div className={styles.statLabel}>Всего</div></div>
          <div className={styles.statMini}><div className={styles.statNum} style={{color:'#16a34a'}}>{stats.free}</div><div className={styles.statLabel}>Свободно</div></div>
          <div className={styles.statMini}><div className={styles.statNum} style={{color:'#eab308'}}>{stats.soft}</div><div className={styles.statLabel}>Стандартная бронь</div></div>
          <div className={styles.statMini}><div className={styles.statNum} style={{color:'#ea580c'}}>{stats.hard}</div><div className={styles.statLabel}>Хард бронь</div></div>
          <div className={styles.statMini}><div className={styles.statNum} style={{color:'#b91c1c'}}>{stats.sold}</div><div className={styles.statLabel}>Продано</div></div>
        </div>

        {/* Фильтры */}
        <div className={styles.filterBar}>
          {projectHasBuildings ? (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className={styles.filterSelect}
                onClick={() => setBuildingDropdownOpen(o => !o)}
                style={{ textAlign: 'left', width: '140px', fontWeight: 700 }}
              >
                Здание {effectiveBuildingNumber || ''}
              </button>
              {buildingDropdownOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setBuildingDropdownOpen(false)} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 11,
                    background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.1)', padding: '6px', minWidth: '140px',
                  }}>
                    {buildingNumbers.map(bn => (
                      <button
                        key={bn}
                        type="button"
                        onClick={() => {
                          setActiveBuildingNumber(bn);
                          const firstBlock = (currentProject?.blocks || []).find((b: any) => b.buildingNumber === bn);
                          if (firstBlock) setActiveBlockId(firstBlock.id);
                          setBuildingDropdownOpen(false);
                        }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                          fontSize: '0.9rem', fontWeight: 700, color: bn === effectiveBuildingNumber ? '#2563eb' : '#1e293b',
                          background: bn === effectiveBuildingNumber ? '#eff6ff' : 'transparent',
                          border: 'none', borderRadius: '6px', cursor: 'pointer',
                        }}
                      >
                        Здание {bn}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className={styles.blockTabs}>
              {currentProject?.blocks?.map((block: any) => (
                <button key={block.id} className={activeBlockId === block.id ? styles.activeTab : ''} onClick={() => setActiveBlockId(block.id)}>{block.number}</button>
              ))}
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={styles.filterLabel}>Фильтры:</span>
            <select value={activeProjectId || ''} onChange={(e) => {
              setActiveProjectId(e.target.value);
              const p = projects.find(x => x.id === e.target.value);
              setActiveBlockId(p?.blocks?.[0]?.id || null);
            }} className={styles.filterSelect}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className={styles.filterSelect}
                onClick={() => setStatusDropdownOpen(o => !o)}
                style={{ textAlign: 'left', width: '150px' }}
              >
                Статус{statusFilter.length > 0 ? ` (${statusFilter.length})` : ''}
              </button>
              {statusDropdownOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setStatusDropdownOpen(false)} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 11,
                    background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.1)', padding: '8px', minWidth: '210px',
                  }}>
                    {STATUS_FILTER_OPTIONS.map(opt => (
                      <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', fontSize: '0.85rem', fontWeight: 600, color: '#1e293b', cursor: 'pointer', borderRadius: '6px', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={statusFilter.includes(opt.value)} onChange={() => toggleStatusFilterOption(opt.value)} />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className={styles.filterSelect}
                onClick={() => setRoomsDropdownOpen(o => !o)}
                style={{ textAlign: 'left' }}
              >
                Комнатность{roomsFilter.length > 0 ? ` (${roomsFilter.length})` : ''}
              </button>
              {roomsDropdownOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setRoomsDropdownOpen(false)} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 11,
                    background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.1)', padding: '8px', minWidth: '160px',
                  }}>
                    {ROOMS_FILTER_OPTIONS.map(opt => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', fontSize: '0.85rem', fontWeight: 600, color: '#1e293b', cursor: 'pointer', borderRadius: '6px' }}>
                        <input type="checkbox" checked={roomsFilter.includes(opt)} onChange={() => toggleRoomsFilterOption(opt)} />
                        {opt === '5+' ? '5+ комн.' : `${opt}-комн.`}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            <input type="number" placeholder="Цена от" className={styles.filterInput} style={{ width: '130px' }} value={priceFilter.min} onChange={e => setPriceFilter({...priceFilter, min: e.target.value})} />
            <input type="number" placeholder="Цена до" className={styles.filterInput} style={{ width: '130px' }} value={priceFilter.max} onChange={e => setPriceFilter({...priceFilter, max: e.target.value})} />
          </div>
        </div>

        {/* Легенда */}
        <div className={styles.legend}>
          <div className={styles.legendItem}><span className={styles.freeBox}></span> Свободна</div>
          <div className={styles.legendItem}><span className={styles.softBookedBox}></span> Стандартная бронь</div>
          <div className={styles.legendItem}><span className={styles.hardBookedBox}></span> Хард бронь</div>
          <div className={styles.legendItem}><span className={styles.contractSignedBox}></span> Договор</div>
          <div className={styles.legendItem}><span className={styles.fullyPaidBox}></span> Продано</div>
          <div className={styles.legendItem}><span className={styles.serviceBox}></span> Служебная</div>
          <div className={styles.legendItem}><span className={styles.excludedBox}></span> Не для продажи</div>
        </div>

        {/* Шахматка - сетка квартир */}
        {projectHasBuildings ? (
          /* Новая раскладка "как на скриншоте AS Group": корпуса выбранного здания
             показываются все сразу, колонками рядом друг с другом, с общими этажами слева. */
          <div className={styles.gridCard} style={{ overflowX: 'auto' }}>
            <div className={styles.grid}>
              <div className={styles.floorRow}>
                <div className={styles.floorNum} />
                <div style={{ display: 'flex', gap: '40px' }}>
                  {visibleBlocks.map((block: any) => (
                    <div
                      key={block.id}
                      style={{
                        width: `${blockColumnWidth(block)}px`, flexShrink: 0,
                        textAlign: 'center', fontWeight: 800, fontSize: '1rem', color: '#1e293b',
                      }}
                    >
                      Корпус {block.number}
                    </div>
                  ))}
                </div>
              </div>

              {buildingFloors.map(floor => (
                <div key={floor} className={styles.floorRow}>
                  <div className={styles.floorNum}>{floor} эт.</div>
                  <div style={{ display: 'flex', gap: '40px' }}>
                    {visibleBlocks.map((block: any) => {
                      const unitsHere = (buildingUnitsByFloor[floor] && buildingUnitsByFloor[floor][block.id]) || [];
                      return (
                        <div
                          key={block.id}
                          className={styles.units}
                          style={{ width: `${blockColumnWidth(block)}px`, flexShrink: 0 }}
                        >
                          {unitsHere.map((unit: any) => {
                            const filteredOut = isFilteredOut(unit);
                            return (
                              <div
                                key={unit.id}
                                className={`${styles.unit} ${getStatusClass(unit.status)} ${filteredOut ? styles.dimmed : ''}`}
                                onClick={() => handleUnitClick(unit)}
                              >
                                <div className={styles.uNum}>{unit.number}</div>
                                <div className={styles.uInfo}>{unit.area} м² • {unit.rooms} к.</div>
                                <div className={styles.uPrice}>
                                  {unit.status === 'FREE' ? (
                                    promoMap[unit.id] ? (
                                      <>
                                        <span style={{ textDecoration: 'line-through', opacity: 0.6, fontSize: '0.75em' }}>${Math.round(unit.price).toLocaleString()}</span>
                                        {' '}
                                        <span style={{ color: '#dc2626', fontWeight: 800 }}>
                                          ${Math.round(calcPromoPrice(unit.price, unit.area, promoMap[unit.id], promoMap[unit.id].nbgRate).promoPriceUSD).toLocaleString()}
                                        </span>
                                      </>
                                    ) : (
                                      <>${Math.round(unit.price).toLocaleString()}<span className={styles.gelPrice}>{Math.round(unit.price * parseFloat(exchangeRate)).toLocaleString()} ₾</span></>
                                    )
                                  ) : getStatusName(unit.status)}
                                </div>
                                {unit.status === 'SOFT_BOOKED' && (
                                  <div className={`${styles.timerBadge} ${promoMap[unit.id] ? styles.vipBadgeShifted : ''}`}>
                                    {getRemainingTime(unit.bookingExpiresAt)}
                                  </div>
                                )}
                                {promoMap[unit.id] && (
                                  <div className={styles.promoBadge} title={promoMap[unit.id].name}>
                                    АКЦИЯ
                                  </div>
                                )}
                                {unit.price > 300000 && unit.status === 'FREE' && (
                                  <div className={`${styles.vipBadge} ${promoMap[unit.id] ? styles.vipBadgeShifted : ''}`}>VIP</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
        <div className={styles.gridCard}>
          <div className={styles.grid}>
            {floors.map(floor => (
              <div key={floor} className={styles.floorRow}>
                <div className={styles.floorNum}>{floor} эт.</div>
                <div className={styles.units}>
                  {unitsByFloor[floor].map((unit, idx) => {
                    const filteredOut = isFilteredOut(unit);
                    const prevUnit = idx > 0 ? unitsByFloor[floor][idx - 1] : null;
                    const isNewEntrance = prevUnit && (prevUnit.entrance || 1) !== (unit.entrance || 1);
                    return (
                      <React.Fragment key={unit.id}>
                        {isNewEntrance && (
                          <div
                            style={{
                              width: '2px',
                              background: 'linear-gradient(to bottom, #94a3b8, #cbd5e1)',
                              margin: '0 12px',
                              alignSelf: 'stretch',
                              borderRadius: '4px',
                              flexShrink: 0,
                            }}
                            title={`Подъезд ${unit.entrance}`}
                          />
                        )}
                        <div className={`${styles.unit} ${getStatusClass(unit.status)} ${filteredOut ? styles.dimmed : ''}`} onClick={() => handleUnitClick(unit)}>
                          <div className={styles.uNum}>{unit.number}</div>
                          <div className={styles.uInfo}>{unit.area} м² • {unit.rooms} к.</div>
                          <div className={styles.uPrice}>
                            {unit.status === 'FREE' ? (
                              promoMap[unit.id] ? (
                                <>
                                  <span style={{ textDecoration: 'line-through', opacity: 0.6, fontSize: '0.75em' }}>${Math.round(unit.price).toLocaleString()}</span>
                                  {' '}
                                  <span style={{ color: '#dc2626', fontWeight: 800 }}>
                                    ${Math.round(calcPromoPrice(unit.price, unit.area, promoMap[unit.id], promoMap[unit.id].nbgRate).promoPriceUSD).toLocaleString()}
                                  </span>
                                </>
                              ) : (
                                <>${Math.round(unit.price).toLocaleString()}<span className={styles.gelPrice}>{Math.round(unit.price * parseFloat(exchangeRate)).toLocaleString()} ₾</span></>
                              )
                            ) : getStatusName(unit.status)}
                          </div>
                          {unit.status === 'SOFT_BOOKED' && (
                            <div className={`${styles.timerBadge} ${promoMap[unit.id] ? styles.vipBadgeShifted : ''}`}>
                              {getRemainingTime(unit.bookingExpiresAt)}
                            </div>
                          )}
                          {promoMap[unit.id] && (
                            <div className={styles.promoBadge} title={promoMap[unit.id].name}>
                              АКЦИЯ
                            </div>
                          )}
                          {unit.price > 300000 && unit.status === 'FREE' && (
                            <div className={`${styles.vipBadge} ${promoMap[unit.id] ? styles.vipBadgeShifted : ''}`}>VIP</div>
                          )}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Подписи подъездов снизу — в том же стиле что и номера этажей */}
            {(() => {
              const firstFloor = floors[floors.length - 1];
              if (!firstFloor || !unitsByFloor[firstFloor]) return null;
              const firstFloorUnits = unitsByFloor[firstFloor];
              const entranceSections: { entrance: number; count: number }[] = [];
              firstFloorUnits.forEach((unit: any) => {
                const ent = unit.entrance || 1;
                const last = entranceSections[entranceSections.length - 1];
                if (last && last.entrance === ent) { last.count++; }
                else { entranceSections.push({ entrance: ent, count: 1 }); }
              });
              const UNIT_W = 180;
              const GAP = 6;
              const DIVIDER_W = 2 + 24;
              return (
                <div className={styles.floorRow} style={{ marginTop: '4px' }}>
                  <div className={styles.floorNum} /> {/* отступ под номера этажей */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {entranceSections.map((sec, i) => (
                      <React.Fragment key={sec.entrance}>
                        {i > 0 && <div style={{ width: `${DIVIDER_W}px`, flexShrink: 0 }} />}
                        <div style={{
                          width: `${sec.count * UNIT_W + (sec.count - 1) * GAP}px`,
                          textAlign: 'center',
                          fontSize: '0.8rem',
                          fontWeight: 800,
                          color: '#94a3b8',
                          flexShrink: 0,
                        }}>
                          {sec.entrance} пд.
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
        )}
      </div>

      {/* Полноэкранная карточка квартиры */}
      <div className={`${styles.sidePanel} ${selectedUnit ? styles.sidePanelOpen : ''}`}>
        {selectedUnit && (
          <>
            <div className={styles.panelHeader}>
              <div>
                <h2>Квартира №{selectedUnit.number}</h2>
                <div className={`${styles.statusPill} ${getStatusClass(selectedUnit.status)}`}>{getStatusName(selectedUnit.status)}</div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {canUnits && <button onClick={openEditModal} className={styles.editUnitBtn} title="Редактировать"> Редактировать</button>}
                {canUnits && <button onClick={handleDeleteUnit} className={styles.deleteUnitBtn} title="Исключить из продаж"> Исключить</button>}
                <button onClick={closePanel} className={styles.closeBtn}>×</button>
              </div>
            </div>

            {/* Панель со складными подвкладками (Аккордеон) */}
            <div className={styles.panelBodySingle}>
              <div style={{ maxWidth: '100%', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '20px', padding: '10px 40px 40px 40px' }}>

              {/* Подвкладка 1: Характеристики и планировка */}
              <div className={styles.accordionItem}>
                <button
                  type="button"
                  className={styles.accordionHeader}
                  onClick={() => toggleAccordion('info')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}> Характеристики и планировка</span>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{activeAccordions.info ? ' Свернуть' : ' Развернуть'}</span>
                </button>
                {activeAccordions.info && (
                  <div className={styles.accordionContent}>
                    {/* Привязанная сделка — быстрый переход на карточку сделки */}
                    {unitDeals.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                        {unitDeals.map((d: any) => (
                          <a
                            key={d.id}
                            href={`/deals?highlightDealId=${d.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '10px 14px' }}
                          >
                            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e3a8a' }}>
                              Сделка #{d.id.slice(0, 8)}{d.createdAt ? ` · ${new Date(d.createdAt).toLocaleDateString('ru-RU')}` : ''}
                            </span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#2563eb' }}>Открыть →</span>
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Характеристики */}
                    <div className={styles.paramGridCompact}>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>№ квартиры</span><span className={styles.paramValue}>{selectedUnit.number}</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Корпус</span><span className={styles.paramValue}>{currentBlock?.number || '—'}</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Этаж</span><span className={styles.paramValue}>{selectedUnit.floor}</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Подъезд (PTD)</span><span className={styles.paramValue}>{selectedUnit.entrance || '—'}</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Тип</span><span className={styles.paramValue}>{selectedUnit.type === 'Apartment' ? 'Жилая' : selectedUnit.type}</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Комнат</span><span className={styles.paramValue}>{selectedUnit.rooms}</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Площадь</span><span className={styles.paramValue}>{selectedUnit.area} м²</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Жилая площадь</span><span className={styles.paramValue}>{selectedUnit.livingArea ? `${selectedUnit.livingArea} м²` : '—'}</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Балкон</span><span className={styles.paramValue}>{selectedUnit.balconyArea ? `${selectedUnit.balconyArea} м²` : '—'}</span></div>
                      {selectedUnit.viewType && (
                        <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Вид из окон</span><span className={styles.paramValue}>{selectedUnit.viewType}</span></div>
                      )}
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Статус</span><span className={styles.paramValue}>{getStatusName(selectedUnit.status)}</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Доступна к продаже</span><span className={styles.paramValue}>{(selectedUnit.status === 'FREE' && selectedUnit.availableForSale !== false) ? 'Да' : 'Нет'}</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Цена (USD)</span><span className={styles.paramValue}>${Number(selectedUnit.price).toLocaleString()}</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Цена (GEL)</span><span className={styles.paramValue}>{Math.round(selectedUnit.price * parseFloat(exchangeRate)).toLocaleString()} ₾</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Цена м² с НДС</span><span className={styles.paramValue}>{selectedUnit.pricePerSqmVAT != null ? `$${Number(selectedUnit.pricePerSqmVAT).toLocaleString()}` : '—'}</span></div>
                      <div className={styles.paramItemCompact}><span className={styles.paramLabel}>Номер контракта</span><span className={styles.paramValue}>{selectedUnit.contractNumber || '—'}</span></div>
                      <div className={styles.paramItemCompact}>
                        <span className={styles.paramLabel}>Дата сдачи объекта</span>
                        <span className={styles.paramValue}>
                          {selectedUnit.deliveryDate
                            ? new Date(selectedUnit.deliveryDate).toLocaleDateString('ru-RU')
                            : (selectedUnit.deliveryMonth || selectedUnit.deliveryYear)
                              ? [selectedUnit.deliveryMonth, selectedUnit.deliveryYear].filter(Boolean).join('.')
                              : calcEffectiveDeliveryDate
                                ? `${formatDateRu(calcEffectiveDeliveryDate)} (по ЖК)`
                                : '—'}
                        </span>
                      </div>
                      {promoMap[selectedUnit.id] && (() => {
                        const promo = promoMap[selectedUnit.id];
                        const pr = calcPromoPrice(selectedUnit.price, selectedUnit.area, promo, promo.nbgRate);
                        return (
                          <div className={styles.paramItemCompact} style={{ gridColumn: 'span 3', background: '#fef2f2', border: '1px solid #fecaca' }}>
                            <span className={styles.paramLabel} style={{ color: '#dc2626' }}> Акция: {promo.name}</span>
                            <span className={styles.paramValue} style={{ color: '#dc2626' }}>
                              {formatEffectSummary(promo)} → ${pr.promoPriceUSD.toLocaleString()} ({pr.promoPriceGEL.toLocaleString()} ₾)
                            </span>
                            <div style={{ fontSize: '0.7rem', color: '#991b1b', marginTop: '2px' }}>
                              До {mounted ? formatGeorgiaDateTime(promo.endAt) : '…'}
                            </div>
                          </div>
                        );
                      })()}
                      {lockedDealMap[selectedUnit.id] && (
                        <div className={styles.paramItemCompact} style={{ gridColumn: 'span 3', background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                          <span className={styles.paramLabel} style={{ color: '#1e3a8a' }}>
                             В договоре{lockedDealMap[selectedUnit.id].promotionName ? ` (акция «${lockedDealMap[selectedUnit.id].promotionName}»)` : ''}
                          </span>
                          <span className={styles.paramValue} style={{ color: '#1e3a8a' }}>
                            ${Math.round(lockedDealMap[selectedUnit.id].totalAmount).toLocaleString()}
                          </span>
                          <div style={{ fontSize: '0.7rem', color: '#1e40af', marginTop: '2px' }}>
                            Цена зафиксирована — клиент: {lockedDealMap[selectedUnit.id].leadName || '—'}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Экспликация помещений квартиры */}
                    {selectedUnitRooms && selectedUnitRooms.length > 0 && (
                      <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', background: '#ffffff', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                        <strong style={{ display: 'block', fontSize: '0.85rem', color: '#1e3a8a', marginBottom: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Экспликация помещений
                        </strong>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          {selectedUnitRooms.map((room) => (
                            <div key={room.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                              <span style={{ color: '#475569', fontWeight: 600 }}>{room.nameRu || room.roomType}</span>
                              <span style={{ color: '#1e3a8a', fontWeight: 800 }}>{room.area} м²</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Планировка */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', background: '#f8fafc' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: '0.9rem', color: '#475569' }}>Чертеж / Схема</strong>
                        <button
                          type="button"
                          onClick={handleDownloadPdfClient}
                          style={{ background: '#10b981', color: '#ffffff', border: '1px solid #059669', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', cursor: 'pointer', borderRadius: '6px', fontWeight: 700, fontSize: '0.8rem' }}
                          disabled={loading}
                        >
                           Скачать PDF
                        </button>
                      </div>

                      {selectedUnit.layout3dUrl && (
                        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                          <button
                            type="button"
                            onClick={() => setLayoutTab('2d')}
                            style={{
                              flex: 1,
                              padding: '6px 12px',
                              borderRadius: '6px',
                              border: '1px solid',
                              borderColor: layoutTab === '2d' ? '#2563eb' : '#e2e8f0',
                              background: layoutTab === '2d' ? '#eff6ff' : '#ffffff',
                              color: layoutTab === '2d' ? '#1d4ed8' : '#475569',
                              fontWeight: 700,
                              cursor: 'pointer',
                              fontSize: '0.8rem'
                            }}
                          >
                             Схема 2D
                          </button>
                          <button
                            type="button"
                            onClick={() => setLayoutTab('3d')}
                            style={{
                              flex: 1,
                              padding: '6px 12px',
                              borderRadius: '6px',
                              border: '1px solid',
                              borderColor: layoutTab === '3d' ? '#2563eb' : '#e2e8f0',
                              background: layoutTab === '3d' ? '#eff6ff' : '#ffffff',
                              color: layoutTab === '3d' ? '#1d4ed8' : '#475569',
                              fontWeight: 700,
                              cursor: 'pointer',
                              fontSize: '0.8rem'
                            }}
                          >
                             Визуализация 3D
                          </button>
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'center', background: '#ffffff', borderRadius: '8px', padding: '12px', minHeight: '300px', alignItems: 'center' }}>
                        {layoutTab === '2d' || !selectedUnit.layout3dUrl ? (
                          <UnitLayoutSvg rooms={selectedUnit.rooms} area={selectedUnit.area} layoutUrl={selectedUnit.layoutUrl} width="100%" height={450} />
                        ) : (
                          selectedUnit.layout3dUrl.match(/\.(jpeg|jpg|gif|png|webp)/i) != null || selectedUnit.layout3dUrl.includes('/upload') || selectedUnit.layout3dUrl.includes('supabase') ? (
                            <img 
                              src={selectedUnit.layout3dUrl} 
                              alt="3D Визуализация квартиры" 
                              style={{ maxWidth: '100%', maxHeight: '450px', objectFit: 'contain', borderRadius: '6px' }}
                            />
                          ) : (
                            <div style={{ width: '100%' }}>
                              {selectedUnit.layout3dUrl.includes('<iframe') ? (
                                <div dangerouslySetInnerHTML={{ __html: selectedUnit.layout3dUrl }} />
                              ) : (
                                <iframe 
                                  src={selectedUnit.layout3dUrl} 
                                  width="100%" 
                                  height="450px" 
                                  style={{ border: 'none', borderRadius: '8px' }} 
                                  allowFullScreen 
                                />
                              )}
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    {/* Привязанный клиент */}
                    <div className={styles.associatedClientCard} style={{ border: '1px solid #e2e8f0', padding: '16px', borderRadius: '12px', background: '#ffffff' }}>
                      <strong style={{ display: 'block', fontSize: '0.9rem', color: '#475569', marginBottom: '12px' }}>Связанный клиент</strong>
                      {selectedUnit.associatedLeadId ? (
                        <div className={styles.clientProfileBox}>
                          <div className={styles.clientAvatar}>
                            {selectedUnit.associatedLeadName?.[0]?.toUpperCase() || ''}
                          </div>
                          <div className={styles.clientMetaBox}>
                            <button 
                              type="button" 
                              className={styles.clientDossierLink}
                              onClick={() => handleOpenClientDossier(selectedUnit.associatedLeadId)}
                            >
                              {selectedUnit.associatedLeadName} ↗
                            </button>
                            <span className={styles.clientStatusLabel}>
                              Статус сделки: <strong>{getStatusName(selectedUnit.status)}</strong>
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className={styles.noClientAlert} style={{ padding: '8px 0', border: 'none', background: 'none' }}>
                          <span style={{ fontWeight: 700, color: '#22c55e', fontSize: '0.9rem' }}> Свободная продажа</span>
                          <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Привязанный клиент отсутствует.</p>
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>

              {/* Подвкладка 2: Оформление сделки и Бронь */}
              <div className={styles.accordionItem}>
                <button 
                  type="button" 
                  className={styles.accordionHeader} 
                  onClick={() => toggleAccordion('deal')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}> Оформление сделки и бронь</span>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{activeAccordions.deal ? ' Свернуть' : ' Развернуть'}</span>
                </button>
                {activeAccordions.deal && (
                  <div className={styles.accordionContent}>
                    
                    {/* Управление статусом */}
                    <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                      <strong style={{ display: 'block', fontSize: '0.9rem', color: '#475569', marginBottom: '12px' }}>Управление бронированием</strong>
                      {selectedUnit.status === 'FREE' ? (
                        <div className={styles.bookingSection} style={{ padding: 0, border: 'none', background: 'none', marginBottom: 0 }}>
                          <div>
                            <span className={styles.bookingLabel}>Тип брони</span>
                            <div className={styles.bookingTypeTabs}>
                              <button 
                                type="button"
                                className={`${styles.bookingTypeTab} ${bookingType === 'SOFT' ? styles.bookingTypeTabActiveSoft : ''}`} 
                                onClick={() => setBookingType('SOFT')}
                              >
                                Стандартная бронь
                              </button>
                              <button
                                type="button"
                                className={`${styles.bookingTypeTab} ${bookingType === 'HARD' ? styles.bookingTypeTabActiveHard : ''}`}
                                onClick={() => setBookingType('HARD')}
                              >
                                Хард бронь
                              </button>
                              <button 
                                type="button"
                                className={`${styles.bookingTypeTab} ${bookingType === 'SERVICE' ? styles.bookingTypeTabActiveService : ''}`} 
                                onClick={() => setBookingType('SERVICE')}
                              >
                                Служебная
                              </button>
                            </div>
                          </div>

                          <div style={{ margin: '12px 0' }}>
                            {bookingType === 'SOFT' && (
                              <>
                                <span className={styles.bookingLabel}>Срок стандартной брони</span>
                                <div className={styles.leadSelect} style={{ display: 'flex', alignItems: 'center', color: '#475569', fontWeight: 600 }}>
                                  2 дня
                                </div>
                              </>
                            )}

                            {bookingType === 'HARD' && (
                              <>
                                <span className={styles.bookingLabel}>Срок платной брони</span>
                                <select 
                                  value={hardDuration} 
                                  onChange={(e) => setHardDuration(e.target.value)} 
                                  className={styles.leadSelect}
                                >
                                  <option value="7">7 дней</option>
                                  <option value="10">10 дней</option>
                                  <option value="14">14 дней</option>
                                  <option value="30">30 дней (под ипотеку)</option>
                                  <option value="CUSTOM">Другой срок (выбрать на календаре)</option>
                                </select>

                                {hardDuration === 'CUSTOM' && (
                                  <div style={{ marginTop: '12px' }}>
                                    <span className={styles.bookingLabel}>Календарь бронирования</span>
                                    <input 
                                      type="datetime-local" 
                                      value={customHardDateTime} 
                                      onChange={(e) => setCustomHardDateTime(e.target.value)} 
                                      className={styles.leadSelect}
                                      min={new Date().toISOString().slice(0, 16)}
                                    />
                                  </div>
                                )}
                              </>
                            )}

                            {bookingType === 'SERVICE' && (
                              <div className={styles.durationBanner}>
                                 Блокировка под служебные нужды (бессрочно)
                              </div>
                            )}
                          </div>

                          <div style={{ marginBottom: '14px' }}>
                            <span className={styles.bookingLabel}>Выберите клиента</span>
                            <select 
                              value={selectedLeadId} 
                              onChange={(e) => setSelectedLeadId(e.target.value)} 
                              className={styles.leadSelect}
                            >
                              <option value="">Выберите клиента...</option>
                              {clients.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                          </div>

                          {!readOnly && (
                            <button 
                              onClick={onBook} 
                              disabled={loading || !selectedLeadId} 
                              className={styles.bookBtn}
                              style={{ padding: '10px', fontSize: '0.9rem', width: '100%' }}
                            >
                              {loading ? 'Загрузка...' : 'Забронировать объект'}
                            </button>
                          )}
                        </div>
                      ) : ['SOFT_BOOKED', 'RESERVATION_ORAL', 'HARD_BOOKED', 'RESERVATION_PAID', 'SERVICE'].includes(selectedUnit.status) ? (
                        <div className={styles.bookingSection} style={{ background: '#fff7ed', borderColor: '#fed7aa', padding: '16px', marginBottom: 0, borderRadius: '8px' }}>
                          <div className={styles.bookedAlert} style={{ border: 'none', padding: 0, marginBottom: '16px' }}>
                            <span style={{ fontSize: '0.95rem', fontWeight: 800 }}>Объект забронирован ({getStatusName(selectedUnit.status)})</span>
                            {selectedUnit.bookingExpiresAt && (
                              <div style={{ marginTop: '8px', padding: '6px 10px', background: '#ffedd5', borderRadius: '6px', border: '1px solid #ffddb3', color: '#c2410c', fontWeight: 700, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                ⏳ {(() => {
                                  const diffMs = new Date(selectedUnit.bookingExpiresAt).getTime() - Date.now();
                                  if (diffMs <= 0) return 'Истекла';
                                  const days = Math.floor(diffMs / (24 * 3600 * 1000));
                                  const hours = Math.floor((diffMs % (24 * 3600 * 1000)) / (3600 * 1000));
                                  const minutes = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));
                                  if (days > 0) {
                                    return `Осталось: ${days} дн. ${hours} ч.`;
                                  }
                                  return `Осталось: ${hours} ч. ${minutes} мин.`;
                                })()}
                              </div>
                            )}
                            <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: '#9a3412' }}>
                              Вы можете снять текущую бронь, чтобы освободить объект.
                            </p>
                          </div>
                          {!readOnly && (
                            <button 
                              onClick={onReleaseBook} 
                              disabled={loading} 
                              className={styles.bookBtn}
                              style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', padding: '10px', width: '100%' }}
                            >
                              {loading ? 'Загрузка...' : 'Снять текущую бронь'}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className={styles.bookingSection} style={{ background: '#ecfdf5', borderColor: '#a7f3d0', padding: '16px', marginBottom: 0, borderRadius: '8px' }}>
                          <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#065f46' }}> Сделка завершена ({getStatusName(selectedUnit.status)})</span>
                          <p style={{ margin: '6px 0 0 0', fontSize: '0.8rem', color: '#047857', lineHeight: '1.4' }}>
                            Объект успешно продан или по нему подписан договор. Смена брони заблокирована.
                          </p>
                          {selectedUnit.status === 'SOLD' && !readOnly && (
                            <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '12px' }}>
                              <button
                                onClick={onTerminateContract}
                                disabled={loading}
                                className={styles.bookBtn}
                                style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', padding: '6px 14px', width: 'auto', fontSize: '0.8rem' }}
                              >
                                {loading ? 'Загрузка...' : 'Расторгнуть договор'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Очередь (Лист ожидания) */}
                    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
                      <strong style={{ display: 'block', fontSize: '0.9rem', color: '#475569', marginBottom: '12px' }}> Лист ожидания (Очередь)</strong>
                      
                      {waitingList.length === 0 ? (
                        <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic' }}>В очереди пока нет клиентов.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                          {waitingList.map((item, idx) => (
                            <div 
                              key={item.id} 
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between',
                                background: '#f8fafc', 
                                border: '1px solid #e2e8f0', 
                                borderRadius: '8px', 
                                padding: '8px 12px',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#475569', background: '#e2e8f0', width: '20px', height: '20px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {idx + 1}
                                </span>
                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>{item.leadName}</span>
                                {item.leadIsVip && (
                                  <span style={{ background: '#fef3c7', color: '#b45309', padding: '1px 5px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 'bold' }}> VIP</span>
                                )}
                              </div>
                              {!readOnly && (
                                <button 
                                  onClick={() => handleRemoveFromQueue(item.id)}
                                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700 }}
                                >
                                  Убрать
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Добавить в очередь */}
                      {!readOnly && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Добавить клиента в очередь</span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <select 
                              value={wlLeadId}
                              onChange={e => setWlLeadId(e.target.value)}
                              style={{ flex: 1, padding: '8px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.8rem', background: 'white' }}
                            >
                              <option value="">Выберите клиента...</option>
                              {clients.map(l => (
                                <option key={l.id} value={l.id}>
                                  {l.name} {l.isVip ? ' VIP' : ''}
                                </option>
                              ))}
                            </select>
                            <button 
                              onClick={handleAddToQueue}
                              disabled={wlSubmitting || !wlLeadId}
                              style={{ background: '#0f172a', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, opacity: (!wlLeadId || wlSubmitting) ? 0.6 : 1 }}
                            >
                              {wlSubmitting ? '...' : 'Добавить'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>

              {/* Подвкладка 3а: План рассрочки — появляется, только если по сделке уже есть сохранённый
                  расчёт. Калькулятор при этом НЕ скрывается (расчёт можно менять и после заключения
                  сделки) — план исчезает сам, когда сделка расторгается (см. updateDealStatus). */}
              {savedPlan && (
                <div className={styles.accordionItem}>
                  <button
                    type="button"
                    className={styles.accordionHeader}
                    onClick={() => toggleAccordion('plan')}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}> План рассрочки</span>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{activeAccordions.plan ? ' Свернуть' : ' Развернуть'}</span>
                  </button>
                  {activeAccordions.plan && (
                    <div className={styles.accordionContent}>
                      {savedPlanLoading ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>Загрузка...</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          <div className={styles.paramGrid}>
                            <div className={styles.paramItem}><span className={styles.paramLabel}>Итоговая цена $</span><span className={styles.paramValue}>${Number(savedPlan.deal.totalAmount || 0).toLocaleString()}</span></div>
                            <div className={styles.paramItem}><span className={styles.paramLabel}>Первый взнос</span><span className={styles.paramValue}>{savedPlan.deal.firstPaymentDate ? formatDateRu(toDateInputValue(savedPlan.deal.firstPaymentDate)) : '—'} · {savedPlan.deal.firstPaymentPercent ?? 0}%</span></div>
                            <div className={styles.paramItem}><span className={styles.paramLabel}>Тип оплаты</span><span className={styles.paramValue}>{savedPlan.deal.paymentType === 'CASH' ? '100% оплата' : 'Рассрочка'}</span></div>
                            {savedPlan.deal.installmentComment && (
                              <div className={styles.paramItem}><span className={styles.paramLabel}>Комментарий</span><span className={styles.paramValue}>{savedPlan.deal.installmentComment}</span></div>
                            )}
                          </div>
                          <div className={styles.installmentTableWrapper}>
                            <table className={styles.installmentTable}>
                              <thead>
                                <tr><th>№</th><th>Дата платежа</th><th>Сумма ($)</th><th>Статус</th></tr>
                              </thead>
                              <tbody>
                                {savedPlan.schedule.map((r: any, idx: number) => (
                                  <tr key={r.id}>
                                    <td>{idx + 1}</td>
                                    <td>{formatDateRu(toDateInputValue(r.dueDate))}</td>
                                    <td>${Number(r.amount).toLocaleString()}</td>
                                    <td>{r.status === 'PAID' ? 'Оплачен' : 'Ожидается'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Подвкладка 3б: Калькулятор рассрочки */}
              <div className={styles.accordionItem}>
                <button
                  type="button"
                  className={styles.accordionHeader}
                  onClick={() => toggleAccordion('calc')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}> Калькулятор рассрочки</span>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{activeAccordions.calc ? ' Свернуть' : ' Развернуть'}</span>
                </button>
                {activeAccordions.calc && (
                  <div className={styles.accordionContent}>
                    {calcUnitDelivered ? (
                      // ── Объект сдан: только полная оплата ──────────────────────
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px 14px', color: '#991b1b', fontSize: '0.85rem', fontWeight: 600 }}>
                          Объект сдан ({formatDateRu(calcEffectiveDeliveryDate)}). Рассрочка недоступна — только полная оплата 100%.
                        </div>
                        <div className={styles.formRow}>
                          <div className={styles.formGroup}>
                            <label>Сделка</label>
                            <select className={styles.input} value={calcDealId} onChange={e => setCalcDealId(e.target.value)}>
                              <option value="">— Выберите сделку —</option>
                              {unitDeals.map((d: any) => (
                                <option key={d.id} value={d.id}>{d.clientName} — {d.clientPhone}</option>
                              ))}
                            </select>
                          </div>
                          <div className={styles.formGroup}>
                            <label>Дата платежа (100%)</label>
                            <input type="date" className={styles.input} value={calcFullPaymentDate} onChange={e => setCalcFullPaymentDate(e.target.value)} />
                          </div>
                        </div>
                        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '16px' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#1e40af', textTransform: 'uppercase' }}>Сумма к оплате</span>
                          <div style={{ fontSize: '24px', fontWeight: 900, color: '#1e3a8a' }}>${Number(selectedUnit.price).toLocaleString()}</div>
                        </div>
                        {canDeals && !readOnly && (
                          <button type="button" className={styles.modalSaveBtn} disabled={calcSaving} onClick={handleFullPaymentSave} style={{ alignSelf: 'flex-start' }}>
                            {calcSaving ? 'Сохранение...' : 'Сохранить платёж к сделке'}
                          </button>
                        )}
                      </div>
                    ) : (
                      // ── Объект строится: полный калькулятор рассрочки ──────────
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                        {/* Блок: Объект */}
                        <div>
                          <strong style={{ fontSize: '0.85rem', color: '#475569', display: 'block', marginBottom: '8px' }}>Объект</strong>
                          <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                              <label>Сделка</label>
                              <select className={styles.input} value={calcDealId} onChange={e => setCalcDealId(e.target.value)}>
                                <option value="">— Без привязки (только расчёт) —</option>
                                {unitDeals.map((d: any) => (
                                  <option key={d.id} value={d.id}>{d.clientName} — {d.clientPhone}</option>
                                ))}
                              </select>
                            </div>
                            <div className={styles.formGroup}>
                              <label>Площадь / Дата сдачи</label>
                              <input className={styles.input} disabled value={`${selectedUnit.area} м² · ${calcEffectiveDeliveryDate ? formatDateRu(calcEffectiveDeliveryDate) : 'не указана'}${!selectedUnit.deliveryDate && calcEffectiveDeliveryDate ? ' (по дате сдачи ЖК)' : ''}`} />
                            </div>
                          </div>
                          {!calcEffectiveDeliveryDate && (
                            <p style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '6px', fontWeight: 600 }}>
                              Дата сдачи не указана ни у квартиры, ни у ЖК — заполните её, иначе даты графика не рассчитаются автоматически.
                            </p>
                          )}
                        </div>

                        {/* Блок: Тип рассрочки */}
                        <div>
                          <strong style={{ fontSize: '0.85rem', color: '#475569', display: 'block', marginBottom: '8px' }}>Тип рассрочки</strong>
                          <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                              <label>Тип</label>
                              <select className={styles.input} value={calcScheduleType} onChange={e => setCalcScheduleType(e.target.value as any)}>
                                <option value="STANDARD">Стандартный (10/20/70)</option>
                                <option value="CUSTOM">Нестандартный</option>
                              </select>
                            </div>
                            <div className={styles.formGroup}>
                              <label>Периодичность платежей</label>
                              <select className={styles.input} value={calcPeriodicity} onChange={e => { setCalcPeriodicity(e.target.value as any); markCustom(); }}>
                                {Object.entries(PERIODICITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className={styles.formGroup} style={{ marginTop: '10px' }}>
                            <label>Файл графика (.xlsx) — опционально, для кастомного графика</label>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <input type="text" className={styles.input} value={calcCustomFileUrl} onChange={e => setCalcCustomFileUrl(e.target.value)} placeholder="Ссылка на файл или загрузите..." style={{ flex: 1 }} />
                              <button type="button" onClick={() => document.getElementById('calcCustomFileUpload')?.click()} style={{ padding: '8px 12px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>Обзор...</button>
                              <input id="calcCustomFileUpload" type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleCalcFileUpload} />
                            </div>
                          </div>
                        </div>

                        {/* Блок: Начальная цена (авторасчёт) */}
                        <div>
                          <strong style={{ fontSize: '0.85rem', color: '#475569', display: 'block', marginBottom: '8px' }}>Начальная цена</strong>
                          <div className={styles.paramGrid}>
                            <div className={styles.paramItem}>
                              <span className={styles.paramLabel}>Начальная цена $ {calcActivePromo && <em style={{ color: "#dc2626", fontStyle: "normal", fontSize: "0.65rem" }}>(с учётом акции)</em>}</span>
                              <span className={styles.paramValue}>
                                {calcActivePromo && (
                                  <span style={{ textDecoration: 'line-through', color: '#94a3b8', fontWeight: 500, marginRight: '6px', fontSize: '0.85em' }}>
                                    ${selectedUnit.price.toLocaleString()}
                                  </span>
                                )}
                                ${calcBasePrice(selectedUnit.area, calcUnitEffectivePricePerSqm).toLocaleString()}
                              </span>
                            </div>
                            <div className={styles.paramItem}><span className={styles.paramLabel}>Начальная цена за м² $</span><span className={styles.paramValue}>${Math.round(calcUnitEffectivePricePerSqm).toLocaleString()}</span></div>
                            <div className={styles.paramItem}><span className={styles.paramLabel}>Начальная цена ₾</span><span className={styles.paramValue}>{Math.round(calcBasePrice(selectedUnit.area, calcUnitEffectivePricePerSqm) * calcNbgRate).toLocaleString()} ₾</span></div>
                            <div className={styles.paramItem}><span className={styles.paramLabel}>Начальная цена за м² ₾</span><span className={styles.paramValue}>{Math.round(calcUnitEffectivePricePerSqm * calcNbgRate).toLocaleString()} ₾</span></div>
                          </div>
                        </div>

                        {/* Блок: Скидка */}
                        <div>
                          <strong style={{ fontSize: '0.85rem', color: '#475569', display: 'block', marginBottom: '8px' }}>Скидка</strong>
                          <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                              <label>Тип применения скидки</label>
                              <select className={styles.input} value={calcDiscountApplyType} onChange={e => { setCalcDiscountApplyType(e.target.value as any); markCustom(); }}>
                                <option value="PER_SQM">За м²</option>
                                <option value="TOTAL_AREA">На всю площадь</option>
                              </select>
                            </div>
                            <div className={styles.formGroup}>
                              <label>Размер скидки ($)</label>
                              <input type="number" className={styles.input} value={displayNum(calcDiscountAmount)} onChange={e => { setCalcDiscountAmount(Number(e.target.value)); markCustom(); }} />
                            </div>
                          </div>
                          <div className={styles.formGroup} style={{ marginTop: '10px', maxWidth: '260px' }}>
                            <label>Курс НБГ (₾ / $)</label>
                            <input type="number" step="0.0001" className={styles.input} value={displayNum(calcNbgRate)} onChange={e => setCalcNbgRate(Number(e.target.value))} />
                          </div>
                          <div style={{ marginTop: '10px', fontSize: '0.8rem', color: '#475569' }}>
                            Итоговая цена (с учётом скидки): <strong>${calcLiveFinalPrice.toLocaleString()}</strong>
                          </div>
                          {calcCombinedDiscountPercent > 0 && (
                            <div style={{
                              marginTop: '8px', padding: '8px 12px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600,
                              background: role === 'manager' ? '#fffbeb' : (calcDiscountAllowed ? '#f0fdf4' : '#fef2f2'),
                              color: role === 'manager' ? '#b45309' : (calcDiscountAllowed ? '#166534' : '#dc2626'),
                              border: `1px solid ${role === 'manager' ? '#fde68a' : (calcDiscountAllowed ? '#bbf7d0' : '#fecaca')}`
                            }}>
                              Суммарная скидка {calcCombinedDiscountPercent}% (акция {calcPromoDiscountPercent}% + индивидуальная {calcDiscountPercent}%){role === 'manager'
                                ? ' — будет отправлена на согласование руководителю ОП.'
                                : calcDiscountAllowed
                                  ? ' — в пределах вашего порога согласования.'
                                  : ` — превышает ваш порог (до ${getMaxDiscountPercent(role)}%). Требуется согласование: ${getRequiredApproverLabel(calcCombinedDiscountPercent)}.`}
                            </div>
                          )}
                        </div>

                        {/* Блок: График платежей — 3 колонки × 3 строки: Дата | Сумма $ | % */}
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <strong style={{ fontSize: '0.85rem', color: '#475569' }}>График платежей</strong>
                            {calcScheduleType === 'STANDARD' && (
                              <button type="button" onClick={handleApplyStandardPreset} style={{ padding: '6px 10px', fontSize: '0.75rem', background: '#f1f5f9', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, color: '#475569' }}>
                                Применить пресет 10/20/70
                              </button>
                            )}
                          </div>

                          <div className={styles.installmentGrid}>
                            <div className={styles.installmentGridHeader}>
                              <span></span><span>Дата</span><span>Сумма ($)</span><span>% от итоговой цены</span>
                            </div>

                            {/* Строка 1: Первый взнос */}
                            <div className={styles.installmentGridRow}>
                              <div className={styles.installmentGridLabel}>Первый взнос</div>
                              <input type="date" className={styles.input} value={calcFirstPaymentDate} onChange={e => handleFirstPaymentDateChange(e.target.value)} />
                              <input type="number" disabled={!calcFirstPaymentDate} className={`${styles.input} ${calcAutoRow === 'first' ? styles.inputAuto : ''} ${calcAutoRow === 'first' && derivedFirstAmount < 0 ? styles.inputNegative : ''}`} value={displayNum(derivedFirstAmount, !calcFirstPaymentDate)} onChange={e => handleFirstAmountChange(Number(e.target.value))} />
                              <input type="number" step="0.1" disabled={!calcFirstPaymentDate} className={`${styles.input} ${calcAutoRow === 'first' ? styles.inputAuto : ''} ${calcAutoRow === 'first' && derivedFirstAmount < 0 ? styles.inputNegative : ''} ${calcShowStandardPlaceholder ? styles.presetPlaceholder : ''}`} value={calcShowStandardPlaceholder ? '' : displayNum(calcFirstPercent, !calcFirstPaymentDate)} placeholder={calcShowStandardPlaceholder ? '10' : undefined} onChange={e => handleFirstPercentChange(Number(e.target.value))} />
                            </div>

                            {/* Строка 2: Периодический платёж */}
                            <div className={styles.installmentGridRow}>
                              <div className={styles.installmentGridLabel}>
                                Периодический платёж
                                <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 500 }}>
                                  {pluralizePayments(calcMonthsCount)}
                                </div>
                              </div>
                              <div className={styles.paramValue} style={{ display: 'flex', alignItems: 'center', color: calcAutoDates.scheduleStartDate ? '#1e293b' : '#94a3b8', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                                {calcAutoDates.scheduleStartDate ? formatDateRu(calcAutoDates.scheduleStartDate) : '--.--.--'}
                                {' – '}
                                {calcAutoDates.scheduleEndDate ? formatDateRu(calcAutoDates.scheduleEndDate) : '--.--.--'}
                              </div>
                              <input type="number" disabled={!calcFirstPaymentDate} className={`${styles.input} ${calcAutoRow === 'recurring' ? styles.inputAuto : ''} ${calcAutoRow === 'recurring' && derivedRecurringAmount < 0 ? styles.inputNegative : ''}`} value={displayNum(derivedRecurringAmount, !calcFirstPaymentDate)} onChange={e => handleRecurringAmountChange(Number(e.target.value))} />
                              <input type="number" step="0.1" disabled={!calcFirstPaymentDate} className={`${styles.input} ${calcAutoRow === 'recurring' ? styles.inputAuto : ''} ${calcAutoRow === 'recurring' && derivedRecurringAmount < 0 ? styles.inputNegative : ''} ${calcShowStandardPlaceholder ? styles.presetPlaceholder : ''}`} value={calcShowStandardPlaceholder ? '' : displayNum(calcRecurringPercent, !calcFirstPaymentDate)} placeholder={calcShowStandardPlaceholder ? '20' : undefined} onChange={e => handleRecurringPercentChange(Number(e.target.value))} />
                            </div>

                            {/* Строка 3: Остаток */}
                            <div className={styles.installmentGridRow}>
                              <div className={styles.installmentGridLabel}>Остаток (финальный платёж)</div>
                              <div className={styles.paramValue} style={{ display: 'flex', alignItems: 'center', color: calcEffectiveDeliveryDate ? '#1e293b' : '#94a3b8', fontSize: '0.8rem' }}>{calcEffectiveDeliveryDate ? formatDateRu(calcEffectiveDeliveryDate) : '--.--.--'}</div>
                              <input type="number" disabled={!calcFirstPaymentDate} className={`${styles.input} ${calcAutoRow === 'last' ? styles.inputAuto : ''} ${calcAutoRow === 'last' && derivedLastAmount < 0 ? styles.inputNegative : ''}`} value={displayNum(derivedLastAmount, !calcFirstPaymentDate)} onChange={e => handleLastAmountChange(Number(e.target.value))} />
                              <input type="number" step="0.1" disabled={!calcFirstPaymentDate} className={`${styles.input} ${calcAutoRow === 'last' ? styles.inputAuto : ''} ${calcAutoRow === 'last' && derivedLastAmount < 0 ? styles.inputNegative : ''} ${calcShowStandardPlaceholder ? styles.presetPlaceholder : ''}`} value={calcShowStandardPlaceholder ? '' : displayNum(calcLastPercent, !calcFirstPaymentDate)} placeholder={calcShowStandardPlaceholder ? '70' : undefined} onChange={e => handleLastPercentChange(Number(e.target.value))} />
                            </div>
                          </div>
                          <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '6px' }}>
                            {!calcFirstPaymentDate
                              ? 'Сначала укажите дату первого взноса — после этого станут доступны суммы и проценты.'
                              : 'Подсвеченное синим поле рассчитывается автоматически из двух остальных строк — начните вводить значение прямо в нём, чтобы задать его вручную (авто-роль перейдёт на другую строку). Красным подсвечивается поле, ушедшее в минус — уменьшите суммы в остальных строках.'}
                          </p>

                          <div className={styles.formGroup} style={{ marginTop: '12px' }}>
                            <label>Комментарий</label>
                            <input className={styles.input} value={calcComment} onChange={e => setCalcComment(e.target.value)} />
                          </div>

                          <button type="button" onClick={handleRunCalculation} style={{ marginTop: '12px', padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>
                            Рассчитать
                          </button>
                        </div>

                        {/* Результат */}
                        {calcResult && (
                          <div>
                            <div style={{ background: calcResult.isValid ? '#eff6ff' : '#fef2f2', border: `1px solid ${calcResult.isValid ? '#bfdbfe' : '#fecaca'}`, borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
                              <div className={styles.paramGrid}>
                                <div className={styles.paramItem}><span className={styles.paramLabel}>Итоговая цена $</span><span className={styles.paramValue}>${calcResult.finalPriceUSD.toLocaleString()}</span></div>
                                <div className={styles.paramItem}><span className={styles.paramLabel}>Итоговая цена ₾</span><span className={styles.paramValue}>{calcResult.finalPriceGEL.toLocaleString()} ₾</span></div>
                                <div className={styles.paramItem}><span className={styles.paramLabel}>Контрольная сумма</span><span className={styles.paramValue}>${calcResult.controlSumUSD.toLocaleString()}</span></div>
                                <div className={styles.paramItem}><span className={styles.paramLabel}>Сумма % (первый+период.+остаток)</span><span className={styles.paramValue}>{Math.round((calcFirstPercent + calcRecurringPercent + calcLastPercent) * 10) / 10}%</span></div>
                              </div>
                              {!calcResult.isValid && (
                                <div style={{ marginTop: '10px', color: '#991b1b', fontWeight: 700, fontSize: '0.8rem' }}>
                                  Контрольная сумма (${calcResult.controlSumUSD.toLocaleString()}) не совпадает с итоговой ценой (${calcResult.finalPriceUSD.toLocaleString()}). Сохранение недоступно — скорректируйте суммы.
                                </div>
                              )}
                            </div>

                            <div className={styles.installmentTableWrapper}>
                              <table className={styles.installmentTable}>
                                <thead>
                                  <tr><th>№</th><th>Дата платежа</th><th>Тип</th><th>Сумма ($)</th><th>Сумма (₾)</th></tr>
                                </thead>
                                <tbody>
                                  {calcResult.schedule.map(r => (
                                    <tr key={r.index} className={r.isWeekend ? styles.weekendRow : undefined}>
                                      <td>{r.index}</td>
                                      <td>{formatDateRu(r.date)}{r.isWeekend && <span style={{ marginLeft: '6px', fontSize: '0.7rem' }}>(вых.)</span>}</td>
                                      <td>{r.label}</td>
                                      <td>${r.amountUSD.toLocaleString()}</td>
                                      <td>{r.amountGEL.toLocaleString()} ₾</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                              <button type="button" onClick={() => exportScheduleCsv(calcResult.schedule, 'RUS', selectedUnit.number)} style={{ padding: '8px 12px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>График (RUS)</button>
                              <button type="button" onClick={() => exportScheduleCsv(calcResult.schedule, 'ENG', selectedUnit.number)} style={{ padding: '8px 12px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>Schedule (ENG)</button>
                              <button type="button" onClick={() => exportScheduleCsv(calcResult.schedule, 'GEO', selectedUnit.number)} style={{ padding: '8px 12px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>გრაფიკი (GEO)</button>
                              {canDeals && !readOnly && (
                                <button type="button" disabled={!calcResult.isValid || !calcDealId || calcSaving || !calcDiscountAllowed} onClick={handleSaveInstallmentPlan} className={styles.modalSaveBtn} style={{ marginLeft: 'auto' }}>
                                  {calcSaving ? 'Сохранение...' : 'Сохранить график к сделке'}
                                </button>
                              )}
                            </div>
                            {!calcDealId && (
                              <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '6px' }}>Чтобы сохранить график и привязать его к сделке — выберите сделку в блоке «Объект».</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Подвкладка 4: История изменений и цены */}
              <div className={styles.accordionItem}>
                <button 
                  type="button" 
                  className={styles.accordionHeader} 
                  onClick={() => toggleAccordion('history')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}> История изменений и цены</span>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{activeAccordions.history ? ' Свернуть' : ' Развернуть'}</span>
                </button>
                {activeAccordions.history && (
                  <div className={styles.accordionContent} style={{ gap: '24px' }}>
                    
                    {/* Цены */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                        <strong style={{ fontSize: '0.9rem', color: '#475569' }}>История изменения цен</strong>
                        <button type="button" className={styles.priceHistoryToggleBtn} onClick={loadUnitPriceHistory} style={{ padding: '3px 8px', fontSize: '0.75rem', borderRadius: '6px' }}>
                           Обновить
                        </button>
                      </div>
                      {priceHistory.length > 0 ? (
                        <div className={styles.priceHistoryList} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {priceHistory.map((h: any) => (
                            <div key={h.id} className={styles.priceHistoryItem} style={{ border: '1px solid #f1f5f9', borderRadius: '8px', padding: '10px', background: '#f8fafc' }}>
                              <div className={styles.priceHistoryHeader} style={{ display: 'flex', gap: '6px', fontSize: '0.85rem', fontWeight: 750 }}>
                                <span className={styles.oldPrice} style={{ textDecoration: 'line-through', color: '#94a3b8' }}>${Math.round(h.oldPrice).toLocaleString()}</span>
                                <span style={{ color: '#64748b' }}> → </span>
                                <span className={styles.newPrice} style={{ color: '#10b981' }}>${Math.round(h.newPrice).toLocaleString()}</span>
                              </div>
                              <div className={styles.priceHistoryMeta} style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px' }}>
                                <span>{new Date(h.createdAt).toLocaleDateString()}</span>
                                {h.initiatorName && <span> • Менеджер: {h.initiatorName}</span>}
                                {h.reason && <span className={styles.priceReason} style={{ display: 'block', marginTop: '2px', fontStyle: 'italic' }}>Причина: {h.reason}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.8rem', margin: 0 }}>История цен пуста. Нажмите «Обновить».</p>
                      )}
                    </div>

                    {/* Действия */}
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.9rem', color: '#475569', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>История действий с помещением</strong>
                      {loadingHistory ? (
                        <div style={{ padding: '12px 0', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>Загрузка...</div>
                      ) : actionHistory.length === 0 ? (
                        <p style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.8rem', margin: 0 }}>Действий не зафиксировано.</p>
                      ) : (
                        <div className={styles.timeline} style={{ marginTop: '8px' }}>
                          {actionHistory.map(event => (
                            <div key={event.id} className={styles.timelineItem} style={{ paddingBottom: '16px' }}>
                              <div className={styles.timelineIcon} style={{ fontSize: '0.85rem' }}>{event.icon}</div>
                              <div className={styles.timelineContent}>
                                <div className={styles.timelineHeader} style={{ fontSize: '0.8rem' }}>
                                  <strong className={styles.timelineTitle}>{event.title}</strong>
                                  <span className={styles.timelineDate} style={{ fontSize: '0.7rem' }}>{new Date(event.date).toLocaleDateString()}</span>
                                </div>
                                <p className={styles.timelineDesc} style={{ fontSize: '0.75rem', marginTop: '2px' }}>{event.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>
              </div>

            </div>
          </>
        )}
      </div>

      {/* Модалка импорта Excel */}
      {showImportModal && (
        <div className={styles.modalOverlay} onClick={() => { setShowImportModal(false); setImportProjectId(''); }}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}><h2>Импорт каталога</h2><button className={styles.modalCloseBtn} onClick={() => { setShowImportModal(false); setImportProjectId(''); }}></button></div>
            <div className={styles.modalBody}>
              <div className={styles.formGroup} style={{ marginBottom: '14px' }}>
                <label>ЖК, в который импортировать</label>
                <select className={styles.leadSelect} value={importProjectId} onChange={e => setImportProjectId(e.target.value)}>
                  <option value="">-- Выберите ЖК --</option>
                  {projects.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.nameRu || p.name}</option>
                  ))}
                </select>
                <p className={styles.fileHint} style={{ marginTop: '6px' }}>
                  В файле заказчика нет колонки с названием ЖК — только корпус ("Building/Block", например "6A"). Все строки файла попадут в выбранный здесь ЖК; корпус возьмётся из файла и создастся автоматически, если его ещё нет.
                </p>
              </div>
              <div className={styles.modalDesc}>Загрузите файл Excel (.xlsx, .xls) с колонками:<br/><code>Building/Block, Floor, № Flat, Status, Rooms, Area (sq meters), ...</code> — как в отчёте заказчика (лист "Products"). Колонки "#" и "PTD" можно оставить как есть — они принимаются, но в базу не записываются.</div>
              <div className={`${styles.fileDropZone} ${importFile ? styles.dragActive : ''}`} onClick={() => document.getElementById('excelFileInput')?.click()}>
                <div className={styles.fileIcon}>Файл</div>
                <p><strong>Нажмите для выбора</strong> или перетащите файл</p>
                <p className={styles.fileHint}>Поддерживаются .xlsx, .xls (до 10 МБ)</p>
                <input id="excelFileInput" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setImportFile(e.target.files?.[0] || null)} className={styles.fileInput} />
              </div>
              {importFile && (
                <div className={styles.selectedFile}>
                  <span className={styles.fileName}>{importFile.name}</span>
                  <span className={styles.fileSize}>{(importFile.size / 1024).toFixed(1)} KB</span>
                  <button className={styles.removeFileBtn} onClick={() => setImportFile(null)}></button>
                </div>
              )}
              <div className={styles.formatExample}>
                <h4>Пример формата Excel (все колонки, как в файле заказчика)</h4>
                <div style={{ overflowX: 'auto' }}>
                <table className={styles.exampleTable}>
                  <thead><tr>
                    <th>#</th><th>Building/Block</th><th>Floor</th><th>№ Flat</th><th>PTD</th><th>Status</th><th>Rooms</th>
                    <th>Area (sq meters)</th><th>Living Area (sq meters)</th><th>Balcony (sq meters)</th><th>Contract #</th>
                    <th>Year</th><th>Month</th><th>Date</th><th>Registration in the Public Registry</th>
                    <th>Available for sale</th><th>Price Incl. VAT (Sq meters/$)</th><th>Full Price ($)</th>
                  </tr></thead>
                  <tbody>
                    <tr>
                      <td>1</td><td>6A</td><td>1</td><td>1</td><td>1</td><td>Available</td><td>1 Rooms Studio</td>
                      <td>45.5</td><td>42.1</td><td>3.4</td><td></td>
                      <td>2028</td><td>1</td><td>15.06.2026</td><td>No</td>
                      <td>Yes</td><td>1180</td><td>180000</td>
                    </tr>
                    <tr>
                      <td>2</td><td>6A</td><td>1</td><td>2</td><td>2</td><td>Available</td><td>Commercial</td>
                      <td>65.2</td><td>65.2</td><td>0</td><td></td>
                      <td>2028</td><td>1</td><td>15.06.2026</td><td>No</td>
                      <td>Yes</td><td>1000</td><td>250000</td>
                    </tr>
                  </tbody>
                </table>
                </div>
                <button className={styles.downloadTemplateBtn} onClick={downloadTemplate}>Скачать шаблон Excel</button>
              </div>
              <div className={styles.modalActions}>
                <button className={styles.modalCancelBtn} onClick={() => { setShowImportModal(false); setImportProjectId(''); }}>Отмена</button>
                <button className={styles.modalImportBtn} onClick={handleImport} disabled={loading || !importFile || !importProjectId}>{loading ? 'Импорт...' : 'Загрузить'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модалка создания квартиры */}
      {showCreateUnitModal && (
        <div className={styles.fullscreenModalOverlay}>
          <div className={styles.fullscreenModalContent}>
            <div className={styles.fullscreenModalHeader}>
              <h2 style={{ margin: 0 }}>Создание нового помещения</h2>
              <button onClick={() => setShowCreateUnitModal(false)} className={styles.closeBtn}>×</button>
            </div>

            <div className={styles.formGroup}>
              <label>Тип помещения *</label>
              <select className={styles.input} value={editUnitData.type} onChange={e => setEditUnitData({...editUnitData, type: e.target.value})}><option value="Apartment">Квартира</option><option value="Commercial">Коммерция</option><option value="Parking">Паркинг</option><option value="Storage">Кладовка</option></select>
            </div>
            <div className={styles.formGroup}>
              <label>Корпус *</label>
              <select className={styles.input} value={selectedBlockId} onChange={e => setSelectedBlockId(e.target.value)}>
                <option value="">Выберите корпус...</option>
                {blocksList.map(b => (<option key={b.id} value={b.id}>{b.projectName} — Корпус {b.number}</option>))}
              </select>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Номер квартиры *</label><input className={styles.input} value={editUnitData.number} onChange={e => setEditUnitData({...editUnitData, number: e.target.value})} /></div>
              <div className={styles.formGroup}><label>Этаж *</label><input type="number" className={styles.input} value={editUnitData.floor} onChange={e => setEditUnitData({...editUnitData, floor: e.target.value})} /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Площадь (м²) *</label><input type="number" step="0.1" className={styles.input} value={editUnitData.area} onChange={e => setEditUnitData({...editUnitData, area: e.target.value})} /></div>
              <div className={styles.formGroup}><label>Жилая площадь (м²)</label><input type="number" step="0.1" className={styles.input} value={editUnitData.livingArea} onChange={e => setEditUnitData({...editUnitData, livingArea: e.target.value})} /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Комнат *</label><input type="number" className={styles.input} value={editUnitData.rooms} onChange={e => setEditUnitData({...editUnitData, rooms: e.target.value})} /></div>
              <div className={styles.formGroup}><label>Цена (USD) *</label><input type="number" className={styles.input} value={editUnitData.price} onChange={e => setEditUnitData({...editUnitData, price: e.target.value})} /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Балкон (м²)</label><input type="number" step="0.1" className={styles.input} value={editUnitData.balconyArea} onChange={e => setEditUnitData({...editUnitData, balconyArea: e.target.value})} /></div>
              <div className={styles.formGroup}><label>Вид из окна</label><input className={styles.input} value={editUnitData.viewType} onChange={e => setEditUnitData({...editUnitData, viewType: e.target.value})} placeholder="На город, во двор..." /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Цена м² с НДС (USD)</label><input type="number" step="0.01" className={styles.input} value={editUnitData.pricePerSqmVAT} onChange={e => setEditUnitData({...editUnitData, pricePerSqmVAT: e.target.value})} /></div>
              <div className={styles.formGroup}><label>Номер контракта</label><input className={styles.input} value={editUnitData.contractNumber} onChange={e => setEditUnitData({...editUnitData, contractNumber: e.target.value})} placeholder="PB/SALES/001" /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Дата сдачи объекта</label><input type="date" className={styles.input} value={editUnitData.deliveryDate} onChange={e => setEditUnitData({...editUnitData, deliveryDate: e.target.value})} /></div>
              <div className={styles.formGroup}><label>Год сдачи</label><input type="number" className={styles.input} value={editUnitData.deliveryYear} onChange={e => setEditUnitData({...editUnitData, deliveryYear: e.target.value})} placeholder="2028" /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Месяц сдачи</label><input type="number" min="1" max="12" className={styles.input} value={editUnitData.deliveryMonth} onChange={e => setEditUnitData({...editUnitData, deliveryMonth: e.target.value})} placeholder="1–12" /></div>
              <div className={styles.formGroup}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '10px' }}>
                  <input type="checkbox" checked={editUnitData.availableForSale} onChange={e => setEditUnitData({...editUnitData, availableForSale: e.target.checked})} />
                  Доступна к продаже
                </label>
              </div>
            </div>
            <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
              <label>Изображение планировки (2D)</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  className={styles.input}
                  value={editUnitData.layoutUrl}
                  onChange={e => setEditUnitData({...editUnitData, layoutUrl: e.target.value})}
                  placeholder="Вставьте ссылку URL или выберите файл..."
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => document.getElementById('createUnitLayoutUpload')?.click()}
                  style={{ padding: '8px 12px', background: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                >
                   Обзор...
                </button>
                <input
                  id="createUnitLayoutUpload"
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFileUpload(e, 'create', 'layoutUrl')}
                />
              </div>
            </div>
            <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
              <label>Визуализация квартиры (3D)</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  className={styles.input}
                  value={editUnitData.layout3dUrl}
                  onChange={e => setEditUnitData({...editUnitData, layout3dUrl: e.target.value})}
                  placeholder="Вставьте ссылку URL 3D рендера..."
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => document.getElementById('createUnitLayout3dUpload')?.click()}
                  style={{ padding: '8px 12px', background: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                >
                   Обзор...
                </button>
                <input
                  id="createUnitLayout3dUpload"
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFileUpload(e, 'create', 'layout3dUrl')}
                />
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setShowCreateUnitModal(false)}>Отмена</button>
              <button className={styles.modalImportBtn} onClick={handleCreateUnit} disabled={loading}>Создать</button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка редактирования квартиры */}
      {showEditUnitModal && (
        <div className={styles.modalOverlay} onClick={() => setShowEditUnitModal(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Редактирование квартиры №{selectedUnit?.number}</h2>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Номер квартиры</label><input className={styles.input} value={editUnitData.number} onChange={e => setEditUnitData({...editUnitData, number: e.target.value})} /></div>
              <div className={styles.formGroup}><label>Этаж</label><input type="number" className={styles.input} value={editUnitData.floor} onChange={e => setEditUnitData({...editUnitData, floor: e.target.value})} /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Площадь (м²)</label><input type="number" step="0.1" className={styles.input} value={editUnitData.area} onChange={e => setEditUnitData({...editUnitData, area: e.target.value})} /></div>
              <div className={styles.formGroup}><label>Жилая площадь (м²)</label><input type="number" step="0.1" className={styles.input} value={editUnitData.livingArea} onChange={e => setEditUnitData({...editUnitData, livingArea: e.target.value})} /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Комнат</label><input type="number" className={styles.input} value={editUnitData.rooms} onChange={e => setEditUnitData({...editUnitData, rooms: e.target.value})} /></div>
              <div className={styles.formGroup}><label>Цена (USD)</label><input type="number" className={styles.input} value={editUnitData.price} onChange={e => setEditUnitData({...editUnitData, price: e.target.value})} /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Тип</label><select className={styles.input} value={editUnitData.type} onChange={e => setEditUnitData({...editUnitData, type: e.target.value})}><option value="Apartment">Квартира</option><option value="Commercial">Коммерция</option><option value="Parking">Паркинг</option><option value="Storage">Кладовка</option></select></div>
              <div className={styles.formGroup}><label>Вид из окна</label><input className={styles.input} value={editUnitData.viewType} onChange={e => setEditUnitData({...editUnitData, viewType: e.target.value})} /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Балкон (м²)</label><input type="number" step="0.1" className={styles.input} value={editUnitData.balconyArea} onChange={e => setEditUnitData({...editUnitData, balconyArea: e.target.value})} /></div>
              <div className={styles.formGroup}><label>Цена м² с НДС (USD)</label><input type="number" step="0.01" className={styles.input} value={editUnitData.pricePerSqmVAT} onChange={e => setEditUnitData({...editUnitData, pricePerSqmVAT: e.target.value})} /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Номер контракта</label><input className={styles.input} value={editUnitData.contractNumber} onChange={e => setEditUnitData({...editUnitData, contractNumber: e.target.value})} placeholder="PB/SALES/001" /></div>
              <div className={styles.formGroup}><label>Дата сдачи объекта</label><input type="date" className={styles.input} value={editUnitData.deliveryDate} onChange={e => setEditUnitData({...editUnitData, deliveryDate: e.target.value})} /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}><label>Год сдачи</label><input type="number" className={styles.input} value={editUnitData.deliveryYear} onChange={e => setEditUnitData({...editUnitData, deliveryYear: e.target.value})} placeholder="2028" /></div>
              <div className={styles.formGroup}><label>Месяц сдачи</label><input type="number" min="1" max="12" className={styles.input} value={editUnitData.deliveryMonth} onChange={e => setEditUnitData({...editUnitData, deliveryMonth: e.target.value})} placeholder="1–12" /></div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editUnitData.registeredInPublicRegistry} onChange={e => setEditUnitData({...editUnitData, registeredInPublicRegistry: e.target.checked})} />
                  Зарегистрировано в публичном реестре
                </label>
              </div>
              <div className={styles.formGroup}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editUnitData.availableForSale} onChange={e => setEditUnitData({...editUnitData, availableForSale: e.target.checked})} />
                  Доступна к продаже
                </label>
              </div>
            </div>
            <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
              <label>Изображение планировки (2D)</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input 
                  type="text" 
                  className={styles.input} 
                  value={editUnitData.layoutUrl} 
                  onChange={e => setEditUnitData({...editUnitData, layoutUrl: e.target.value})} 
                  placeholder="Вставьте ссылку URL или выберите файл..."
                  style={{ flex: 1 }}
                />
                <button 
                  type="button"
                  onClick={() => document.getElementById('editUnitLayoutUpload')?.click()}
                  style={{ padding: '8px 12px', background: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                >
                   Обзор...
                </button>
                <input 
                  id="editUnitLayoutUpload" 
                  type="file" 
                  accept="image/*" 
                  style={{ display: 'none' }} 
                  onChange={(e) => handleFileUpload(e, 'edit', 'layoutUrl')} 
                />
              </div>
            </div>
            <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
              <label>Визуализация квартиры (3D)</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input 
                  type="text" 
                  className={styles.input} 
                  value={editUnitData.layout3dUrl} 
                  onChange={e => setEditUnitData({...editUnitData, layout3dUrl: e.target.value})} 
                  placeholder="Вставьте ссылку URL 3D рендера..."
                  style={{ flex: 1 }}
                />
                <button 
                  type="button"
                  onClick={() => document.getElementById('editUnitLayout3dUpload')?.click()}
                  style={{ padding: '8px 12px', background: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                >
                   Обзор...
                </button>
                <input 
                  id="editUnitLayout3dUpload" 
                  type="file" 
                  accept="image/*" 
                  style={{ display: 'none' }} 
                  onChange={(e) => handleFileUpload(e, 'edit', 'layout3dUrl')} 
                />
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setShowEditUnitModal(false)}>Отмена</button>
              <button className={styles.modalImportBtn} onClick={handleUpdateUnit} disabled={loading}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка Конструктора ЖК и корпусов */}
      {showConstructorModal && (
        <div className={styles.modalOverlay} onClick={() => setShowConstructorModal(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ width: '100vw', maxWidth: '900px', maxHeight: '95vh', overflowY: 'auto' }}>
            <div className={styles.modalHeader}>
              <h2> Конструктор ЖК и Корпусов</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowConstructorModal(false)}></button>
            </div>
            
            {/* Вкладки */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: '20px' }}>
              <button 
                type="button" 
                onClick={() => setConstructorTab('PROJECT')}
                style={{ 
                  flex: 1, 
                  padding: '12px', 
                  border: 'none', 
                  background: 'none', 
                  fontSize: '14px', 
                  fontWeight: 700,
                  cursor: 'pointer',
                  color: constructorTab === 'PROJECT' ? '#1d4ed8' : '#64748b',
                  borderBottom: constructorTab === 'PROJECT' ? '2.5px solid #1d4ed8' : 'none'
                }}
              >
                1. Создать новый ЖК
              </button>
              <button 
                type="button" 
                onClick={() => setConstructorTab('BLOCK')}
                style={{ 
                  flex: 1, 
                  padding: '12px', 
                  border: 'none', 
                  background: 'none', 
                  fontSize: '14px', 
                  fontWeight: 700,
                  cursor: 'pointer',
                  color: constructorTab === 'BLOCK' ? '#1d4ed8' : '#64748b',
                  borderBottom: constructorTab === 'BLOCK' ? '2.5px solid #1d4ed8' : 'none'
                }}
              >
                2. Сгенерировать Шахматку
              </button>
            </div>

            {/* Вкладка 1: Создание ЖК */}
            {constructorTab === 'PROJECT' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className={styles.formRow}>
                  <div className={styles.formGroup} style={{ flex: 1.5 }}>
                    <label>Название ЖК *</label>
                    <input 
                      className={styles.input} 
                      placeholder="Например: ЖК Park Boulevard"
                      value={newProjectData.name} 
                      onChange={e => setNewProjectData({...newProjectData, name: e.target.value})} 
                    />
                  </div>
                  <div className={styles.formGroup} style={{ flex: 1 }}>
                    <label>Код проекта *</label>
                    <input 
                      className={styles.input} 
                      placeholder="Например: PB"
                      value={newProjectData.code} 
                      onChange={e => setNewProjectData({...newProjectData, code: e.target.value})} 
                    />
                  </div>
                </div>
                
                <div className={styles.formGroup}>
                  <label>Адрес ЖК</label>
                  <input 
                    className={styles.input} 
                    placeholder="Например: г. Тбилиси, ул. Руставели 12"
                    value={newProjectData.address} 
                    onChange={e => setNewProjectData({...newProjectData, address: e.target.value})} 
                  />
                </div>

                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Дата ввода в эксплуатацию</label>
                    <input 
                      type="date" 
                      className={styles.input} 
                      value={newProjectData.expectedCompletionDate} 
                      onChange={e => setNewProjectData({...newProjectData, expectedCompletionDate: e.target.value})} 
                    />
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label>Описание проекта</label>
                  <textarea 
                    className={styles.input} 
                    style={{ minHeight: '80px', resize: 'vertical' }}
                    placeholder="Параметры и особенности жилого комплекса..."
                    value={newProjectData.description} 
                    onChange={e => setNewProjectData({...newProjectData, description: e.target.value})} 
                  />
                </div>

                <div className={styles.modalActions} style={{ marginTop: '10px' }}>
                  <button className={styles.modalCancelBtn} onClick={() => setShowConstructorModal(false)}>Отмена</button>
                  <button className={styles.modalImportBtn} onClick={handleCreateProject} disabled={loading}>
                    {loading ? 'Создание...' : 'Создать ЖК'}
                  </button>
                </div>
              </div>
            )}

            {/* Вкладка 2: Создание Корпуса и генерация шахматки */}
            {constructorTab === 'BLOCK' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className={styles.formRow}>
                  <div className={styles.formGroup} style={{ flex: 1.5 }}>
                    <label>Выберите ЖК *</label>
                    <select 
                      className={styles.input} 
                      value={newBlockData.projectId} 
                      onChange={e => setNewBlockData({...newBlockData, projectId: e.target.value})}
                    >
                      <option value="">Выберите проект...</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className={styles.formGroup} style={{ flex: 1 }}>
                    <label>Номер/Имя корпуса *</label>
                    <input 
                      className={styles.input} 
                      placeholder="Например: Блок А"
                      value={newBlockData.blockNumber} 
                      onChange={e => setNewBlockData({...newBlockData, blockNumber: e.target.value})} 
                    />
                  </div>
                </div>

                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Кол-во этажей</label>
                    <input
                      type="number" min="1" className={styles.input}
                      value={newBlockData.floorCount}
                      onChange={e => setNewBlockData({...newBlockData, floorCount: parseInt(e.target.value) || 0})}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Кол-во подъездов</label>
                    <input
                      type="number" min="1" className={styles.input}
                      value={newBlockData.entranceCount}
                      onChange={e => setNewBlockData({...newBlockData, entranceCount: parseInt(e.target.value) || 0})}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Квартир на этаж/подъезд</label>
                    <input
                      type="number" min="1" className={styles.input}
                      value={newBlockData.unitsPerFloorPerEntrance}
                      onChange={e => {
                        const count = parseInt(e.target.value) || 0;
                        setNewBlockData({...newBlockData, unitsPerFloorPerEntrance: count});
                        syncTemplates(count, { area: newBlockData.defaultArea, pricePerSqm: newBlockData.defaultPricePerSqm, rooms: newBlockData.defaultRooms });
                      }}
                    />
                  </div>
                </div>

                {/* Таблица шаблонов по позициям — появляется когда заполнены основные параметры */}
                {newBlockData.unitsPerFloorPerEntrance > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <label style={{ fontWeight: 700, color: '#1e293b' }}>
                        Параметры квартир по позициям на этаже
                      </label>
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                        Применяется ко всем {newBlockData.floorCount} этажам и {newBlockData.entranceCount} подъездам
                      </span>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}>Позиция</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}>Комнат</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}>Площадь (м²)</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}>Цена за м² ($)</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}>Итого ($)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: newBlockData.unitsPerFloorPerEntrance }).map((_, i) => {
                          const tpl = unitTemplates[i] || { area: newBlockData.defaultArea, pricePerSqm: newBlockData.defaultPricePerSqm, rooms: newBlockData.defaultRooms };
                          const total = Math.round(tpl.area * tpl.pricePerSqm);
                          return (
                            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '8px 12px', color: '#94a3b8', fontWeight: 700 }}>
                                {i + 1}-я кв.
                              </td>
                              <td style={{ padding: '8px 12px' }}>
                                <input
                                  type="number" min="1" max="10"
                                  className={styles.input}
                                  style={{ width: '70px', padding: '6px 8px' }}
                                  value={tpl.rooms}
                                  onChange={e => {
                                    const next = [...unitTemplates];
                                    while (next.length <= i) next.push({ area: newBlockData.defaultArea, pricePerSqm: newBlockData.defaultPricePerSqm, rooms: newBlockData.defaultRooms });
                                    next[i] = { ...next[i], rooms: parseInt(e.target.value) || 1 };
                                    setUnitTemplates(next);
                                  }}
                                />
                              </td>
                              <td style={{ padding: '8px 12px' }}>
                                <input
                                  type="number" step="0.1" min="1"
                                  className={styles.input}
                                  style={{ width: '100px', padding: '6px 8px' }}
                                  value={tpl.area}
                                  onChange={e => {
                                    const next = [...unitTemplates];
                                    while (next.length <= i) next.push({ area: newBlockData.defaultArea, pricePerSqm: newBlockData.defaultPricePerSqm, rooms: newBlockData.defaultRooms });
                                    next[i] = { ...next[i], area: parseFloat(e.target.value) || 0 };
                                    setUnitTemplates(next);
                                  }}
                                />
                              </td>
                              <td style={{ padding: '8px 12px' }}>
                                <input
                                  type="number" min="1"
                                  className={styles.input}
                                  style={{ width: '100px', padding: '6px 8px' }}
                                  value={tpl.pricePerSqm}
                                  onChange={e => {
                                    const next = [...unitTemplates];
                                    while (next.length <= i) next.push({ area: newBlockData.defaultArea, pricePerSqm: newBlockData.defaultPricePerSqm, rooms: newBlockData.defaultRooms });
                                    next[i] = { ...next[i], pricePerSqm: parseFloat(e.target.value) || 0 };
                                    setUnitTemplates(next);
                                  }}
                                />
                              </td>
                              <td style={{ padding: '8px 12px', fontWeight: 700, color: '#1e293b' }}>
                                ${total.toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p style={{ marginTop: '8px', fontSize: '0.78rem', color: '#94a3b8' }}>
                      Квартиры на одной позиции в разных подъездах имеют одинаковую планировку
                    </p>
                  </div>
                )}

                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Ожидаемая дата сдачи</label>
                    <input 
                      type="date" 
                      className={styles.input} 
                      value={newBlockData.expectedCommissioningDate} 
                      onChange={e => setNewBlockData({...newBlockData, expectedCommissioningDate: e.target.value})} 
                    />
                  </div>
                </div>

                <div className={styles.modalActions} style={{ marginTop: '10px' }}>
                  <button className={styles.modalCancelBtn} onClick={() => setShowConstructorModal(false)}>Отмена</button>
                  <button className={styles.modalImportBtn} onClick={handleGenerateBlock} disabled={loading}>
                    {loading ? 'Генерация...' : 'Сгенерировать Шахматку'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Скрытый контейнер для генерации PDF */}
      {selectedUnit && (
        <div id="pdf-print-template" style={{ position: 'absolute', left: '-9999px', top: 0, width: '794px', padding: '40px', background: '#ffffff', fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
          {/* Шапка бланка */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '20px', marginBottom: '30px' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '-0.5px' }}>
                {currentProject?.name}
              </h1>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                {currentProject?.address || 'Мангилик Ел, Астана'}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '18px', fontWeight: 850, color: '#0f172a' }}>ПАСПОРТ ОБЪЕКТА</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>Сформирован: {new Date().toLocaleDateString('ru-RU')}</div>
            </div>
          </div>

          {/* Контент бланка */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '30px', marginBottom: '30px' }}>
            
            {/* Левая колонка: Изображение планировки */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', color: '#64748b', alignSelf: 'flex-start' }}>
                Планировочное решение (2D)
              </h3>
              <UnitLayoutSvg rooms={selectedUnit.rooms} area={selectedUnit.area} layoutUrl={selectedUnit.layoutUrl} width="100%" height={420} />
            </div>

            {/* Правая колонка: Характеристики */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              <div style={{ background: '#eff6ff', borderRadius: '16px', padding: '20px', border: '1px solid #bfdbfe' }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#1e40af', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                  Номер помещения
                </span>
                <span style={{ fontSize: '28px', fontWeight: 900, color: '#1e3a8a' }}>
                  Квартира №{selectedUnit.number}
                </span>
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#1e40af', fontWeight: 700 }}>
                  Корпус/Блок: {currentBlock?.number} • Этаж: {selectedUnit.floor}
                </div>
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
                  Параметры объекта
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px', fontSize: '14px' }}>
                    <span style={{ color: '#64748b' }}>Общая площадь:</span>
                    <span style={{ fontWeight: 700 }}>{selectedUnit.area} м²</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px', fontSize: '14px' }}>
                    <span style={{ color: '#64748b' }}>Количество комнат:</span>
                    <span style={{ fontWeight: 700 }}>{selectedUnit.rooms}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px', fontSize: '14px' }}>
                    <span style={{ color: '#64748b' }}>Тип недвижимости:</span>
                    <span style={{ fontWeight: 700 }}>{selectedUnit.type === 'Apartment' ? 'Жилая (Квартира)' : selectedUnit.type}</span>
                  </div>
                  {selectedUnit.viewType && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px', fontSize: '14px' }}>
                      <span style={{ color: '#64748b' }}>Вид из окон:</span>
                      <span style={{ fontWeight: 700 }}>{selectedUnit.viewType}</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', background: '#f8fafc' }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                  Стоимость предложения
                </span>
                <span style={{ fontSize: '24px', fontWeight: 900, color: '#0f172a', display: 'block' }}>
                  ${Number(selectedUnit.price).toLocaleString()}
                </span>
              </div>

            </div>

          </div>

          {/* Описание преимуществ */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '40px' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 800, color: '#0f172a', textTransform: 'uppercase' }}>
              ОПИСАНИЕ ОБЪЕКТА
            </h4>
            <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: '1.6' }}>
              Современное планировочное решение с рациональным использованием площади. Объект располагается в престижном жилом комплексе с развитой инфраструктурой, благоустроенным двором и прямым доступом к ключевым прогулочным зонам города. Идеально подходит как для проживания, так и для инвестиционных целей.
            </p>
          </div>

          {/* Футер бланка */}
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '20px', textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
            <p style={{ margin: '0 0 4px 0' }}>Данное предложение носит ознакомительный характер и не является публичной офертой.</p>
            <p style={{ margin: 0, fontWeight: 600, color: '#64748b' }}>Отдел продаж | CRM Модуль Недвижимости</p>
          </div>
        </div>
      )}

      {dossierLead && (
        <LeadDossier
          lead={dossierLead}
          projects={projects}
          onClose={() => setDossierLead(null)}
          organizationId={organizationId}
        />
      )}
    </div>
  );
}