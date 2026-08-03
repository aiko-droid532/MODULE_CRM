"use client";

import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import styles from "./Reports.module.css";

// Список всех 25 отчетов с разбивкой по категориям
const REPORT_CATALOG = [
  // 1. Воронка и продажи
  {
    id: "RPT-001",
    name: "Воронка продаж",
    description:
      "Распределение сделок по этапам в деньгах и количестве с расчетом конверсий.",
    category: "sales",
    isCritical: true,
  },
  {
    id: "RPT-002",
    name: "План/факт продаж по ЖК",
    description:
      "Сопоставление плана продаж в деньгах и квартирах сWon-сделками по проектам.",
    category: "sales",
    isCritical: true,
  },
  {
    id: "RPT-003",
    name: "План/факт по менеджерам",
    description:
      "Индивидуальные рейтинги выполнения планов менеджерами по объему продаж.",
    category: "sales",
    isCritical: true,
  },
  {
    id: "RPT-004",
    name: "Сводный отчет по продажам",
    description:
      "Денежный поток от продаж: суммы подписанных договоров, оплат и ожидаемых платежей.",
    category: "sales",
    isCritical: true,
  },
  {
    id: "RPT-005",
    name: "Реестр заявок на договор",
    description:
      "Все заявки на договор со статусами согласования и временем обработки (идентификация bottleneck).",
    category: "sales",
    isCritical: false,
  },
  {
    id: "RPT-006",
    name: "Динамика продаж",
    description:
      "Сравнение посещений, заявок, броней и платежей между периодами. Тренд-анализ.",
    category: "sales",
    isCritical: false,
  },
  {
    id: "RPT-007",
    name: "Когортный анализ клиентов",
    description:
      "Группировка клиентов по когортам первого контакта. Время до успешной сделки.",
    category: "sales",
    isCritical: false,
    hidden: true, // <-- скрыт
  },

  // 2. Финансы
  {
    id: "RPT-008",
    name: "Реестр платежей",
    description:
      "Все плановые и фактические платежи по договорам. Контроль соответствия графику.",
    category: "finance",
    isCritical: true,
  },
  {
    id: "RPT-009",
    name: "Реестр дебиторской задолженности",
    description:
      "Сделки с просроченными платежами, количество дней просрочки и расчет пени.",
    category: "finance",
    isCritical: true,
  },
  {
    id: "RPT-010",
    name: "Сводный денежный поток",
    description:
      "Прогноз поступлений по графику платежей и сопоставление с финансовым планом.",
    category: "finance",
    isCritical: false,
  },
  {
    id: "RPT-011",
    name: "Отчет по индивидуальным скидкам",
    description:
      "Все скидки выше порогов (от 3%) с указанием инициатора, согласующего и маржинальности.",
    category: "finance",
    isCritical: false,
  },
  {
    id: "RPT-012",
    name: "Отчет по ипотечным сделкам",
    description:
      "Сделки в рассрочку/ипотеку с разбивкой по банкам (TBC, BoG) и конверсией выдачи.",
    category: "finance",
    isCritical: false,
    hidden: true, // скрыт по просьбе заказчика — не удалять, оставить в коде
  },
  {
    id: "RPT-013",
    name: "Отчет по выписанным e-invoice",
    description:
      "Налоговые инвойсы, отправленные в систему RS.ge, и их текущие статусы.",
    category: "finance",
    isCritical: false,
    hidden: true, // скрыт по просьбе заказчика — не удалять, оставить в коде
  },
  {
    id: "RPT-014",
    name: "Отчет по эскроу",
    description:
      "Сделки со счетами эскроу. Депонированные и раскрытые суммы по этапам.",
    category: "finance",
    isCritical: false,
    hidden: true, // скрыт по просьбе заказчика — не удалять, оставить в коде
  },

  // 3. Объекты и остатки
  {
    id: "RPT-015",
    name: "Остатки помещений (Свободные)",
    description:
      "Свободные квартиры по ЖК с детализацией по площадям, типам и ценам. Реестр Available.",
    category: "units",
    isCritical: false,
  },
  {
    id: "RPT-016",
    name: "Реализованные помещения",
    description:
      "Список всех проданных квартир за период. Средняя цена за квадратный метр.",
    category: "units",
    isCritical: false,
  },
  {
    id: "RPT-017",
    name: "Экспозиция объектов",
    description:
      "Доля проданных квартир к общему фонду по каждому ЖК. Процент выполнения проекта.",
    category: "units",
    isCritical: false,
  },
  {
    id: "RPT-018",
    name: "Поиск свободных помещений",
    description:
      "Поиск по характеристикам квартир (цена, вид, площадь, этаж) под запросы клиентов.",
    category: "units",
    isCritical: false,
  },
  {
    id: "RPT-019",
    name: "Журнал изменения цен (PriceHistory)",
    description:
      "Полный аудит переоценок квартир с автором изменения, датой и причиной.",
    category: "units",
    isCritical: false,
  },
  {
    id: "RPT-020",
    name: "Отчет по площадям (Проект vs Факт)",
    description:
      "Сравнение проектной и фактической площади после обмеров БТИ для перерасчетов.",
    category: "units",
    isCritical: false,
  },

  // 4. Клиенты
  {
    id: "RPT-021",
    name: "Реестр VIP-клиентов",
    description:
      "Клиенты с пометкой VIP, суммами сделок и историей активности.",
    category: "clients",
    isCritical: false,
    hidden: true, // <-- скрыт
  },
  {
    id: "RPT-022",
    name: "Анкетные данные по клиентам",
    description:
      "Профили клиентов с контактами, маскированием ПД по ролям и UTM-источниками.",
    category: "clients",
    isCritical: false,
  },

  // 5. Эффективность
  {
    id: "RPT-023",
    name: "Эффективность менеджеров",
    description:
      "KPI менеджеров: число звонков, встреч, броней, конверсия сделок и время цикла.",
    category: "efficiency",
    isCritical: true,
  },
  {
    id: "RPT-024",
    name: "Эффективность маркетинговых каналов",
    description:
      "Анализ лидогенерации по UTM-источникам (Instagram, SS.ge, Myhome) с расчетом ROI.",
    category: "efficiency",
    isCritical: true,
  },
  {
    id: "RPT-025",
    name: "Отчет по броням",
    description:
      "Статистика активных и снятых устных/платных броней с причинами отмены.",
    category: "efficiency",
    isCritical: false,
  },
];

const IMPLEMENTED_REPORTS = [
  "RPT-001",
  "RPT-002",
  "RPT-003",
  "RPT-004",
  "RPT-005",
  "RPT-006",
  "RPT-007",
  "RPT-008",
  "RPT-009",
  "RPT-010",
  "RPT-011",
  "RPT-012",
  "RPT-013",
  "RPT-014",
  "RPT-015",
  "RPT-016",
  "RPT-017",
  "RPT-018",
  "RPT-019",
  "RPT-020",
  "RPT-021",
  "RPT-022",
  "RPT-023",
  "RPT-024",
  "RPT-025",
];

const CATEGORIES = [
  { id: "sales", name: "Воронка и продажи" },
  // { id: "finance", name: "Финансы и оплаты" }, // <-- удалено
  { id: "units", name: "Квартиры и остатки" },
  { id: "clients", name: "Клиенты" },
  { id: "efficiency", name: "Эффективность" },
];

interface ReportsClientProps {
  organizationId: string;
  userRole?: string;
  projects: { id: string; name: string }[];
  managers: string[];
  blocks: { id: string; number: string; projectId: string }[];
  sources: string[];
  paymentTypes: string[];
  unitTypes: string[];
  initialData: {
    funnelData: any[];
    dealTransitions: any[];
    projectSales: any[];
    managerSales: any[];
    cashFlow: any[];
    paymentRegistry: any[];
    debtors: any[];
    cashFlowReport: any[];
    managerKpi: any[];
    marketingChannels: any;
    contractDrafts: any[];
    salesDynamics: {
      leads: any[];
      bookings: any[];
      contracts: any[];
      payments: any[];
      visits: any[];
      applications: any[];
    };
    cohortAnalysis: any[];
    discountReport: any[];
    mortgageReport: any[];
    taxInvoiceReport: any[];
    escrowReport: any[];

    availableUnits: any[];
    soldUnits: any[];
    projectExposure: any[];
    freeUnitsSearch: any[];
    priceHistory: any[];
    areaDiscrepancy: any[];
    vipClients: any[];
    clientDossier: any[];

    bookingReport: any[];
  };
  usdRate?: number;
}

const CHANNELS = [
  "Social Media",
  "Search Engine",
  "Messenger",
  "Portal",
  "Direct",
];

const CHANNEL_TRANSLATIONS: Record<string, string> = {
  "Social Media": "Социальные сети",
  "Search Engine": "Поисковые системы",
  Messenger: "Мессенджеры",
  Portal: "Порталы недвижимости",
  Direct: "Прямые переходы",
};

const UNIT_TYPE_TRANSLATIONS: Record<string, string> = {
  Apartment: "Квартира",
  APARTMENT: "Квартира",
  Commercial: "Коммерческое помещение",
  COMMERCIAL: "Коммерческое помещение",
  Penthouse: "Пентхаус",
  PENTHOUSE: "Пентхаус",
  Office: "Офис",
  OFFICE: "Офис",
  Parking: "Паркинг",
  PARKING: "Паркинг",
  Garage: "Гараж",
  GARAGE: "Гараж",
};

const PAYMENT_TYPE_TRANSLATIONS: Record<string, string> = {
  Installment: "Рассрочка",
  INSTALLMENT: "Рассрочка",
  Cash: "Наличные",
  CASH: "Наличные",
  Mortgage: "Ипотека",
  MORTGAGE: "Ипотека",
  Standard: "Стандартный платеж",
  STANDARD: "Стандартный платеж",
  None: "Не указана",
  NONE: "Не указана",
};

const LEAD_STATUS_TRANSLATIONS: Record<string, string> = {
  NEW: "Новый",
  IN_QUALIFICATION: "Квалификация",
  QUALIFIED: "Квалифицирован",
  IN_PROGRESS: "В работе",
  CONVERTED: "Конвертирован",
  LOST: "Потерян",
};

function maskPhone(phone: string | null | undefined, role?: string): string {
  if (!phone) return "—";
  const roleLower = (role || "").toLowerCase();
  if (
    [
      "admin",
      "administrator",
      "администратор",
      "админ",
      "director",
      "директор",
      "partner",
      "rop",
      "роп",
    ].includes(roleLower)
  ) {
    return phone;
  }
  const cleaned = phone.trim();
  if (cleaned.length <= 7) return "***";
  return (
    cleaned.substring(0, 4) + "***" + cleaned.substring(cleaned.length - 3)
  );
}

function maskEmail(email: string | null | undefined, role?: string): string {
  if (!email) return "—";
  const roleLower = (role || "").toLowerCase();
  if (
    [
      "admin",
      "administrator",
      "администратор",
      "админ",
      "director",
      "директор",
      "partner",
      "rop",
      "роп",
    ].includes(roleLower)
  ) {
    return email;
  }
  const parts = email.split("@");
  if (parts.length !== 2) return "***";
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 3) return "***@" + domain;
  return name.substring(0, 3) + "***@" + domain;
}

function maskIdNumber(
  identity: string | null | undefined,
  role?: string,
): string {
  if (!identity || identity === "Не указан" || identity.trim() === "")
    return "Не указан";
  const roleLower = (role || "").toLowerCase();
  if (
    [
      "admin",
      "administrator",
      "администратор",
      "админ",
      "director",
      "директор",
      "partner",
      "rop",
      "роп",
    ].includes(roleLower)
  ) {
    return identity;
  }
  const cleaned = identity.trim();
  if (cleaned.length <= 6) return "***";
  return (
    cleaned.substring(0, 3) + "***" + cleaned.substring(cleaned.length - 3)
  );
}

const STAGE_ORDER = [
  "NEW_LEAD",
  "CLARIFICATION",
  "CALL",
  "SECOND_CALL",
  "THIRD_CALL",
  "CONSULTATION",
  "PRE_RESERVATION",
  "RESERVATION",
  "MEETING",
  "CONTRACT_PREPARATION",
  "CONTRACT",
  "CLIENT_CONFIRMATION",
  "WAITING_PAYMENT",
  "SUCCESS",
];

const STAGE_TRANSLATIONS: Record<string, string> = {
  NEW_LEAD: "Новый интерес",
  CLARIFICATION: "Уточнение деталей",
  CALL: "Первый звонок",
  SECOND_CALL: "Повторный звонок",
  THIRD_CALL: "Решающий звонок",
  CONSULTATION: "Консультация",
  PRE_RESERVATION: "Предбронь",
  RESERVATION: "Устная бронь",
  MEETING: "Митинг",
  CONTRACT_PREPARATION: "Подготовка договора",
  CONTRACT: "Договор подписан",
  CLIENT_CONFIRMATION: "Подтверждение клиента",
  WAITING_PAYMENT: "Ожидание оплаты",
  SUCCESS: "Успешно завершено",
  FAILED: "Провал",
  CANCELLED: "Отменено",
};

const STAGE_PROBABILITIES: Record<string, number> = {
  NEW_LEAD: 0.05,
  CLARIFICATION: 0.1,
  CALL: 0.1,
  SECOND_CALL: 0.15,
  THIRD_CALL: 0.2,
  CONSULTATION: 0.25,
  PRE_RESERVATION: 0.4,
  RESERVATION: 0.6,
  MEETING: 0.7,
  CONTRACT_PREPARATION: 0.8,
  CONTRACT: 0.9,
  CLIENT_CONFIRMATION: 0.9,
  WAITING_PAYMENT: 0.95,
  SUCCESS: 1.0,
  FAILED: 0.0,
  CANCELLED: 0.0,
};

function getChannelBySource(source: string): string {
  if (!source) return "Direct";
  const s = source.toLowerCase();
  if (
    s.includes("instagram") ||
    s.includes("facebook") ||
    s.includes("fb") ||
    s.includes("insta")
  )
    return "Social Media";
  if (
    s.includes("google") ||
    s.includes("yandex") ||
    s.includes("seo") ||
    s.includes("search")
  )
    return "Search Engine";
  if (
    s.includes("telegram") ||
    s.includes("tg") ||
    s.includes("whatsapp") ||
    s.includes("viber")
  )
    return "Messenger";
  if (
    s.includes("ge") ||
    s.includes("portal") ||
    s.includes("myhome") ||
    s.includes("ss")
  )
    return "Portal";
  return "Direct";
}

export default function ReportsClient({
  organizationId,
  userRole = "manager",
  projects,
  managers,
  blocks,
  sources,
  paymentTypes,
  unitTypes,
  initialData,
  usdRate = 2.7,
}: ReportsClientProps) {
  const [activeCategory, setActiveCategory] = useState("sales");
  const [activeReportId, setActiveReportId] = useState("RPT-001");

  // Общие фильтры
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );
  const [selectedProject, setSelectedProject] = useState("ALL");

  // Дополнительные фильтры для RPT-001 - RPT-004
  const [selectedManager, setSelectedManager] = useState("ALL");
  const [selectedSource, setSelectedSource] = useState("ALL");
  const [selectedChannel, setSelectedChannel] = useState("ALL");
  const [selectedPaymentType, setSelectedPaymentType] = useState("ALL");
  const [selectedClientType, setSelectedClientType] = useState("ALL"); // 'ALL' | 'VIP' | 'REGULAR'
  const [selectedBlock, setSelectedBlock] = useState("ALL");
  const [selectedUnitType, setSelectedUnitType] = useState("ALL");
  const [funnelViewMode, setFunnelViewMode] = useState("pipeline"); // 'pipeline' | 'conversion'

  // Фильтры для RPT-008
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState("ALL"); // ALL | PAID | OVERDUE | PENDING

  // Фильтры для RPT-009
  const [selectedOverdueBucket, setSelectedOverdueBucket] = useState("ALL"); // ALL | 1-30 | 30-60 | 60-90 | 90+
  const [selectedDebtManager, setSelectedDebtManager] = useState("ALL");

  // Фильтры для RPT-010
  const [selectedCashFlowPaymentType, setSelectedCashFlowPaymentType] =
    useState("ALL");

  // Фильтры для RPT-011
  const [selectedDiscountRange, setSelectedDiscountRange] = useState("ALL"); // ALL | 0-3 | 3-5 | 5-10 | 10+
  const [selectedDiscountManager, setSelectedDiscountManager] = useState("ALL");

  // Фильтры для RPT-012
  const [selectedMortgageBank, setSelectedMortgageBank] = useState("ALL");
  const [selectedMortgageStatus, setSelectedMortgageStatus] = useState("ALL");

  // Фильтры для RPT-005
  const [draftStatusFilter, setDraftStatusFilter] = useState("ALL"); // ALL | IN_PROGRESS | APPROVED | REJECTED
  const [selectedInitiator, setSelectedInitiator] = useState("ALL");
  const [selectedApprover, setSelectedApprover] = useState("ALL");

  // Фильтры для RPT-006
  const [dynamicsInterval, setDynamicsInterval] = useState("month"); // day | week | month | quarter

  // Фильтры для RPT-007
  const [cohortInterval, setCohortInterval] = useState("month"); // week | month | quarter

  // Дополнительные фильтры для RPT-015 - RPT-020
  const [minArea, setMinArea] = useState("");
  const [maxArea, setMaxArea] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [filterFloor, setFilterFloor] = useState("");
  const [filterView, setFilterView] = useState("ALL");
  const [filterUnitNumber, setFilterUnitNumber] = useState("");
  const [filterInitiator, setFilterInitiator] = useState("ALL");
  const [dealStatusFilter, setDealStatusFilter] = useState("ALL");

  const [selectedBookingType, setSelectedBookingType] = useState("ALL");

  // Стейт для «Сформировать» — таблица и KPI-карточки показываются после нажатия
  const [reportGenerated, setReportGenerated] = useState(false);

  // Получаем текущий выбранный отчет
  const activeReport = useMemo(() => {
    return (
      REPORT_CATALOG.find((r) => r.id === activeReportId) || REPORT_CATALOG[0]
    );
  }, [activeReportId]);

  const initiators = useMemo(() => {
    return Array.from(
      new Set(
        initialData.contractDrafts
          .map((row: any) => row.initiator)
          .filter(Boolean),
      ),
    ) as string[];
  }, [initialData.contractDrafts]);

  const approvers = useMemo(() => {
    return Array.from(
      new Set(
        initialData.contractDrafts
          .map((row: any) => row.approver)
          .filter(Boolean),
      ),
    ) as string[];
  }, [initialData.contractDrafts]);

  // При смене отчёта — сбрасываем специфичные фильтры и скрываем таблицу
  const handleSelectReport = (id: string, catId: string) => {
    setActiveReportId(id);
    setActiveCategory(catId);
    setReportGenerated(false);
    setSelectedPaymentStatus("ALL");
    setSelectedOverdueBucket("ALL");
    setSelectedDebtManager("ALL");
    setSelectedCashFlowPaymentType("ALL");
    setSelectedDiscountRange("ALL");
    setSelectedDiscountManager("ALL");
    setSelectedMortgageBank("ALL");
    setSelectedMortgageStatus("ALL");
    setDraftStatusFilter("ALL");
    setSelectedInitiator("ALL");
    setSelectedApprover("ALL");
    setDynamicsInterval("month");
    setCohortInterval("month");
    setMinArea("");
    setMaxArea("");
    setMinPrice("");
    setMaxPrice("");
    setFilterFloor("");
    setFilterView("ALL");
    setFilterUnitNumber("");
    setFilterInitiator("ALL");
    setDealStatusFilter("ALL");

    // Для денежного потока расширяем период — показываем прогноз на год вперёд
    if (id === "RPT-010") {
      const yearAhead = new Date();
      yearAhead.setFullYear(yearAhead.getFullYear() + 1);
      setEndDate(yearAhead.toISOString().split("T")[0]);
    }
  };

  // Генерация тестовых (mock) данных для некритических отчетов
  const mockData = useMemo<any[]>(() => {
    const today = new Date().toISOString().split("T")[0];

    switch (activeReportId) {
      case "RPT-005":
        return [
          {
            "ID Заявки": "DFT-9821",
            Дата: today,
            Менеджер: "Алиев Р.",
            Клиент: "Мамедов А.",
            Статус: "На согласовании юриста",
            "Время в работе (ч)": 4.5,
          },
          {
            "ID Заявки": "DFT-9810",
            Дата: today,
            Менеджер: "Григорян К.",
            Клиент: "Иванов И.",
            Статус: "Одобрен",
            "Время в работе (ч)": 2.1,
          },
          {
            "ID Заявки": "DFT-9790",
            Дата: today,
            Менеджер: "Алиев Р.",
            Клиент: "Саркисян А.",
            Статус: "Отклонен",
            "Время в работе (ч)": 12.0,
          },
        ];
      case "RPT-006":
        return [
          {
            Период: "Июнь 2026",
            Лиды: 142,
            "Брони (Soft)": 38,
            Договоры: 15,
            "Сумма ($)": 1850000,
          },
          {
            Период: "Май 2026",
            Лиды: 120,
            "Брони (Soft)": 29,
            Договоры: 11,
            "Сумма ($)": 1320000,
          },
          {
            Период: "Апрель 2026",
            Лиды: 95,
            "Брони (Soft)": 20,
            Договоры: 8,
            "Сумма ($)": 920000,
          },
        ];
      case "RPT-007":
        return [
          {
            Когорта: "2026-05 (Май)",
            "Клиентов в когорте": 120,
            "Средний чек ($)": 120000,
            "Конверсия в Won": "9.2%",
            "Ср. цикл сделки (дн)": 14,
          },
          {
            Когорта: "2026-04 (Апр)",
            "Клиентов в когорте": 95,
            "Средний чек ($)": 115000,
            "Конверсия в Won": "8.4%",
            "Ср. цикл сделки (дн)": 16,
          },
          {
            Когорта: "2026-03 (Март)",
            "Клиентов в когорте": 80,
            "Средний чек ($)": 125000,
            "Конверсия в Won": "10.0%",
            "Ср. цикл сделки (дн)": 12,
          },
        ];

      case "RPT-015":
        return [
          {
            Квартира: "№102",
            ЖК: "Skyline Residence",
            Корпус: "Литера А",
            "Площадь (м²)": 48.5,
            Этаж: 3,
            Статус: "Свободно",
            "Цена ($)": 97000,
          },
          {
            Квартира: "№105",
            ЖК: "Skyline Residence",
            Корпус: "Литера А",
            "Площадь (м²)": 62.0,
            Этаж: 3,
            Статус: "Свободно",
            "Цена ($)": 124000,
          },
          {
            Квартира: "№202",
            ЖК: "Skyline Residence",
            Корпус: "Литера А",
            "Пло (м²)": 48.5,
            Этаж: 4,
            Статус: "Свободно",
            "Цена ($)": 99000,
          },
        ];
      case "RPT-016":
        return [
          {
            Квартира: "№303",
            ЖК: "Skyline Residence",
            "Площадь (м²)": 95.0,
            Этаж: 5,
            "Цена продажи ($)": 935416,
            "Дата продажи": today,
          },
          {
            Квартира: "№204",
            ЖК: "Skyline Residence",
            "Площадь (м²)": 52.4,
            Этаж: 4,
            "Цена продажи ($)": 420000,
            "Дата продажи": today,
          },
        ];
      case "RPT-017":
        return [
          {
            ЖК: "Skyline Residence",
            "Всего объектов": 120,
            Забронировано: 15,
            Продано: 42,
            "Доля реализации (%)": "35.0%",
            "Остаток фонда": 63,
          },
          {
            ЖК: "Green Valley",
            "Всего объектов": 80,
            Забронировано: 8,
            Продано: 58,
            "Доля реализации (%)": "72.5%",
            "Остаток фонда": 14,
          },
        ];
      case "RPT-018":
        return [
          {
            ЖК: "Skyline Residence",
            Тип: "Квартира",
            "Площадь (м²)": 52.4,
            "Цена ($)": 104800,
            Этаж: 4,
            "Вид из окна": "Море",
          },
          {
            ЖК: "Skyline Residence",
            Тип: "Квартира",
            "Площадь (м²)": 62.0,
            "Цена ($)": 124000,
            Этаж: 3,
            "Вид из окна": "Парк",
          },
        ];
      case "RPT-019":
        return [
          {
            Квартира: "№303",
            ЖК: "Skyline Residence",
            "Старая цена ($)": 910000,
            "Новая цена ($)": 935416,
            "Дата переоценки": today,
            Причина: "Индивидуальная наценка за вид",
          },
        ];
      case "RPT-020":
        return [
          {
            Квартира: "№102",
            ЖК: "Skyline Residence",
            "Проектная площадь (м²)": 48.5,
            "Фактическая площадь (м²)": 48.9,
            "Разница (м²)": "+0.4",
            "Статус взаиморасчетов": "Требуется доплата клиента ($800)",
          },
        ];
      case "RPT-021":
        return [
          {
            "ФИО Клиента": "Кайсар Бейсекбаев",
            ИИН: "AV86211",
            "Активных сделок": 1,
            "Общая сумма ($)": 935416,
            "Последнее действие": "Сопоставлена оплата выписки",
          },
        ];
      case "RPT-022":
        return [
          {
            "ФИО Клиента": "Кайсар Бейсекбаев",
            Телефон: "+995 599 *** 211",
            Email: "kai***@example.com",
            Адрес: "Тбилиси, ул. Руставели 12",
            "Канал связи": "WhatsApp",
          },
          {
            "ФИО Клиента": "Аслан Ислямов",
            Телефон: "+995 577 *** 554",
            Email: "asl***@example.com",
            Адрес: "Батуми, пр. Шерифа Химшиашвили 4",
            "Канал связи": "Telegram",
          },
        ];
      case "RPT-025":
        return [
          {
            Квартира: "№303",
            Клиент: "Кайсар Бейсекбаев",
            "Дата брони": today,
            Тип: "Временная бронь",
            Статус: "Снята (Сделка оформлена)",
          },
          {
            Квартира: "№110",
            Клиент: "Смирнова О.",
            "Дата брони": today,
            Тип: "Временная бронь",
            Статус: "Активна (Осталось 14 часов)",
          },
        ];
      default:
        return [];
    }
  }, [activeReportId]);

  // Обработка реальных данных для MVP-1 критических отчетов
  const activeReportData = useMemo<any[]>(() => {
    if (!IMPLEMENTED_REPORTS.includes(activeReport.id)) {
      return mockData;
    }

    switch (activeReport.id) {
      case "RPT-001": {
        // Воронка продаж
        const isPipeline = funnelViewMode === "pipeline";

        if (isPipeline) {
          // Фильтрация текущего пайплайна сделок
          const filtered = initialData.funnelData.filter((row: any) => {
            if (selectedProject !== "ALL" && row.projectId !== selectedProject)
              return false;
            if (selectedManager !== "ALL" && row.managerId !== selectedManager)
              return false;
            if (selectedSource !== "ALL" && row.source !== selectedSource)
              return false;
            if (
              selectedChannel !== "ALL" &&
              getChannelBySource(row.source) !== selectedChannel
            )
              return false;
            if (
              selectedPaymentType !== "ALL" &&
              row.paymentType !== selectedPaymentType
            )
              return false;
            if (selectedClientType !== "ALL") {
              if (selectedClientType === "VIP" && !row.isVip) return false;
              if (selectedClientType === "REGULAR" && row.isVip) return false;
            }
            if (startDate && row.createdAt && row.createdAt < startDate)
              return false;
            if (endDate && row.createdAt && row.createdAt > endDate)
              return false;
            return true;
          });

          // Агрегируем по этапам воронки
          const stagesMap: Record<string, { count: number; amount: number }> =
            {};
          STAGE_ORDER.forEach((st) => {
            stagesMap[st] = { count: 0, amount: 0 };
          });

          filtered.forEach((row: any) => {
            const stage = row.stage;
            if (stagesMap[stage] !== undefined) {
              stagesMap[stage].count += 1;
              stagesMap[stage].amount += row.amount;
            }
          });

          // Рассчитываем конверсии
          let prevCount = 0;
          const entryCount = filtered.length;

          return STAGE_ORDER.map((stage, idx) => {
            const stats = stagesMap[stage];
            const name = STAGE_TRANSLATIONS[stage] || stage;
            const amountUsd = stats.amount;
            const amountGel = stats.amount * usdRate; // Курс GEL к USD

            const convPrev =
              prevCount > 0
                ? parseFloat(((stats.count / prevCount) * 100).toFixed(1))
                : idx === 0
                  ? 100
                  : 0;
            const convEntry =
              entryCount > 0
                ? parseFloat(((stats.count / entryCount) * 100).toFixed(1))
                : 0;

            prevCount = stats.count;

            return {
              "Этап воронки": name,
              "Количество сделок": stats.count,
              "Сумма (USD)": Math.round(amountUsd),
              "Сумма (GEL)": Math.round(amountGel),
              "Конверсия от предыд. этапа (%)": convPrev + "%",
              "Конверсия от общего входа (%)": convEntry + "%",
            };
          });
        } else {
          // Исторические переходы из AuditLog (Conversion view)
          const filteredTransitions = initialData.dealTransitions.filter(
            (row: any) => {
              if (
                selectedProject !== "ALL" &&
                row.projectId !== selectedProject
              )
                return false;
              if (
                selectedManager !== "ALL" &&
                row.managerId !== selectedManager
              )
                return false;
              if (selectedSource !== "ALL" && row.source !== selectedSource)
                return false;
              if (
                selectedChannel !== "ALL" &&
                getChannelBySource(row.source) !== selectedChannel
              )
                return false;
              if (
                selectedPaymentType !== "ALL" &&
                row.paymentType !== selectedPaymentType
              )
                return false;
              if (selectedClientType !== "ALL") {
                if (selectedClientType === "VIP" && !row.isVip) return false;
                if (selectedClientType === "REGULAR" && row.isVip) return false;
              }
              if (startDate && row.createdAt && row.createdAt < startDate)
                return false;
              if (endDate && row.createdAt && row.createdAt > endDate)
                return false;
              return true;
            },
          );

          // Считаем уникальные сделки, прошедшие через каждый статус в выбранном периоде
          const stagesMap: Record<string, Set<string>> = {};
          const amountsMap: Record<string, number> = {};
          STAGE_ORDER.forEach((st) => {
            stagesMap[st] = new Set<string>();
            amountsMap[st] = 0;
          });

          filteredTransitions.forEach((row: any) => {
            const toStage = row.toStage;
            if (stagesMap[toStage] !== undefined) {
              stagesMap[toStage].add(row.dealId);
              amountsMap[toStage] += row.amount;
            }
          });

          let prevCount = 0;
          const entryCount = filteredTransitions.reduce(
            (acc: Set<string>, row: any) => acc.add(row.dealId),
            new Set<string>(),
          ).size;

          return STAGE_ORDER.map((stage, idx) => {
            const count = stagesMap[stage].size;
            const name = STAGE_TRANSLATIONS[stage] || stage;
            const amountUsd = amountsMap[stage];
            const amountGel = amountUsd * usdRate;

            const convPrev =
              prevCount > 0
                ? parseFloat(((count / prevCount) * 100).toFixed(1))
                : idx === 0
                  ? 100
                  : 0;
            const convEntry =
              entryCount > 0
                ? parseFloat(((count / entryCount) * 100).toFixed(1))
                : 0;

            prevCount = count;

            return {
              "Этап воронки": name,
              "Уникальных переходов": count,
              "Оборот этапа (USD)": Math.round(amountUsd),
              "Оборот этапа (GEL)": Math.round(amountGel),
              "Конверсия от предыд. этапа (%)": convPrev + "%",
              "Конверсия от входа воронки (%)": convEntry + "%",
            };
          });
        }
      }

      case "RPT-002": {
        // План/факт по ЖК
        const filteredSales = initialData.projectSales.filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (selectedBlock !== "ALL" && row.blockId !== selectedBlock)
            return false;
          if (selectedUnitType !== "ALL" && row.unitType !== selectedUnitType)
            return false;
          if (startDate && row.wonAt && row.wonAt < startDate) return false;
          if (endDate && row.wonAt && row.wonAt > endDate) return false;
          return true;
        });

        // Группируем выигранные продажи по ЖК
        const projectsMap: Record<
          string,
          {
            projectName: string;
            soldUnits: number;
            actualRevenue: number;
            targetUnits: number;
            targetRevenue: number;
            pipelineWeightedRevenue: number;
          }
        > = {};

        filteredSales.forEach((row: any) => {
          if (!projectsMap[row.projectId]) {
            projectsMap[row.projectId] = {
              projectName: row.projectName,
              soldUnits: 0,
              actualRevenue: 0,
              targetUnits: row.targetUnits || 10,
              targetRevenue: row.targetRevenue || 1500000.0,
              pipelineWeightedRevenue: 0,
            };
          }
          projectsMap[row.projectId].soldUnits += 1;
          projectsMap[row.projectId].actualRevenue += row.price;
        });

        // Считаем взвешенный пайплайн для прогноза закрытия периода по каждому ЖК
        const activeDeals = initialData.funnelData.filter((row: any) => {
          if (
            row.stage === "SUCCESS" ||
            row.stage === "FAILED" ||
            row.stage === "CANCELLED"
          )
            return false;
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          return true;
        });

        activeDeals.forEach((row: any) => {
          const prob = STAGE_PROBABILITIES[row.stage] || 0;
          const weightedAmount = row.amount * prob;
          const projId = row.projectId;

          if (projectsMap[projId]) {
            projectsMap[projId].pipelineWeightedRevenue += weightedAmount;
          } else {
            // Если по проекту не было успешных сделок, но есть пайплайн
            const projectObj = projects.find((p) => p.id === projId);
            if (projectObj) {
              projectsMap[projId] = {
                projectName: projectObj.name,
                soldUnits: 0,
                actualRevenue: 0,
                targetUnits: 10,
                targetRevenue: 1500000.0,
                pipelineWeightedRevenue: weightedAmount,
              };
            }
          }
        });

        return Object.values(projectsMap).map((p) => {
          const forecast = p.actualRevenue + p.pipelineWeightedRevenue;
          return {
            "Жилой Комплекс": p.projectName,
            "Продано (Юнитов)": p.soldUnits,
            "План (Юнитов)": p.targetUnits,
            "Выполнение по юнитам (%)":
              ((p.soldUnits / p.targetUnits) * 100).toFixed(1) + "%",
            "Выручка Факт ($)": Math.round(p.actualRevenue),
            "Выручка План ($)": Math.round(p.targetRevenue),
            "Выполнение по выручке (%)":
              ((p.actualRevenue / p.targetRevenue) * 100).toFixed(1) + "%",
            "Прогноз закрытия периода ($)": Math.round(forecast),
            "Отношение прогноза к плану (%)":
              ((forecast / p.targetRevenue) * 100).toFixed(1) + "%",
          };
        });
      }

      case "RPT-003": {
        // План/факт по менеджерам
        const filteredSales = initialData.managerSales.filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (selectedManager !== "ALL" && row.managerId !== selectedManager)
            return false;
          if (startDate && row.wonAt && row.wonAt < startDate) return false;
          if (endDate && row.wonAt && row.wonAt > endDate) return false;
          return true;
        });

        const managersMap: Record<
          string,
          {
            name: string;
            soldUnits: number;
            actualRevenue: number;
            targetUnits: number;
            targetRevenue: number;
          }
        > = {};

        filteredSales.forEach((row: any) => {
          const mgr = row.managerId;
          if (!managersMap[mgr]) {
            managersMap[mgr] = {
              name: mgr,
              soldUnits: 0,
              actualRevenue: 0,
              targetUnits: row.targetUnits || 5,
              targetRevenue: row.targetRevenue || 750000.0,
            };
          }
          managersMap[mgr].soldUnits += 1;
          managersMap[mgr].actualRevenue += row.price;
        });

        // Сортируем менеджеров по объему продаж (рейтинг)
        const sortedManagers = Object.values(managersMap).sort(
          (a, b) => b.actualRevenue - a.actualRevenue,
        );

        return sortedManagers.map((m, idx) => {
          const unitPerf =
            ((m.soldUnits / m.targetUnits) * 100).toFixed(1) + "%";
          const revPerf =
            ((m.actualRevenue / m.targetRevenue) * 100).toFixed(1) + "%";
          const kpiStatus =
            m.actualRevenue >= m.targetRevenue ? "Выполнен" : "В процессе";

          return {
            Рейтинг: idx + 1,
            Менеджер: m.name,
            "Продано (Юнитов)": m.soldUnits,
            "План (Юнитов)": m.targetUnits,
            "Выполнение (Юниты)": unitPerf,
            "Выручка Факт ($)": Math.round(m.actualRevenue),
            "Выручка План ($)": Math.round(m.targetRevenue),
            "Выполнение (Выручка)": revPerf,
            "Соответствие KPI": kpiStatus,
          };
        });
      }

      case "RPT-004": {
        // Сводный отчет по продажам
        const filtered = initialData.cashFlow.filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (selectedManager !== "ALL" && row.managerId !== selectedManager)
            return false;
          if (
            selectedPaymentType !== "ALL" &&
            row.paymentType !== selectedPaymentType
          )
            return false;
          if (startDate && row.createdAt && row.createdAt < startDate)
            return false;
          if (endDate && row.createdAt && row.createdAt > endDate) return false;
          return true;
        });

        return filtered.map((row: any) => ({
          Сделка: row.dealId.startsWith("test")
            ? "#Тестовая сделка"
            : `#${row.dealId.substring(0, 8).toUpperCase()}`,
          Клиент: row.clientName,
          Квартира: `№${row.unitNumber}`,
          "Сумма договора ($)": Math.round(row.contractAmount),
          "Поступило оплат ($)": Math.round(row.paidAmount),
          "Ожидается платежей ($)": Math.round(row.pendingAmount),
          "Схема оплаты":
            PAYMENT_TYPE_TRANSLATIONS[row.paymentType] ||
            row.paymentType ||
            "Не указана",
          Менеджер: row.managerId,
          "Дата заключения": row.createdAt,
        }));
      }

      case "RPT-005": {
        // Реестр заявок на договор
        const filtered = initialData.contractDrafts.filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (selectedManager !== "ALL" && row.managerName !== selectedManager)
            return false;
          if (
            startDate &&
            row.draftCreatedAt &&
            row.draftCreatedAt.substring(0, 10) < startDate
          )
            return false;
          if (
            endDate &&
            row.draftCreatedAt &&
            row.draftCreatedAt.substring(0, 10) > endDate
          )
            return false;

          let status = "IN_PROGRESS";
          if (row.draftApprovedAt) {
            status = "APPROVED";
          } else if (
            row.currentDealStatus === "FAILED" ||
            row.currentDealStatus === "CANCELLED"
          ) {
            status = "REJECTED";
          }

          if (draftStatusFilter !== "ALL" && status !== draftStatusFilter)
            return false;
          return true;
        });

        return filtered.map((row: any) => {
          let status = "В работе";
          let hours = 0;
          if (row.draftApprovedAt) {
            status = "Одобрен";
            hours =
              (new Date(row.draftApprovedAt).getTime() -
                new Date(row.draftCreatedAt).getTime()) /
              (1000 * 60 * 60);
          } else if (
            row.currentDealStatus === "FAILED" ||
            row.currentDealStatus === "CANCELLED"
          ) {
            status = "Отклонен";
            hours =
              (new Date().getTime() - new Date(row.draftCreatedAt).getTime()) /
              (1000 * 60 * 60);
          } else {
            status = "В работе";
            hours =
              (new Date().getTime() - new Date(row.draftCreatedAt).getTime()) /
              (1000 * 60 * 60);
          }

          return {
            Идентификатор: row.dealId.startsWith("test")
              ? "#Тестовая сделка"
              : `#${row.dealId.substring(0, 8).toUpperCase()}`,
            "Дата создания": row.draftCreatedAt
              ? row.draftCreatedAt.substring(0, 10)
              : "—",
            Менеджер: row.managerName || "Не назначен",
            Клиент: row.clientName || "Не указан",
            Проект: row.projectName || "—",
            Помещение: row.unitNumber ? `№${row.unitNumber}` : "—",
            Статус: status,
            "Время в работе (ч)": parseFloat(hours.toFixed(1)),
          };
        });
      }

      case "RPT-006": {
        // Динамика продаж
        const getIntervalKey = (dateStr: string) => {
          if (!dateStr) return "unknown";
          const d = new Date(dateStr);
          if (isNaN(d.getTime())) return "unknown";

          if (dynamicsInterval === "day") {
            return dateStr.substring(0, 10);
          }
          if (dynamicsInterval === "week") {
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(d.setDate(diff));
            return monday.toISOString().substring(0, 10);
          }
          if (dynamicsInterval === "month") {
            return dateStr.substring(0, 7);
          }
          if (dynamicsInterval === "quarter") {
            const quarter = Math.floor(d.getMonth() / 3) + 1;
            return `${d.getFullYear()}-Q${quarter}`;
          }
          return dateStr.substring(0, 10);
        };

        const groups: Record<
          string,
          {
            leads: number;
            visits: number;
            applications: number;
            bookings: number;
            contracts: number;
            contractAmount: number;
            paymentsAmount: number;
          }
        > = {};

        initialData.salesDynamics.leads.forEach((l: any) => {
          if (selectedProject !== "ALL" && l.projectId !== selectedProject)
            return;
          if (
            startDate &&
            l.createdAt &&
            l.createdAt.substring(0, 10) < startDate
          )
            return;
          if (endDate && l.createdAt && l.createdAt.substring(0, 10) > endDate)
            return;

          const key = getIntervalKey(l.createdAt);
          if (key === "unknown") return;
          if (!groups[key]) {
            groups[key] = {
              leads: 0,
              visits: 0,
              applications: 0,
              bookings: 0,
              contracts: 0,
              contractAmount: 0,
              paymentsAmount: 0,
            };
          }
          groups[key].leads += 1;
        });

        initialData.salesDynamics.visits.forEach((v: any) => {
          if (selectedProject !== "ALL" && v.projectId !== selectedProject)
            return;
          if (
            startDate &&
            v.visitedAt &&
            v.visitedAt.substring(0, 10) < startDate
          )
            return;
          if (endDate && v.visitedAt && v.visitedAt.substring(0, 10) > endDate)
            return;

          const key = getIntervalKey(v.visitedAt);
          if (key === "unknown") return;
          if (!groups[key]) {
            groups[key] = {
              leads: 0,
              visits: 0,
              applications: 0,
              bookings: 0,
              contracts: 0,
              contractAmount: 0,
              paymentsAmount: 0,
            };
          }
          groups[key].visits += 1;
        });

        initialData.salesDynamics.applications.forEach((a: any) => {
          if (selectedProject !== "ALL" && a.projectId !== selectedProject)
            return;
          if (
            startDate &&
            a.appliedAt &&
            a.appliedAt.substring(0, 10) < startDate
          )
            return;
          if (endDate && a.appliedAt && a.appliedAt.substring(0, 10) > endDate)
            return;

          const key = getIntervalKey(a.appliedAt);
          if (key === "unknown") return;
          if (!groups[key]) {
            groups[key] = {
              leads: 0,
              visits: 0,
              applications: 0,
              bookings: 0,
              contracts: 0,
              contractAmount: 0,
              paymentsAmount: 0,
            };
          }
          groups[key].applications += 1;
        });

        initialData.salesDynamics.bookings.forEach((b: any) => {
          if (selectedProject !== "ALL" && b.projectId !== selectedProject)
            return;
          if (
            startDate &&
            b.createdAt &&
            b.createdAt.substring(0, 10) < startDate
          )
            return;
          if (endDate && b.createdAt && b.createdAt.substring(0, 10) > endDate)
            return;

          const key = getIntervalKey(b.createdAt);
          if (key === "unknown") return;
          if (!groups[key]) {
            groups[key] = {
              leads: 0,
              visits: 0,
              applications: 0,
              bookings: 0,
              contracts: 0,
              contractAmount: 0,
              paymentsAmount: 0,
            };
          }
          groups[key].bookings += 1;
        });

        initialData.salesDynamics.contracts.forEach((c: any) => {
          if (selectedProject !== "ALL" && c.projectId !== selectedProject)
            return;
          if (
            startDate &&
            c.signedAt &&
            c.signedAt.substring(0, 10) < startDate
          )
            return;
          if (endDate && c.signedAt && c.signedAt.substring(0, 10) > endDate)
            return;

          const key = getIntervalKey(c.signedAt);
          if (key === "unknown") return;
          if (!groups[key]) {
            groups[key] = {
              leads: 0,
              visits: 0,
              applications: 0,
              bookings: 0,
              contracts: 0,
              contractAmount: 0,
              paymentsAmount: 0,
            };
          }
          groups[key].contracts += 1;
          groups[key].contractAmount += c.amount;
        });

        initialData.salesDynamics.payments.forEach((p: any) => {
          if (selectedProject !== "ALL" && p.projectId !== selectedProject)
            return;
          if (startDate && p.paidAt && p.paidAt.substring(0, 10) < startDate)
            return;
          if (endDate && p.paidAt && p.paidAt.substring(0, 10) > endDate)
            return;

          const key = getIntervalKey(p.paidAt);
          if (key === "unknown") return;
          if (!groups[key]) {
            groups[key] = {
              leads: 0,
              visits: 0,
              applications: 0,
              bookings: 0,
              contracts: 0,
              contractAmount: 0,
              paymentsAmount: 0,
            };
          }
          groups[key].paymentsAmount += p.paidAmount;
        });

        const formatPeriodLabel = (key: string) => {
          if (dynamicsInterval === "month") {
            const [year, mon] = key.split("-");
            const monthNames = [
              "",
              "Январь",
              "Февраль",
              "Март",
              "Апрель",
              "Май",
              "Июнь",
              "Июль",
              "Август",
              "Сентябрь",
              "Октябрь",
              "Ноябрь",
              "Декабрь",
            ];
            return `${monthNames[parseInt(mon)]} ${year}`;
          }
          if (dynamicsInterval === "week") {
            return `Неделя с ${key}`;
          }
          if (dynamicsInterval === "quarter") {
            const [year, q] = key.split("-");
            return `${q.replace("Q", "")} кв. ${year}`;
          }
          return key;
        };

        return Object.entries(groups)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, data]) => ({
            Период: formatPeriodLabel(key),
            Лиды: data.leads,
            Посещения: data.visits,
            Заявки: data.applications,
            Брони: data.bookings,
            Договоры: data.contracts,
            "Сумма договоров ($)": Math.round(data.contractAmount),
            "Поступило оплат ($)": Math.round(data.paymentsAmount),
          }));
      }

      case "RPT-007": {
        // Когортный анализ клиентов
        const getCohortKey = (dateStr: string) => {
          if (!dateStr) return "unknown";
          const d = new Date(dateStr);
          if (isNaN(d.getTime())) return "unknown";

          if (cohortInterval === "week") {
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(d.setDate(diff));
            return monday.toISOString().substring(0, 10);
          }
          if (cohortInterval === "month") {
            return dateStr.substring(0, 7);
          }
          if (cohortInterval === "quarter") {
            const quarter = Math.floor(d.getMonth() / 3) + 1;
            return `${d.getFullYear()}-Q${quarter}`;
          }
          return dateStr.substring(0, 7);
        };

        const cohorts: Record<
          string,
          {
            totalLeads: number;
            wonDeals: number;
            totalRevenue: number;
            totalCycleDays: number;
          }
        > = {};

        initialData.cohortAnalysis.forEach((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return;
          if (
            startDate &&
            row.leadCreatedAt &&
            row.leadCreatedAt.substring(0, 10) < startDate
          )
            return;
          if (
            endDate &&
            row.leadCreatedAt &&
            row.leadCreatedAt.substring(0, 10) > endDate
          )
            return;
          if (selectedSource !== "ALL" && row.source !== selectedSource) return;
          if (
            selectedChannel !== "ALL" &&
            getChannelBySource(row.source) !== selectedChannel
          )
            return;

          const key = getCohortKey(row.leadCreatedAt);
          if (key === "unknown") return;
          if (!cohorts[key]) {
            cohorts[key] = {
              totalLeads: 0,
              wonDeals: 0,
              totalRevenue: 0,
              totalCycleDays: 0,
            };
          }
          cohorts[key].totalLeads += 1;

          const isWon = row.dealStatus === "SUCCESS";
          if (isWon) {
            cohorts[key].wonDeals += 1;
            cohorts[key].totalRevenue += row.price || 0;

            if (row.leadCreatedAt && row.dealUpdatedAt) {
              const leadDate = new Date(row.leadCreatedAt);
              const dealDate = new Date(row.dealUpdatedAt);
              const diffDays = Math.max(
                0,
                (dealDate.getTime() - leadDate.getTime()) /
                  (1000 * 60 * 60 * 24),
              );
              cohorts[key].totalCycleDays += diffDays;
            }
          }
        });

        const formatCohortLabel = (key: string) => {
          if (cohortInterval === "month") {
            const [year, mon] = key.split("-");
            const monthNames = [
              "",
              "Январь",
              "Февраль",
              "Март",
              "Апрель",
              "Май",
              "Июнь",
              "Июль",
              "Август",
              "Сентябрь",
              "Октябрь",
              "Ноябрь",
              "Декабрь",
            ];
            return `${monthNames[parseInt(mon)]} ${year}`;
          }
          if (cohortInterval === "week") {
            return `Неделя с ${key}`;
          }
          if (cohortInterval === "quarter") {
            const [year, q] = key.split("-");
            return `${q.replace("Q", "")} кв. ${year}`;
          }
          return key;
        };

        return Object.entries(cohorts)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, data]) => {
            const avgCheck =
              data.wonDeals > 0
                ? Math.round(data.totalRevenue / data.wonDeals)
                : 0;
            const conversion =
              data.totalLeads > 0
                ? ((data.wonDeals / data.totalLeads) * 100).toFixed(1) + "%"
                : "0.0%";
            const avgCycle =
              data.wonDeals > 0
                ? Math.round(data.totalCycleDays / data.wonDeals)
                : 0;

            return {
              Когорта: formatCohortLabel(key),
              "Клиентов в когорте": data.totalLeads,
              "Средний чек ($)": avgCheck,
              "Конверсия в Won": conversion,
              "Ср. цикл сделки (дн)": avgCycle,
            };
          });
      }

      case "RPT-008": {
        // Реестр платежей
        const filtered = initialData.paymentRegistry.filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (startDate && row.dueDate < startDate) return false;
          if (endDate && row.dueDate > endDate) return false;
          if (
            selectedPaymentStatus !== "ALL" &&
            row.paymentStatus !== selectedPaymentStatus
          )
            return false;
          return true;
        });
        return filtered.map((row: any) => ({
          Сделка: `#${row.dealId.substring(0, 8).toUpperCase()}`,
          Клиент: row.clientName,
          Квартира: `№${row.unitNumber}`,
          "Сумма к оплате ($)": Math.round(row.scheduledAmount),
          "Срок оплаты": row.dueDate,
          "Оплачено факт ($)": Math.round(row.paidAmount),
          "Статус оплат":
            row.paymentStatus === "PAID"
              ? "Оплачено"
              : row.paymentStatus === "OVERDUE"
                ? "Просрочено"
                : "Ожидается",
        }));
      }

      case "RPT-009": {
        // Реестр дебиторской задолженности
        const filtered = initialData.debtors.filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (startDate && row.dueDate < startDate) return false;
          if (endDate && row.dueDate > endDate) return false;
          if (
            selectedDebtManager !== "ALL" &&
            row.managerId !== selectedDebtManager
          )
            return false;
          if (selectedOverdueBucket !== "ALL") {
            const d = row.daysOverdue;
            if (selectedOverdueBucket === "1-30" && !(d >= 1 && d <= 30))
              return false;
            if (selectedOverdueBucket === "30-60" && !(d > 30 && d <= 60))
              return false;
            if (selectedOverdueBucket === "60-90" && !(d > 60 && d <= 90))
              return false;
            if (selectedOverdueBucket === "90+" && !(d > 90)) return false;
          }
          return true;
        });
        return filtered.map((row: any) => {
          const d = row.daysOverdue;
          const bucket =
            d <= 30
              ? "1–30 дней"
              : d <= 60
                ? "31–60 дней"
                : d <= 90
                  ? "61–90 дней"
                  : "90+ дней";
          return {
            Сделка: `#${row.dealId.substring(0, 8).toUpperCase()}`,
            Клиент: row.clientName,
            Телефон: row.clientPhone,
            Квартира: `№${row.unitNumber}`,
            Менеджер: row.managerId,
            "Сумма долга ($)": Math.round(row.overdueAmount),
            "Срок платежа": row.dueDate,
            "Дней просрочки": row.daysOverdue,
            "Бакет просрочки": bucket,
            "Начислено пени ($)": Math.round(row.penalty),
            "Итого к оплате ($)": Math.round(row.totalDebt),
          };
        });
      }

      case "RPT-010": {
        // Сводный денежный поток
        const filtered = initialData.cashFlowReport.filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (
            selectedCashFlowPaymentType !== "ALL" &&
            row.paymentType !== selectedCashFlowPaymentType
          )
            return false;
          if (startDate && row.month < startDate.substring(0, 7)) return false;
          if (endDate && row.month > endDate.substring(0, 7)) return false;
          return true;
        });

        // Группируем по месяцу (суммируем по всем ЖК если не выбран конкретный)
        const byMonth: Record<string, { scheduled: number; paid: number }> = {};
        filtered.forEach((row: any) => {
          if (!byMonth[row.month])
            byMonth[row.month] = { scheduled: 0, paid: 0 };
          byMonth[row.month].scheduled += row.scheduledAmount;
          byMonth[row.month].paid += row.paidAmount;
        });

        return Object.entries(byMonth)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, data]) => {
            const isPast = month <= new Date().toISOString().substring(0, 7);
            const deviation = isPast
              ? Math.round(data.paid - data.scheduled)
              : null;
            const execution =
              isPast && data.scheduled > 0
                ? ((data.paid / data.scheduled) * 100).toFixed(1) + "%"
                : "—";
            // Форматируем месяц в читаемый вид
            const [year, mon] = month.split("-");
            const monthNames = [
              "",
              "Январь",
              "Февраль",
              "Март",
              "Апрель",
              "Май",
              "Июнь",
              "Июль",
              "Август",
              "Сентябрь",
              "Октябрь",
              "Ноябрь",
              "Декабрь",
            ];
            const label = `${monthNames[parseInt(mon)]} ${year}`;
            return {
              Месяц: label,
              ...(selectedCashFlowPaymentType !== "ALL"
                ? {
                    "Схема оплаты":
                      PAYMENT_TYPE_TRANSLATIONS[selectedCashFlowPaymentType] ||
                      selectedCashFlowPaymentType,
                  }
                : {}),
              "Прогноз / план ($)": Math.round(data.scheduled),
              "Фактически получено ($)": isPast ? Math.round(data.paid) : null,
              "Отклонение ($)": deviation,
              Исполнение: execution,
            };
          });
      }

      case "RPT-023": {
        // Эффективность менеджеров
        const filtered = (initialData.managerKpi || []).filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (selectedManager !== "ALL" && row.managerId !== selectedManager)
            return false;
          if (startDate && row.createdAt && row.createdAt < startDate)
            return false;
          if (endDate && row.createdAt && row.createdAt > endDate) return false;
          return true;
        });

        const managersMap: Record<
          string,
          {
            calls: number;
            meetings: number;
            bookings: number;
            wonDeals: number;
            totalDeals: number;
            totalRevenue: number;
            cycleTimes: number[];
          }
        > = {};
        filtered.forEach((row: any) => {
          const mgr = row.managerId;
          if (!managersMap[mgr]) {
            managersMap[mgr] = {
              calls: 0,
              meetings: 0,
              bookings: 0,
              wonDeals: 0,
              totalDeals: 0,
              totalRevenue: 0,
              cycleTimes: [],
            };
          }

          if (row.eventType === "call") {
            managersMap[mgr].calls += 1;
          } else if (row.eventType === "meeting") {
            managersMap[mgr].meetings += 1;
          } else if (row.eventType === "booking") {
            managersMap[mgr].bookings += 1;
          } else if (row.eventType === "deal") {
            managersMap[mgr].totalDeals += 1;
            const isWon = ["SUCCESS", "CONTRACT"].includes(row.status);
            if (isWon) {
              managersMap[mgr].wonDeals += 1;
              managersMap[mgr].totalRevenue += Number(row.totalAmount) || 0;
              if (row.cycleTime && Number(row.cycleTime) > 0) {
                managersMap[mgr].cycleTimes.push(Number(row.cycleTime));
              }
            }
          }
        });

        return Object.entries(managersMap).map(([managerId, stats]) => {
          const conversion =
            stats.totalDeals > 0
              ? parseFloat(
                  ((stats.wonDeals / stats.totalDeals) * 100).toFixed(1),
                )
              : 0;
          const avgCheck =
            stats.wonDeals > 0
              ? Math.round(stats.totalRevenue / stats.wonDeals)
              : 0;
          const avgCycle =
            stats.cycleTimes.length > 0
              ? Math.round(
                  stats.cycleTimes.reduce((a: number, b: number) => a + b, 0) /
                    stats.cycleTimes.length,
                )
              : 0;

          return {
            Менеджер: managerId,
            "Количество звонков": stats.calls,
            "Количество встреч": stats.meetings,
            "Количество броней": stats.bookings,
            "Всего сделок": stats.totalDeals,
            "Успешных сделок": stats.wonDeals,
            "Конверсия (%)": conversion + "%",
            "Средний чек ($)": avgCheck.toLocaleString(),
            "Ср. цикл сделки (дней)": avgCycle || "—",
          };
        });
      }

      case "RPT-024": {
        // Эффективность источников
        const channelsData = initialData.marketingChannels?.channels || [];
        const costsData = initialData.marketingChannels?.costs || [];

        const filtered = channelsData.filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (selectedSource !== "ALL" && row.source !== selectedSource)
            return false;
          if (
            selectedChannel !== "ALL" &&
            getChannelBySource(row.source) !== selectedChannel
          )
            return false;
          if (startDate && row.createdAt && row.createdAt < startDate)
            return false;
          if (endDate && row.createdAt && row.createdAt > endDate) return false;
          return true;
        });

        // Фильтруем расходы на рекламу по ЖК и периоду дат
        const filteredCosts = costsData.filter((costRow: any) => {
          if (
            selectedProject !== "ALL" &&
            costRow.projectId !== selectedProject
          )
            return false;

          const costStart = costRow.startDate;
          const costEnd = costRow.endDate;

          if (startDate && costEnd && costEnd < startDate) return false;
          if (endDate && costStart && costStart > endDate) return false;

          return true;
        });

        const costsMap: Record<string, number> = {};
        filteredCosts.forEach((costRow: any) => {
          const key = costRow.source;
          costsMap[key] = (costsMap[key] || 0) + (Number(costRow.cost) || 0);
        });

        const channelsMap: Record<
          string,
          { leads: number; deals: number; won: number; revenue: number }
        > = {};
        filtered.forEach((row: any) => {
          const key = row.source;
          if (!channelsMap[key]) {
            channelsMap[key] = { leads: 0, deals: 0, won: 0, revenue: 0 };
          }
          channelsMap[key].leads += 1;
          if (row.dealId) {
            channelsMap[key].deals += 1;
            const isWon = ["SUCCESS", "CONTRACT"].includes(row.dealStatus);
            if (isWon) {
              channelsMap[key].won += 1;
              channelsMap[key].revenue += Number(row.price) || 0;
            }
          }
        });

        return Object.entries(channelsMap).map(([source, stats]) => {
          const channelCode = getChannelBySource(source);
          const channelName = CHANNEL_TRANSLATIONS[channelCode] || channelCode;
          const conversion =
            stats.leads > 0
              ? parseFloat(((stats.won / stats.leads) * 100).toFixed(1))
              : 0;
          const cost = costsMap[source] || 0;
          const roi =
            cost > 0
              ? (((stats.revenue - cost) / cost) * 100).toFixed(1) + "%"
              : "—";
          return {
            "Канал связи": channelName,
            "Источник рекламы": source,
            "Привлечено лидов": stats.leads,
            "Создано сделок": stats.deals,
            Продано: stats.won,
            "Конверсия (%)": conversion + "%",
            "Выручка ($)": Math.round(stats.revenue),
            "Маркетинговый бюджет ($)": cost,
            "ROI (%)": roi,
          };
        });
      }

      case "RPT-025": {
        // Отчет по броням
        const filtered = (initialData.bookingReport || []).filter(
          (row: any) => {
            if (selectedProject !== "ALL" && row.projectId !== selectedProject)
              return false;
            if (selectedManager !== "ALL" && row.managerId !== selectedManager)
              return false;
            if (
              selectedBookingType !== "ALL" &&
              row.type !== selectedBookingType
            )
              return false;
            if (startDate && row.createdAt && row.createdAt < startDate)
              return false;
            if (endDate && row.createdAt && row.createdAt > endDate)
              return false;
            return true;
          },
        );

        return filtered.map((row: any) => {
          const cancelReason =
            row.status === "EXPIRED"
              ? "Истечение срока"
              : row.status === "CANCELLED" || row.status === "RELEASED"
                ? "Отказ клиента"
                : "—";
          const bookingType =
            row.type === "PAID" || row.type === "HARD"
              ? "Платная бронь"
              : "Устная бронь";
          const statusText =
            row.status === "EXPIRED"
              ? "Истекла"
              : row.status === "ACTIVE"
                ? "Активна"
                : "Снята";

          return {
            Клиент: row.clientName,
            Квартира: `№${row.unitNumber}`,
            ЖК: row.projectName,
            "Дата брони": row.createdAt,
            "Срок действия": row.expiresAt,
            Тип: bookingType,
            Статус: statusText,
            "Причина снятия": cancelReason,
            "Сумма депозита ($)": Math.round(row.depositAmount),
          };
        });
      }

      case "RPT-011": {
        // Отчет по индивидуальным скидкам
        const filtered = initialData.discountReport.filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (
            selectedDiscountManager !== "ALL" &&
            row.managerId !== selectedDiscountManager
          )
            return false;
          if (startDate && row.createdAt && row.createdAt < startDate)
            return false;
          if (endDate && row.createdAt && row.createdAt > endDate) return false;
          if (selectedDiscountRange !== "ALL") {
            const pct = row.discountPct;
            if (selectedDiscountRange === "0-3" && !(pct >= 0 && pct <= 3))
              return false;
            if (selectedDiscountRange === "3-5" && !(pct > 3 && pct <= 5))
              return false;
            if (selectedDiscountRange === "5-10" && !(pct > 5 && pct <= 10))
              return false;
            if (selectedDiscountRange === "10+" && !(pct > 10)) return false;
          }
          return true;
        });

        return filtered.map((row: any) => ({
          Сделка: row.dealId.startsWith("test")
            ? "#Тестовая сделка"
            : `#${row.dealId.substring(0, 8).toUpperCase()}`,
          Клиент: row.clientName,
          Квартира: `№${row.unitNumber}`,
          Менеджер: row.managerId,
          "Базовая цена ($)": Math.round(row.basePrice),
          "Индивидуальная скидка (%)": `${row.discountPct}%`,
          "Сумма скидки ($)": Math.round(row.discountAmount),
          "Цена со скидкой ($)": Math.round(row.finalPrice),
          "Дата сделки": row.createdAt,
        }));
      }

      case "RPT-012": {
        // Отчет по ипотечным сделкам
        const filtered = initialData.mortgageReport.filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (selectedManager !== "ALL" && row.managerId !== selectedManager)
            return false;
          if (
            selectedMortgageBank !== "ALL" &&
            row.mortgageBank !== selectedMortgageBank
          )
            return false;
          if (
            selectedMortgageStatus !== "ALL" &&
            row.mortgageStatus !== selectedMortgageStatus
          )
            return false;
          if (startDate && row.createdAt && row.createdAt < startDate)
            return false;
          if (endDate && row.createdAt && row.createdAt > endDate) return false;
          return true;
        });

        return filtered.map((row: any) => ({
          Сделка: row.dealId.startsWith("test")
            ? "#Тестовая сделка"
            : `#${row.dealId.substring(0, 8).toUpperCase()}`,
          Клиент: row.clientName,
          Телефон: row.clientPhone,
          Квартира: `№${row.unitNumber}`,
          "Цена квартиры ($)": Math.round(row.unitPrice),
          Банк: row.mortgageBank,
          "Сумма кредита ($)": Math.round(row.loanAmount),
          "Первоначальный взнос ($)": Math.round(row.downPayment),
          "Статус ипотеки":
            row.mortgageStatus === "APPROVED"
              ? "Одобрено"
              : row.mortgageStatus === "REJECTED"
                ? "Отклонено"
                : "На рассмотрении",
          Комментарий: row.mortgageComment,
        }));
      }

      case "RPT-013": {
        // Отчёт по e-invoice
        const invoiceStatusLabels: Record<string, string> = {
          SUCCESS: " Успешно отправлен",
          PENDING: " Ожидает отправки",
          FAILED: " Ошибка отправки",
        };
        const filtered = initialData.taxInvoiceReport.filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (startDate && row.issuedAt < startDate) return false;
          if (endDate && row.issuedAt > endDate) return false;
          return true;
        });
        return filtered.map((row: any) => ({
          "Номер инвойса": row.invoiceNumber,
          Сделка: row.dealId.startsWith("test")
            ? "#ТЕСТ"
            : `#${row.dealId.substring(0, 8).toUpperCase()}`,
          Клиент: row.clientName,
          Квартира: `№${row.unitNumber}`,
          "Сумма (GEL)": Math.round(row.amount),
          Валюта: row.currency,
          "Дата выписки": row.issuedAt,
          "Статус RS.ge": invoiceStatusLabels[row.status] || row.status,
        }));
      }

      case "RPT-014": {
        // Отчёт по эскроу
        const escrowStatusLabels: Record<string, string> = {
          ACTIVE: " Активен",
          RELEASED: " Раскрыт",
          CLOSED: " Закрыт",
        };
        const filtered = initialData.escrowReport.filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (startDate && row.createdAt < startDate) return false;
          if (endDate && row.createdAt > endDate) return false;
          return true;
        });
        return filtered.map((row: any) => {
          const releasePct =
            row.depositedAmount > 0
              ? ((row.releasedAmount / row.depositedAmount) * 100).toFixed(1) +
                "%"
              : "0%";
          return {
            Сделка: row.dealId.startsWith("test")
              ? "#ТЕСТ"
              : `#${row.dealId.substring(0, 8).toUpperCase()}`,
            Клиент: row.clientName,
            Квартира: `№${row.unitNumber}`,
            "Банк-депозитарий": row.bankName,
            "Депонировано ($)": Math.round(row.depositedAmount),
            "Раскрыто ($)": Math.round(row.releasedAmount),
            "Остаток ($)": Math.round(row.remainingAmount),
            "Раскрыто (%)": releasePct,
            "Этап раскрытия": row.releaseStage,
            Статус: escrowStatusLabels[row.status] || row.status,
          };
        });
      }

      case "RPT-015": {
        // Остатки свободных помещений
        const filtered = (initialData.availableUnits || []).filter(
          (row: any) => {
            if (selectedProject !== "ALL" && row.projectId !== selectedProject)
              return false;
            if (
              selectedBlock !== "ALL" &&
              row.blockNumber !==
                blocks.find((b) => b.id === selectedBlock)?.number
            )
              return false;
            if (selectedUnitType !== "ALL" && row.type !== selectedUnitType)
              return false;
            if (minArea && row.area < parseFloat(minArea)) return false;
            if (maxArea && row.area > parseFloat(maxArea)) return false;
            if (minPrice && row.price < parseFloat(minPrice)) return false;
            if (maxPrice && row.price > parseFloat(maxPrice)) return false;
            return true;
          },
        );

        return filtered.map((row: any) => ({
          Квартира: `№${row.unitNumber}`,
          ЖК: row.projectName,
          Корпус: row.blockNumber,
          Тип: UNIT_TYPE_TRANSLATIONS[row.type] || row.type,
          "Площадь (м²)": row.area,
          Этаж: row.floor,
          Статус: "FREE (Свободно)",
          "Цена ($)": Math.round(row.price),
        }));
      }

      case "RPT-016": {
        // Реализованные помещения
        const filtered = (initialData.soldUnits || []).filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (selectedBlock !== "ALL" && row.blockId !== selectedBlock)
            return false;
          if (selectedUnitType !== "ALL" && row.type !== selectedUnitType)
            return false;
          if (minArea && row.area < parseFloat(minArea)) return false;
          if (maxArea && row.area > parseFloat(maxArea)) return false;
          if (startDate && row.soldAt && row.soldAt < startDate) return false;
          if (endDate && row.soldAt && row.soldAt > endDate) return false;
          return true;
        });

        return filtered.map((row: any) => {
          const areaVal = Number(row.area) || 1;
          const sqPrice = Math.round(row.soldPrice / areaVal);
          return {
            Квартира: `№${row.unitNumber}`,
            ЖК: row.projectName,
            Корпус: row.blockNumber,
            Тип: UNIT_TYPE_TRANSLATIONS[row.type] || row.type,
            "Площадь (м²)": row.area,
            Этаж: row.floor,
            "Цена продажи ($)": Math.round(row.soldPrice),
            "Дата продажи": row.soldAt,
            "Цена за м² ($/м²)": sqPrice,
          };
        });
      }

      case "RPT-017": {
        // Экспозиция объектов
        const filtered = (initialData.projectExposure || []).filter(
          (row: any) => {
            if (selectedProject !== "ALL" && row.projectId !== selectedProject)
              return false;
            if (
              selectedBlock !== "ALL" &&
              row.blockNumber !==
                blocks.find((b) => b.id === selectedBlock)?.number
            )
              return false;
            return true;
          },
        );

        return filtered.map((row: any) => {
          const total = row.totalUnits || 0;
          const sold = row.soldUnits || 0;
          const booked = row.bookedUnits || 0;
          const free = row.freeUnits || 0;
          const rate =
            total > 0 ? ((sold / total) * 100).toFixed(1) + "%" : "0.0%";
          return {
            ЖК: row.projectName,
            Корпус: row.blockNumber,
            "Всего объектов": total,
            Забронировано: booked,
            Продано: sold,
            "Доля реализации (%)": rate,
            "Остаток фонда": free,
          };
        });
      }

      case "RPT-018": {
        // Поиск свободных помещений
        const filtered = (initialData.freeUnitsSearch || []).filter(
          (row: any) => {
            if (selectedProject !== "ALL" && row.projectId !== selectedProject)
              return false;
            if (selectedUnitType !== "ALL" && row.type !== selectedUnitType)
              return false;
            if (minArea && row.area < parseFloat(minArea)) return false;
            if (maxArea && row.area > parseFloat(maxArea)) return false;
            if (minPrice && row.price < parseFloat(minPrice)) return false;
            if (maxPrice && row.price > parseFloat(maxPrice)) return false;
            if (filterFloor && row.floor !== parseInt(filterFloor))
              return false;
            if (
              filterView !== "ALL" &&
              !row.viewType?.toLowerCase().includes(filterView.toLowerCase())
            )
              return false;
            return true;
          },
        );

        return filtered.map((row: any) => ({
          ЖК: row.projectName,
          Корпус: row.blockNumber,
          Номер: `№${row.unitNumber}`,
          Тип: UNIT_TYPE_TRANSLATIONS[row.type] || row.type,
          "Площадь (м²)": row.area,
          "Цена ($)": Math.round(row.price),
          Этаж: row.floor,
          "Вид из окна": row.viewType,
          Комнат: row.rooms,
          Статус: "FREE (Свободно)",
        }));
      }

      case "RPT-019": {
        // Журнал изменения цен (PriceHistory)
        const filtered = (initialData.priceHistory || []).filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (filterUnitNumber && !row.unitNumber.includes(filterUnitNumber))
            return false;
          if (filterInitiator !== "ALL" && row.initiator !== filterInitiator)
            return false;
          if (startDate && row.createdAt && row.createdAt < startDate)
            return false;
          if (endDate && row.createdAt && row.createdAt > endDate) return false;
          return true;
        });

        return filtered.map((row: any) => ({
          Квартира: `№${row.unitNumber}`,
          ЖК: row.projectName,
          "Старая цена ($)": Math.round(row.oldPrice),
          "Новая цена ($)": Math.round(row.newPrice),
          "Разница ($)": Math.round(row.newPrice - row.oldPrice),
          Инициатор: row.initiator,
          "Дата переоценки": row.createdAt,
          Причина: row.reason,
        }));
      }

      case "RPT-020": {
        // Отчёт по площадям (проектная vs фактическая)
        const filtered = (initialData.areaDiscrepancy || []).filter(
          (row: any) => {
            if (selectedProject !== "ALL" && row.projectId !== selectedProject)
              return false;
            if (
              selectedBlock !== "ALL" &&
              row.blockNumber !==
                blocks.find((b) => b.id === selectedBlock)?.number
            )
              return false;
            if (filterUnitNumber && !row.unitNumber.includes(filterUnitNumber))
              return false;
            return true;
          },
        );

        return filtered.map((row: any) => {
          const projected = row.projectedArea || 0;
          const actual = row.actualArea || projected;
          const diff = parseFloat((actual - projected).toFixed(2));
          const diffStr = diff > 0 ? `+${diff}` : `${diff}`;

          let compensationStatus = "Расхождений нет";
          if (diff > 0) {
            const sqPrice = row.price / (projected || 1);
            const compAmt = Math.round(diff * sqPrice);
            compensationStatus = `Требуется доплата клиента ($${compAmt.toLocaleString()})`;
          } else if (diff < 0) {
            const sqPrice = row.price / (projected || 1);
            const compAmt = Math.round(Math.abs(diff) * sqPrice);
            compensationStatus = `Требуется возврат клиенту ($${compAmt.toLocaleString()})`;
          }

          return {
            Квартира: `№${row.unitNumber}`,
            ЖК: row.projectName,
            Корпус: row.blockNumber,
            "Проектная площадь (м²)": projected,
            "Фактическая площадь (м²)": actual,
            "Разница (м²)": diffStr,
            "Статус взаиморасчетов": compensationStatus,
          };
        });
      }

      case "RPT-021": {
        // Реестр VIP-клиентов
        const filtered = (initialData.vipClients || []).filter((row: any) => {
          if (selectedProject !== "ALL" && row.projectId !== selectedProject)
            return false;
          if (selectedManager !== "ALL" && row.managerId !== selectedManager)
            return false;
          if (startDate && row.firstContact && row.firstContact < startDate)
            return false;
          if (endDate && row.firstContact && row.firstContact > endDate)
            return false;
          return true;
        });

        return filtered.map((row: any) => ({
          "ФИО Клиента": row.clientName,
          Телефон: maskPhone(row.clientPhone, userRole),
          Email: maskEmail(row.clientEmail, userRole),
          "Активных сделок": row.activeDealsCount,
          "Сумма сделок ($)": Math.round(row.totalDealsAmount),
          ЖК: row.projectName,
          "Первый контакт": row.firstContact,
          "Последняя активность": row.lastInteraction,
        }));
      }

      case "RPT-022": {
        // Анкетные данные по клиентам
        const filtered = (initialData.clientDossier || []).filter(
          (row: any) => {
            if (selectedProject !== "ALL" && row.projectId !== selectedProject)
              return false;
            if (
              dealStatusFilter !== "ALL" &&
              row.dealStatus !== dealStatusFilter
            )
              return false;
            if (selectedSource !== "ALL" && row.source !== selectedSource)
              return false;
            if (startDate && row.firstTouch && row.firstTouch < startDate)
              return false;
            if (endDate && row.firstTouch && row.firstTouch > endDate)
              return false;
            return true;
          },
        );

        return filtered.map((row: any) => ({
          "ФИО Клиента": row.clientName,
          Телефон: maskPhone(row.clientPhone, userRole),
          Email: maskEmail(row.clientEmail, userRole),
          "Реквизиты/Документ": maskIdNumber(row.clientIdentity, userRole),
          Источник: row.source,
          "Статус лида":
            LEAD_STATUS_TRANSLATIONS[row.leadStatus] || row.leadStatus,
          "Первое касание": row.firstTouch,
          ЖК: row.projectName,
          "Статус сделки": STAGE_TRANSLATIONS[row.dealStatus] || row.dealStatus,
        }));
      }

      default:
        return [];
    }
  }, [
    activeReportId,
    mockData,
    initialData,
    selectedProject,
    startDate,
    endDate,
    selectedManager,
    selectedSource,
    selectedChannel,
    selectedPaymentType,
    selectedClientType,
    selectedBlock,
    selectedUnitType,
    funnelViewMode,
    projects,
    selectedPaymentStatus,
    selectedOverdueBucket,
    selectedDebtManager,
    selectedCashFlowPaymentType,
    selectedDiscountRange,
    selectedDiscountManager,
    selectedMortgageBank,
    selectedMortgageStatus,
    draftStatusFilter,
    dynamicsInterval,
    cohortInterval,
    selectedInitiator,
    selectedApprover,
    minArea,
    maxArea,
    minPrice,
    maxPrice,
    filterFloor,
    filterView,
    filterUnitNumber,
    filterInitiator,
    selectedBookingType,
  ]);

  // Расчет динамических KPI показателей отчетов
  const reportStats = useMemo(() => {
    if (activeReportId === "RPT-001") {
      let totalDeals = 0;
      let totalAmountUsd = 0;
      let totalAmountGel = 0;
      let successDeals = 0;

      const countKey =
        funnelViewMode === "pipeline"
          ? "Количество сделок"
          : "Уникальных переходов";
      const usdKey =
        funnelViewMode === "pipeline" ? "Сумма (USD)" : "Оборот этапа (USD)";
      const gelKey =
        funnelViewMode === "pipeline" ? "Сумма (GEL)" : "Оборот этапа (GEL)";

      activeReportData.forEach((row) => {
        const count = Number(row[countKey]) || 0;
        const usd = Number(row[usdKey]) || 0;
        const gel = Number(row[gelKey]) || 0;
        totalDeals += count;
        totalAmountUsd += usd;
        totalAmountGel += gel;
        if (row["Этап воронки"] === STAGE_TRANSLATIONS["SUCCESS"]) {
          successDeals += count;
        }
      });

      const conversion =
        totalDeals > 0
          ? ((successDeals / totalDeals) * 100).toFixed(1) + "%"
          : "0.0%";

      const totalLabel =
        funnelViewMode === "pipeline" ? "Всего сделок" : "Всего переходов";
      const totalSubtext =
        funnelViewMode === "pipeline"
          ? "В выбранном периоде"
          : "Сумма переходов по этапам";

      return [
        {
          label: totalLabel,
          value: totalDeals.toString(),
          subtext: totalSubtext,
          icon: "",
        },
        {
          label: "Общий бюджет",
          value: `$${totalAmountUsd.toLocaleString()}`,
          subtext: `₾${totalAmountGel.toLocaleString()}`,
          icon: "",
        },
        {
          label: "Успешные сделки",
          value: successDeals.toString(),
          subtext: `Конверсия: ${conversion}`,
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-002") {
      let totalSold = 0;
      let totalTargetUnits = 0;
      let totalRevenueFact = 0;
      let totalRevenuePlan = 0;

      activeReportData.forEach((row) => {
        totalSold += Number(row["Продано (Юнитов)"]) || 0;
        totalTargetUnits += Number(row["План (Юнитов)"]) || 0;
        totalRevenueFact += Number(row["Выручка Факт ($)"]) || 0;
        totalRevenuePlan += Number(row["Выручка План ($)"]) || 0;
      });

      const unitCompletion =
        totalTargetUnits > 0
          ? ((totalSold / totalTargetUnits) * 100).toFixed(1) + "%"
          : "0.0%";
      const revCompletion =
        totalRevenuePlan > 0
          ? ((totalRevenueFact / totalRevenuePlan) * 100).toFixed(1) + "%"
          : "0.0%";

      return [
        {
          label: "Продано юнитов",
          value: totalSold.toString(),
          subtext: `План: ${totalTargetUnits} (${unitCompletion})`,
          icon: "",
        },
        {
          label: "Выручка Факт",
          value: `$${totalRevenueFact.toLocaleString()}`,
          subtext: `План: $${totalRevenuePlan.toLocaleString()}`,
          icon: "",
        },
        {
          label: "Выполнение плана",
          value: revCompletion,
          subtext: "По сумме выручки",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-003") {
      let totalSold = 0;
      let totalRevenue = 0;
      let topManager = "—";
      let maxRevenue = -1;

      activeReportData.forEach((row) => {
        totalSold += Number(row["Продано (Юнитов)"]) || 0;
        const rev = Number(row["Выручка Факт ($)"]) || 0;
        totalRevenue += rev;
        if (rev > maxRevenue) {
          maxRevenue = rev;
          topManager = row["Менеджер"] || "—";
        }
      });

      return [
        {
          label: "Всего продано",
          value: `${totalSold} шт.`,
          subtext: "Всеми менеджерами",
          icon: "",
        },
        {
          label: "Общая выручка",
          value: `$${totalRevenue.toLocaleString()}`,
          subtext: `В среднем: $${Math.round(activeReportData.length > 0 ? totalRevenue / activeReportData.length : 0).toLocaleString()}`,
          icon: "",
        },
        {
          label: "Лидер продаж",
          value: topManager,
          subtext:
            maxRevenue > 0
              ? `Результат: $${maxRevenue.toLocaleString()}`
              : "Нет сделок",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-004") {
      let totalContract = 0;
      let totalPaid = 0;
      let totalPending = 0;

      activeReportData.forEach((row) => {
        totalContract += Number(row["Сумма договора ($)"]) || 0;
        totalPaid += Number(row["Поступило оплат ($)"]) || 0;
        totalPending += Number(row["Ожидается платежей ($)"]) || 0;
      });

      return [
        {
          label: "Сумма договоров",
          value: `$${totalContract.toLocaleString()}`,
          subtext: `Всего сделок: ${activeReportData.length}`,
          icon: "",
        },
        {
          label: "Поступило оплат",
          value: `$${totalPaid.toLocaleString()}`,
          subtext: `Оплачено: ${totalContract > 0 ? ((totalPaid / totalContract) * 100).toFixed(1) + "%" : "0%"}`,
          icon: "",
        },
        {
          label: "Ожидается платежей",
          value: `$${totalPending.toLocaleString()}`,
          subtext: `Остаток: ${totalContract > 0 ? ((totalPending / totalContract) * 100).toFixed(1) + "%" : "0%"}`,
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-005") {
      const totalDrafts = activeReportData.length;
      let approvedDrafts = 0;
      let totalHours = 0;
      let countWithTime = 0;

      activeReportData.forEach((row) => {
        if (row["Статус"] === "Одобрен") {
          approvedDrafts++;
          totalHours += Number(row["Время в работе (ч)"]) || 0;
          countWithTime++;
        }
      });

      const avgHours =
        countWithTime > 0 ? (totalHours / countWithTime).toFixed(1) : "0.0";

      return [
        {
          label: "Всего заявок",
          value: totalDrafts.toString(),
          subtext: "В выбранном периоде",
          icon: "",
        },
        {
          label: "Одобрено договоров",
          value: approvedDrafts.toString(),
          subtext: `Доля: ${totalDrafts > 0 ? ((approvedDrafts / totalDrafts) * 100).toFixed(1) + "%" : "0.0%"}`,
          icon: "",
        },
        {
          label: "Среднее время согласования",
          value: `${avgHours} ч.`,
          subtext: "Для одобренных договоров",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-006") {
      let totalLeads = 0;
      let totalVisits = 0;
      let totalApplications = 0;
      let totalBookings = 0;
      let totalContracts = 0;
      let totalPayments = 0;

      activeReportData.forEach((row) => {
        totalLeads += Number(row["Лиды"]) || 0;
        totalVisits += Number(row["Посещения"]) || 0;
        totalApplications += Number(row["Заявки"]) || 0;
        totalBookings += Number(row["Брони"]) || 0;
        totalContracts += Number(row["Договоры"]) || 0;
        totalPayments += Number(row["Поступило оплат ($)"]) || 0;
      });

      return [
        {
          label: "Лиды / Встречи / Заявки",
          value: `${totalLeads} / ${totalVisits} / ${totalApplications}`,
          subtext: "Привлечено / Проведено / Подано",
          icon: "",
        },
        {
          label: "Брони / Договоры",
          value: `${totalBookings} / ${totalContracts}`,
          subtext: `Конверсия в Won: ${totalLeads > 0 ? ((totalContracts / totalLeads) * 100).toFixed(1) + "%" : "0.0%"}`,
          icon: "",
        },
        {
          label: "Фактическая выручка",
          value: `$${totalPayments.toLocaleString()}`,
          subtext: "Сумма поступивших оплат",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-007") {
      const filteredLeads = initialData.cohortAnalysis.filter((row: any) => {
        if (selectedProject !== "ALL" && row.projectId !== selectedProject)
          return false;
        if (
          startDate &&
          row.leadCreatedAt &&
          row.leadCreatedAt.substring(0, 10) < startDate
        )
          return false;
        if (
          endDate &&
          row.leadCreatedAt &&
          row.leadCreatedAt.substring(0, 10) > endDate
        )
          return false;
        if (selectedSource !== "ALL" && row.source !== selectedSource)
          return false;
        if (
          selectedChannel !== "ALL" &&
          getChannelBySource(row.source) !== selectedChannel
        )
          return false;
        return true;
      });

      const totalLeads = filteredLeads.length;
      let totalWon = 0;
      let totalRevenue = 0;

      filteredLeads.forEach((row: any) => {
        const isWon = row.dealStatus === "SUCCESS";
        if (isWon) {
          totalWon++;
          totalRevenue += row.price || 0;
        }
      });

      const conversion =
        totalLeads > 0
          ? ((totalWon / totalLeads) * 100).toFixed(1) + "%"
          : "0.0%";

      return [
        {
          label: "Всего клиентов",
          value: totalLeads.toString(),
          subtext: "В когортах за период",
          icon: "",
        },
        {
          label: "Успешных сделок",
          value: totalWon.toString(),
          subtext: `Общий чек: $${totalRevenue.toLocaleString()}`,
          icon: "",
        },
        {
          label: "Итоговая конверсия",
          value: conversion,
          subtext: "Средняя по всем когортам",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-008") {
      let totalScheduled = 0,
        totalPaid = 0,
        countOverdue = 0,
        countPending = 0;
      activeReportData.forEach((row) => {
        totalScheduled += Number(row["Сумма к оплате ($)"]) || 0;
        totalPaid += Number(row["Оплачено факт ($)"]) || 0;
        if (row["Статус оплат"] === "Просрочено") countOverdue++;
        if (row["Статус оплат"] === "Ожидается") countPending++;
      });
      const paidPct =
        totalScheduled > 0
          ? ((totalPaid / totalScheduled) * 100).toFixed(1) + "%"
          : "0%";
      return [
        {
          label: "Всего платежей",
          value: activeReportData.length.toString(),
          subtext: `По графику: $${totalScheduled.toLocaleString()}`,
          icon: "",
        },
        {
          label: "Поступило оплат",
          value: `$${totalPaid.toLocaleString()}`,
          subtext: `Исполнено: ${paidPct}`,
          icon: "",
        },
        {
          label: "Просрочено",
          value: `${countOverdue} шт.`,
          subtext: `Ожидается ещё: ${countPending} шт.`,
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-009") {
      let totalDebt = 0,
        totalPenalty = 0,
        totalOwed = 0,
        maxDays = 0;
      activeReportData.forEach((row) => {
        totalDebt += Number(row["Сумма долга ($)"]) || 0;
        totalPenalty += Number(row["Начислено пени ($)"]) || 0;
        totalOwed += Number(row["Итого к оплате ($)"]) || 0;
        const d = Number(row["Дней просрочки"]) || 0;
        if (d > maxDays) maxDays = d;
      });
      return [
        {
          label: "Должников",
          value: activeReportData.length.toString(),
          subtext: `Макс. просрочка: ${maxDays} дн.`,
          icon: "",
        },
        {
          label: "Сумма основного долга",
          value: `$${totalDebt.toLocaleString()}`,
          subtext: "По всем просрочкам",
          icon: "",
        },
        {
          label: "Начислено пени",
          value: `$${totalPenalty.toLocaleString()}`,
          subtext: `Итого к взысканию: $${totalOwed.toLocaleString()}`,
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-010") {
      let pastScheduled = 0,
        totalPaid = 0,
        futureScheduled = 0;
      activeReportData.forEach((row) => {
        const scheduled = Number(row["Прогноз / план ($)"]) || 0;
        const paid = row["Фактически получено ($)"];
        if (paid === null) {
          // Будущий месяц — факта нет
          futureScheduled += scheduled;
        } else {
          // Прошедший месяц — есть и план и факт
          pastScheduled += scheduled;
          totalPaid += Number(paid) || 0;
        }
      });
      const execution =
        pastScheduled > 0
          ? ((totalPaid / pastScheduled) * 100).toFixed(1) + "%"
          : "—";
      return [
        {
          label: "Получено (прошлые периоды)",
          value: `$${totalPaid.toLocaleString()}`,
          subtext: `План: $${pastScheduled.toLocaleString()} | Исполнение: ${execution}`,
          icon: "",
        },
        {
          label: "Ожидается (будущие периоды)",
          value: `$${futureScheduled.toLocaleString()}`,
          subtext: "По графику платежей",
          icon: "",
        },
        {
          label: "Итого по графику",
          value: `$${(totalPaid + futureScheduled).toLocaleString()}`,
          subtext: "Факт + прогноз будущих",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-011") {
      let totalDiscountAmount = 0,
        maxDiscount = 0,
        totalBase = 0;
      activeReportData.forEach((row) => {
        totalDiscountAmount += Number(row["Сумма скидки ($)"]) || 0;
        totalBase += Number(row["Базовая цена ($)"]) || 0;
        const pct = parseFloat(row["Индивидуальная скидка (%)"]) || 0;
        if (pct > maxDiscount) maxDiscount = pct;
      });
      const avgDiscount =
        totalBase > 0
          ? ((totalDiscountAmount / totalBase) * 100).toFixed(1) + "%"
          : "—";
      return [
        {
          label: "Сделок со скидкой",
          value: activeReportData.length.toString(),
          subtext: `Средняя скидка: ${avgDiscount}`,
          icon: "",
        },
        {
          label: "Общая сумма скидок",
          value: `$${totalDiscountAmount.toLocaleString()}`,
          subtext: "Суммарная потеря маржи",
          icon: "",
        },
        {
          label: "Макс. скидка",
          value: `${maxDiscount}%`,
          subtext: "Наибольшая в выборке",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-012") {
      let totalLoan = 0,
        approved = 0,
        pending = 0,
        rejected = 0;
      activeReportData.forEach((row) => {
        totalLoan += Number(row["Сумма кредита ($)"]) || 0;
        const status = row["Статус ипотеки"] || "";
        if (status.includes("Одобрено")) approved++;
        if (status.includes("рассмотрении")) pending++;
        if (status.includes("Отклонено")) rejected++;
      });
      const approvalRate =
        activeReportData.length > 0
          ? ((approved / activeReportData.length) * 100).toFixed(0) + "%"
          : "—";
      return [
        {
          label: "Ипотечных сделок",
          value: activeReportData.length.toString(),
          subtext: `Одобрено: ${approved} | Отказ: ${rejected} | В работе: ${pending}`,
          icon: "",
        },
        {
          label: "Общая сумма ипотек",
          value: `$${totalLoan.toLocaleString()}`,
          subtext: "Сумма кредитов по всем сделкам",
          icon: "",
        },
        {
          label: "Конверсия одобрений",
          value: approvalRate,
          subtext: "Доля одобренных заявок",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-015") {
      let totalFree = activeReportData.length;
      let totalValue = 0;
      let avgPrice = 0;
      activeReportData.forEach((row) => {
        totalValue += Number(row["Цена ($)"]) || 0;
      });
      avgPrice = totalFree > 0 ? Math.round(totalValue / totalFree) : 0;
      return [
        {
          label: "Свободных юнитов",
          value: totalFree.toString(),
          subtext: "В остатках фонда",
          icon: "",
        },
        {
          label: "Стоимость фонда",
          value: `$${totalValue.toLocaleString()}`,
          subtext: "Суммарный объем Available",
          icon: "",
        },
        {
          label: "Средняя цена лота",
          value: `$${avgPrice.toLocaleString()}`,
          subtext: "В продаже на данный момент",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-016") {
      let totalSold = activeReportData.length;
      let totalRevenue = 0;
      let totalSqm = 0;
      activeReportData.forEach((row) => {
        totalRevenue += Number(row["Цена продажи ($)"]) || 0;
        totalSqm += Number(row["Площадь (м²)"]) || 0;
      });
      const avgSqmPrice =
        totalSqm > 0 ? Math.round(totalRevenue / totalSqm) : 0;
      return [
        {
          label: "Реализовано юнитов",
          value: totalSold.toString(),
          subtext: "Всего проданных за период",
          icon: "",
        },
        {
          label: "Общий объем продаж",
          value: `$${totalRevenue.toLocaleString()}`,
          subtext: "Фактическая выручка",
          icon: "",
        },
        {
          label: "Средняя цена за м²",
          value: `$${avgSqmPrice.toLocaleString()}/м²`,
          subtext: "Исходя из общей площади",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-017") {
      let totalUnits = 0;
      let soldUnits = 0;
      activeReportData.forEach((row) => {
        totalUnits += Number(row["Всего объектов"]) || 0;
        soldUnits += Number(row["Продано"]) || 0;
      });
      const rate =
        totalUnits > 0
          ? ((soldUnits / totalUnits) * 100).toFixed(1) + "%"
          : "0.0%";
      return [
        {
          label: "Всего объектов",
          value: totalUnits.toString(),
          subtext: "В экспозиции по проектам",
          icon: "",
        },
        {
          label: "Всего реализовано",
          value: `${soldUnits} шт.`,
          subtext: `Доля реализации: ${rate}`,
          icon: "",
        },
        {
          label: "Остаток в продаже",
          value: (totalUnits - soldUnits).toString(),
          subtext: "Свободно или забронировано",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-018") {
      let totalMatched = activeReportData.length;
      let minLotPrice = Infinity;
      let maxLotPrice = -Infinity;
      activeReportData.forEach((row) => {
        const price = Number(row["Цена ($)"]) || 0;
        if (price < minLotPrice) minLotPrice = price;
        if (price > maxLotPrice) maxLotPrice = price;
      });
      if (totalMatched === 0) {
        minLotPrice = 0;
        maxLotPrice = 0;
      }
      return [
        {
          label: "Подобрано вариантов",
          value: totalMatched.toString(),
          subtext: "Соответствуют критериям клиента",
          icon: "",
        },
        {
          label: "Минимальная стоимость",
          value:
            minLotPrice === Infinity
              ? "$0"
              : `$${minLotPrice.toLocaleString()}`,
          subtext: "Из подходящих вариантов",
          icon: "",
        },
        {
          label: "Максимальная стоимость",
          value:
            maxLotPrice === -Infinity
              ? "$0"
              : `$${maxLotPrice.toLocaleString()}`,
          subtext: "Из подходящих вариантов",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-019") {
      let totalChanges = activeReportData.length;
      let totalUp = 0;
      let totalDown = 0;
      activeReportData.forEach((row) => {
        const diff = Number(row["Разница ($)"]) || 0;
        if (diff > 0) totalUp += diff;
        else if (diff < 0) totalDown += Math.abs(diff);
      });
      return [
        {
          label: "Всего изменений",
          value: totalChanges.toString(),
          subtext: "Записей в истории цен",
          icon: "",
        },
        {
          label: "Сумма наценок",
          value: `+$${totalUp.toLocaleString()}`,
          subtext: "Общий прирост стоимости лотов",
          icon: "",
        },
        {
          label: "Сумма уценок",
          value: `-$${totalDown.toLocaleString()}`,
          subtext: "Общее снижение стоимости лотов",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-020") {
      let totalUnits = activeReportData.length;
      let discrepancyCount = 0;
      let totalClientDue = 0;
      let totalClientRefund = 0;

      activeReportData.forEach((row) => {
        const statusText = row["Статус взаиморасчетов"] || "";
        if (statusText.includes("Требуется доплата")) {
          discrepancyCount++;
          const match = statusText.match(/\$(\d[\d\s,]*)/);
          if (match) {
            totalClientDue += parseInt(match[1].replace(/[\s,]/g, "")) || 0;
          }
        } else if (statusText.includes("Требуется возврат")) {
          discrepancyCount++;
          const match = statusText.match(/\$(\d[\d\s,]*)/);
          if (match) {
            totalClientRefund += parseInt(match[1].replace(/[\s,]/g, "")) || 0;
          }
        }
      });

      return [
        {
          label: "Проверено квартир",
          value: totalUnits.toString(),
          subtext: `С расхождениями БТИ: ${discrepancyCount}`,
          icon: "",
        },
        {
          label: "К доплате клиентами",
          value: `+$${totalClientDue.toLocaleString()}`,
          subtext: "Дополнительные соглашения",
          icon: "",
        },
        {
          label: "К возврату клиентам",
          value: `-$${totalClientRefund.toLocaleString()}`,
          subtext: "Переплаты по обмеру БТИ",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-013") {
      let totalAmount = 0,
        success = 0,
        pending = 0,
        failed = 0;
      activeReportData.forEach((row) => {
        totalAmount += Number(row["Сумма (GEL)"]) || 0;
        const status = row["Статус RS.ge"] || "";
        if (status.includes("Успешно")) success++;
        if (status.includes("Ожидает")) pending++;
        if (status.includes("Ошибка")) failed++;
      });
      return [
        {
          label: "Всего инвойсов",
          value: activeReportData.length.toString(),
          subtext: ` ${success} | ${pending} | ${failed}`,
          icon: "",
        },
        {
          label: "Общая сумма",
          value: `₾${totalAmount.toLocaleString()}`,
          subtext: "По всем выписанным инвойсам",
          icon: "",
        },
        {
          label: "Успешно отправлено",
          value: `${activeReportData.length > 0 ? ((success / activeReportData.length) * 100).toFixed(0) : 0}%`,
          subtext: `${success} из ${activeReportData.length} инвойсов`,
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-014") {
      let totalDeposited = 0,
        totalReleased = 0,
        activeCount = 0,
        releasedCount = 0;
      activeReportData.forEach((row) => {
        totalDeposited += Number(row["Депонировано ($)"]) || 0;
        totalReleased += Number(row["Раскрыто ($)"]) || 0;
        if (row["Статус"]?.includes("Активен")) activeCount++;
        if (row["Статус"]?.includes("Раскрыт")) releasedCount++;
      });
      const releasePct =
        totalDeposited > 0
          ? ((totalReleased / totalDeposited) * 100).toFixed(1) + "%"
          : "0%";
      return [
        {
          label: "Эскроу счетов",
          value: activeReportData.length.toString(),
          subtext: `Активных: ${activeCount} | Раскрытых: ${releasedCount}`,
          icon: "",
        },
        {
          label: "Депонировано",
          value: `$${totalDeposited.toLocaleString()}`,
          subtext: "Общая сумма на счетах",
          icon: "",
        },
        {
          label: "Раскрыто",
          value: `$${totalReleased.toLocaleString()}`,
          subtext: `${releasePct} от общей суммы`,
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-021") {
      let totalVip = activeReportData.length;
      let totalSum = 0;
      activeReportData.forEach((row) => {
        totalSum += Number(row["Сумма сделок ($)"]) || 0;
      });
      const avgSum = totalVip > 0 ? Math.round(totalSum / totalVip) : 0;

      return [
        {
          label: "VIP-клиентов",
          value: totalVip.toString(),
          subtext: "В выбранном периоде",
          icon: "",
        },
        {
          label: "Сумма сделок VIP",
          value: `$${totalSum.toLocaleString()}`,
          subtext: "Общий объем бюджетов",
          icon: "",
        },
        {
          label: "Средний объем сделок",
          value: `$${avgSum.toLocaleString()}`,
          subtext: "На одного VIP-клиента",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-022") {
      let totalDossiers = activeReportData.length;
      let countWithPhone = 0;
      let sourceCounts: Record<string, number> = {};

      activeReportData.forEach((row) => {
        const phone = row["Телефон"] || "";
        if (phone && phone !== "—") {
          countWithPhone++;
        }
        const src = row["Источник"] || "Не указан";
        sourceCounts[src] = (sourceCounts[src] || 0) + 1;
      });

      let topSource = "—";
      let maxCount = -1;
      Object.entries(sourceCounts).forEach(([src, count]) => {
        if (count > maxCount) {
          maxCount = count;
          topSource = src;
        }
      });

      return [
        {
          label: "Всего анкет",
          value: totalDossiers.toString(),
          subtext: "Для обзвонов и рассылок",
          icon: "",
        },
        {
          label: "Контактов с телефонами",
          value: countWithPhone.toString(),
          subtext: `Доля: ${totalDossiers > 0 ? ((countWithPhone / totalDossiers) * 100).toFixed(0) + "%" : "0%"}`,
          icon: "",
        },
        {
          label: "Основной источник",
          value: topSource,
          subtext: maxCount > 0 ? `Лидов: ${maxCount}` : "Нет данных",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-023") {
      let totalCalls = 0;
      let totalMeetings = 0;
      let topManager = "—";
      let maxWon = -1;

      // Temporary map to calculate top manager
      const mgrMap: Record<string, number> = {};
      activeReportData.forEach((row) => {
        totalCalls += Number(row["Количество звонков"]) || 0;
        totalMeetings += Number(row["Количество встреч"]) || 0;
        const mgr = row["Менеджер"];
        const won = Number(row["Успешных сделок"]) || 0;
        if (mgr && mgr !== "Не назначен") {
          mgrMap[mgr] = (mgrMap[mgr] || 0) + won;
        }
      });

      Object.entries(mgrMap).forEach(([mgr, won]) => {
        if (won > maxWon) {
          maxWon = won;
          topManager = mgr;
        }
      });

      return [
        {
          label: "Всего звонков",
          value: totalCalls.toString(),
          subtext: "Сделано менеджерами",
          icon: "",
        },
        {
          label: "Всего встреч",
          value: totalMeetings.toString(),
          subtext: "Проведено консультаций",
          icon: "",
        },
        {
          label: "Лидер по продажам",
          value: topManager,
          subtext: maxWon > 0 ? `Сделок: ${maxWon}` : "Нет данных",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-024") {
      let totalBudget = 0;
      let totalRevenue = 0;
      let topChannel = "—";
      let maxDeals = -1;

      activeReportData.forEach((row) => {
        totalBudget += Number(row["Маркетинговый бюджет ($)"]) || 0;
        totalRevenue += Number(row["Выручка ($)"]) || 0;
        const deals = Number(row["Продано"]) || 0;
        if (deals > maxDeals) {
          maxDeals = deals;
          topChannel = row["Источник рекламы"] || "—";
        }
      });

      const overallRoi =
        totalBudget > 0
          ? (((totalRevenue - totalBudget) / totalBudget) * 100).toFixed(0) +
            "%"
          : "0%";

      return [
        {
          label: "Маркетинговый бюджет",
          value: `${totalBudget.toLocaleString()}`,
          subtext: "Суммарные затраты",
          icon: "",
        },
        {
          label: "Общий ROI рекламы",
          value: overallRoi,
          subtext: `Выручка: ${totalRevenue.toLocaleString()}`,
          icon: "",
        },
        {
          label: "Лидирующий источник",
          value: topChannel,
          subtext: maxDeals > 0 ? `Сделок: ${maxDeals}` : "Нет данных",
          icon: "",
        },
      ];
    }

    if (activeReportId === "RPT-025") {
      let totalBookings = activeReportData.length;
      let activeBookings = 0;
      let convertedBookings = 0;

      activeBookings = activeReportData.filter(
        (row) => row["Статус"] === "Активна",
      ).length;
      // booking-to-contract conversion is simulated or based on deal status
      // We can count non-expired, converted ones
      convertedBookings = activeReportData.filter(
        (row) =>
          row["Причина снятия"].includes("Сделка") ||
          (row["Статус"] === "Снята" &&
            !row["Причина снятия"].includes("Истечение")),
      ).length;

      const convPct =
        totalBookings > 0
          ? ((convertedBookings / totalBookings) * 100).toFixed(0) + "%"
          : "0%";

      return [
        {
          label: "Всего броней",
          value: totalBookings.toString(),
          subtext: "За выбранный период",
          icon: "",
        },
        {
          label: "Активных броней",
          value: activeBookings.toString(),
          subtext: "Ожидают оплаты/договора",
          icon: "",
        },
        {
          label: "Конверсия в договор",
          value: convPct,
          subtext: "Доля успешных броней",
          icon: "",
        },
      ];
    }

    // Дефолтные показатели для некритических отчетов
    return [
      {
        label: "Всего записей",
        value: activeReportData.length.toString(),
        subtext: "В текущей таблице",
        icon: "",
      },
    ];
  }, [activeReportId, activeReportData, funnelViewMode]);

  // Заголовки колонок таблицы на основе полученных данных
  const tableHeaders = useMemo(() => {
    if (activeReportData.length === 0) return [];
    return Object.keys(activeReportData[0]);
  }, [activeReportData]);

  // Выгрузка в Excel с помощью библиотеки xlsx
  const handleDownloadExcel = () => {
    if (activeReportData.length === 0) {
      alert("Нет данных для выгрузки!");
      return;
    }

    // Создаем рабочий лист Excel из массива объектов
    const worksheet = XLSX.utils.json_to_sheet(activeReportData);

    // Подгоняем авто-ширину для колонок
    const colWidths = Object.keys(activeReportData[0]).map((key) => {
      const maxLen = activeReportData.reduce((max, row) => {
        const val = row[key] ? row[key].toString() : "";
        return Math.max(max, val.length);
      }, key.length);
      return { wch: maxLen + 4 }; // С запасом под рамки
    });
    worksheet["!cols"] = colWidths;

    // Создаем книгу
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      activeReport.name.substring(0, 31),
    ); // Имя вкладки ограничено 31 символом

    // Генерируем файл и инициируем скачивание в браузере
    const filename = `${activeReport.id}_${activeReport.name.replace(/\s+/g, "_")}.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  return (
    <div className={styles.container}>
      {/* Левый рубрикатор отчетов */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTitle}>Каталог отчетов</div>

        {CATEGORIES.map((cat) => (
          <div key={cat.id} className={styles.categoryBlock}>
            <div className={styles.categoryHeader}>{cat.name}</div>
            <ul className={styles.reportList}>
              {REPORT_CATALOG.filter((r) => r.category === cat.id && !(r as any).hidden).map(
                (report) => (
                  <li
                    key={report.id}
                    className={`${styles.reportItem} ${activeReportId === report.id ? styles.activeReport : ""}`}
                    onClick={() => handleSelectReport(report.id, cat.id)}
                  >
                    <div className={styles.reportItemHeader}>
                      <span>{report.name}</span>
    
                      
                    </div>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </aside>

      {/* Правая часть с отчетом и фильтрами */}
      <main className={styles.mainContent}>
        <header className={styles.reportHeader}>
          <div>
            <h1 className={styles.reportTitle}>
              {activeReport.name}
              {!IMPLEMENTED_REPORTS.includes(activeReport.id) && (
                <span className={styles.draftBadge}>Интерактивный макет</span>
              )}
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "normal",
                  color: "#64748b",
                  marginLeft: "10px",
                  background: "#f1f5f9",
                  padding: "3px 8px",
                  borderRadius: "4px",
                }}
              >
                Текущая роль: {userRole || "не определена"}
              </span>
            </h1>
            <p className={styles.reportDescription}>
              {activeReport.description}
            </p>
          </div>
          {reportGenerated && activeReportData.length > 0 && (
            <button className={styles.excelBtn} onClick={handleDownloadExcel}>
              Скачать в Excel
            </button>
          )}
        </header>

        {/* Переключатель режима воронки продаж (RPT-001) */}
        {activeReportId === "RPT-001" && (
          <div className={styles.funnelModeContainer}>
            <button
              type="button"
              className={`${styles.modeTab} ${funnelViewMode === "pipeline" ? styles.activeModeTab : ""}`}
              onClick={() => setFunnelViewMode("pipeline")}
            >
              Текущие сделки (Pipeline)
            </button>
            <button
              type="button"
              className={`${styles.modeTab} ${funnelViewMode === "conversion" ? styles.activeModeTab : ""}`}
              onClick={() => setFunnelViewMode("conversion")}
            >
              Исторические переходы (Conversion)
            </button>
          </div>
        )}

        {/* Карточки показателей (KPI Stat Cards) */}
        {reportGenerated && (
          <div className={styles.statsGrid}>
            {reportStats.map((stat, idx) => (
              <div key={idx} className={styles.statCard}>
                <div className={styles.statHeader}>
                  <span className={styles.statLabel}>{stat.label}</span>
                </div>
                <div className={styles.statValue}>{stat.value}</div>
                <div className={styles.statSub}>{stat.subtext}</div>
              </div>
            ))}
          </div>
        )}

        {/* Панель фильтров */}
        <section
          className={styles.filterBar}
          style={{ flexWrap: "wrap", gap: "15px" }}
        >
          {/* Фильтр по датам (Период) - доступен везде */}
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Период С</label>
            <input
              type="date"
              className={styles.filterInput}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>По</label>
            <input
              type="date"
              className={styles.filterInput}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          {/* Фильтр ЖК (Project) - доступен везде */}
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Проект (ЖК)</label>
            <select
              className={styles.filterInput}
              value={selectedProject}
              onChange={(e) => {
                setSelectedProject(e.target.value);
                setSelectedBlock("ALL"); // сброс корпуса при смене ЖК
              }}
            >
              <option value="ALL">Все ЖК</option>
              {projects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  {proj.name}
                </option>
              ))}
            </select>
          </div>

          {/* Менеджер - RPT-001, RPT-003, RPT-004, RPT-005, RPT-021 */}

          {(activeReportId === "RPT-001" ||
            activeReportId === "RPT-003" ||
            activeReportId === "RPT-004" ||
            activeReportId === "RPT-005" ||
            activeReportId === "RPT-021" ||
            activeReportId === "RPT-023" ||
            activeReportId === "RPT-025") && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Менеджер</label>
              <select
                className={styles.filterInput}
                value={selectedManager}
                onChange={(e) => setSelectedManager(e.target.value)}
              >
                <option value="ALL">Все менеджеры</option>
                {managers.map((mgr) => (
                  <option key={mgr} value={mgr}>
                    {mgr}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Источник трафика - RPT-001, RPT-007, RPT-022 */}

          {(activeReportId === "RPT-001" ||
            activeReportId === "RPT-007" ||
            activeReportId === "RPT-022" ||
            activeReportId === "RPT-024") && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Источник</label>
              <select
                className={styles.filterInput}
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
              >
                <option value="ALL">Все источники</option>
                {sources.map((src) => (
                  <option key={src} value={src}>
                    {src}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Канал - RPT-001, RPT-007 */}
          {(activeReportId === "RPT-001" ||
            activeReportId === "RPT-007" ||
            activeReportId === "RPT-024") && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Канал</label>
              <select
                className={styles.filterInput}
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
              >
                <option value="ALL">Все каналы</option>
                {CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>
                    {CHANNEL_TRANSLATIONS[ch] || ch}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Тип брони - RPT-025 */}
          {activeReportId === "RPT-025" && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Тип брони</label>
              <select
                className={styles.filterInput}
                value={selectedBookingType}
                onChange={(e) => setSelectedBookingType(e.target.value)}
              >
                <option value="ALL">Все типы</option>
                <option value="SOFT">Устная бронь</option>
                <option value="HARD">Платная бронь</option>
              </select>
            </div>
          )}

          {/* Схема оплаты - RPT-001, RPT-004 */}
          {(activeReportId === "RPT-001" || activeReportId === "RPT-004") && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Схема оплаты</label>
              <select
                className={styles.filterInput}
                value={selectedPaymentType}
                onChange={(e) => setSelectedPaymentType(e.target.value)}
              >
                <option value="ALL">Все схемы</option>
                {paymentTypes.map((pt) => (
                  <option key={pt} value={pt}>
                    {PAYMENT_TYPE_TRANSLATIONS[pt] || pt}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Тип клиента - RPT-001 */}
          {activeReportId === "RPT-001" && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Тип клиента</label>
              <select
                className={styles.filterInput}
                value={selectedClientType}
                onChange={(e) => setSelectedClientType(e.target.value)}
              >
                <option value="ALL">Все типы</option>
                <option value="VIP">VIP клиент</option>
                <option value="REGULAR">Обычный клиент</option>
              </select>
            </div>
          )}

          {/* Корпус - RPT-002, RPT-015, RPT-016, RPT-017, RPT-020 */}
          {(activeReportId === "RPT-002" ||
            activeReportId === "RPT-015" ||
            activeReportId === "RPT-016" ||
            activeReportId === "RPT-017" ||
            activeReportId === "RPT-020") && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Корпус</label>
              <select
                className={styles.filterInput}
                value={selectedBlock}
                onChange={(e) => setSelectedBlock(e.target.value)}
              >
                <option value="ALL">Все корпуса</option>
                {blocks
                  .filter(
                    (b) =>
                      selectedProject === "ALL" ||
                      b.projectId === selectedProject,
                  )
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.number}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Тип помещения - RPT-002, RPT-015, RPT-016, RPT-017, RPT-018 */}
          {(activeReportId === "RPT-002" ||
            activeReportId === "RPT-015" ||
            activeReportId === "RPT-016" ||
            activeReportId === "RPT-017" ||
            activeReportId === "RPT-018") && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Тип помещения</label>
              <select
                className={styles.filterInput}
                value={selectedUnitType}
                onChange={(e) => setSelectedUnitType(e.target.value)}
              >
                <option value="ALL">Все типы</option>
                {unitTypes.map((ut) => (
                  <option key={ut} value={ut}>
                    {UNIT_TYPE_TRANSLATIONS[ut] || ut}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Фильтр статуса — только RPT-008 */}
          {activeReportId === "RPT-008" && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Статус оплаты</label>
              <select
                className={styles.filterInput}
                value={selectedPaymentStatus}
                onChange={(e) => setSelectedPaymentStatus(e.target.value)}
              >
                <option value="ALL">Все статусы</option>
                <option value="PAID">Оплачено</option>
                <option value="OVERDUE">Просрочено</option>
                <option value="PENDING">Ожидается</option>
              </select>
            </div>
          )}

          {/* Фильтры бакета просрочки и менеджера — только RPT-009 */}
          {activeReportId === "RPT-009" && (
            <>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Срок просрочки</label>
                <select
                  className={styles.filterInput}
                  value={selectedOverdueBucket}
                  onChange={(e) => setSelectedOverdueBucket(e.target.value)}
                >
                  <option value="ALL">Все сроки</option>
                  <option value="1-30">1–30 дней</option>
                  <option value="30-60">31–60 дней</option>
                  <option value="60-90">61–90 дней</option>
                  <option value="90+">90+ дней</option>
                </select>
              </div>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Менеджер</label>
                <select
                  className={styles.filterInput}
                  value={selectedDebtManager}
                  onChange={(e) => setSelectedDebtManager(e.target.value)}
                >
                  <option value="ALL">Все менеджеры</option>
                  {Array.from(
                    new Set(
                      initialData.debtors
                        .map((r: any) => r.managerId)
                        .filter(Boolean),
                    ),
                  ).map((mgr: any) => (
                    <option key={mgr} value={mgr}>
                      {mgr}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Фильтр схемы оплаты — только RPT-010 */}
          {activeReportId === "RPT-010" && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Схема оплаты</label>
              <select
                className={styles.filterInput}
                value={selectedCashFlowPaymentType}
                onChange={(e) => setSelectedCashFlowPaymentType(e.target.value)}
              >
                <option value="ALL">Все схемы</option>
                {paymentTypes.map((pt) => (
                  <option key={pt} value={pt}>
                    {PAYMENT_TYPE_TRANSLATIONS[pt] || pt}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Фильтры диапазона скидки и менеджера — только RPT-011 */}
          {activeReportId === "RPT-011" && (
            <>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Диапазон скидки</label>
                <select
                  className={styles.filterInput}
                  value={selectedDiscountRange}
                  onChange={(e) => setSelectedDiscountRange(e.target.value)}
                >
                  <option value="ALL">Любой %</option>
                  <option value="0-3">до 3%</option>
                  <option value="3-5">3–5%</option>
                  <option value="5-10">5–10%</option>
                  <option value="10+">более 10%</option>
                </select>
              </div>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Менеджер</label>
                <select
                  className={styles.filterInput}
                  value={selectedDiscountManager}
                  onChange={(e) => setSelectedDiscountManager(e.target.value)}
                >
                  <option value="ALL">Все менеджеры</option>
                  {Array.from(
                    new Set(
                      initialData.discountReport
                        .map((r: any) => r.managerId)
                        .filter(Boolean),
                    ),
                  ).map((mgr: any) => (
                    <option key={mgr} value={mgr}>
                      {mgr}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Фильтры банка и статуса заявки — только RPT-012 */}
          {activeReportId === "RPT-012" && (
            <>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Банк</label>
                <select
                  className={styles.filterInput}
                  value={selectedMortgageBank}
                  onChange={(e) => setSelectedMortgageBank(e.target.value)}
                >
                  <option value="ALL">Все банки</option>
                  {Array.from(
                    new Set(
                      initialData.mortgageReport
                        .map((r: any) => r.mortgageBank)
                        .filter(Boolean),
                    ),
                  ).map((bank: any) => (
                    <option key={bank} value={bank}>
                      {bank}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Статус заявки</label>
                <select
                  className={styles.filterInput}
                  value={selectedMortgageStatus}
                  onChange={(e) => setSelectedMortgageStatus(e.target.value)}
                >
                  <option value="ALL">Все статусы</option>
                  <option value="APPROVED">Одобрено</option>
                  <option value="PENDING">На рассмотрении</option>
                  <option value="REJECTED">Отклонено</option>
                </select>
              </div>
            </>
          )}

          {/* Фильтры статуса, инициатора, согласующего — только RPT-005 */}
          {activeReportId === "RPT-005" && (
            <>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Статус заявки</label>
                <select
                  className={styles.filterInput}
                  value={draftStatusFilter}
                  onChange={(e) => setDraftStatusFilter(e.target.value)}
                >
                  <option value="ALL">Все статусы</option>
                  <option value="IN_PROGRESS">В работе</option>
                  <option value="APPROVED">Одобрен</option>
                  <option value="REJECTED">Отклонен</option>
                </select>
              </div>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Инициатор</label>
                <select
                  className={styles.filterInput}
                  value={selectedInitiator}
                  onChange={(e) => setSelectedInitiator(e.target.value)}
                >
                  <option value="ALL">Все инициаторы</option>
                  {initiators.map((init) => (
                    <option key={init} value={init}>
                      {init}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Согласующий</label>
                <select
                  className={styles.filterInput}
                  value={selectedApprover}
                  onChange={(e) => setSelectedApprover(e.target.value)}
                >
                  <option value="ALL">Все согласующие</option>
                  {approvers.map((appr) => (
                    <option key={appr} value={appr}>
                      {appr}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Фильтр группировки по периоду — только RPT-006 */}
          {activeReportId === "RPT-006" && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>
                Группировка по периоду
              </label>
              <select
                className={styles.filterInput}
                value={dynamicsInterval}
                onChange={(e) => setDynamicsInterval(e.target.value)}
              >
                <option value="day">День</option>
                <option value="week">Неделя</option>
                <option value="month">Месяц</option>
                <option value="quarter">Квартал</option>
              </select>
            </div>
          )}

          {/* Фильтр интервала когорты — только RPT-007 */}
          {activeReportId === "RPT-007" && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Интервал когорты</label>
              <select
                className={styles.filterInput}
                value={cohortInterval}
                onChange={(e) => setCohortInterval(e.target.value)}
              >
                <option value="week">Неделя</option>
                <option value="month">Месяц</option>
                <option value="quarter">Квартал</option>
              </select>
            </div>
          )}

          {/* Фильтр статуса сделки — только RPT-022 */}
          {activeReportId === "RPT-022" && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Статус сделки</label>
              <select
                className={styles.filterInput}
                value={dealStatusFilter}
                onChange={(e) => setDealStatusFilter(e.target.value)}
              >
                <option value="ALL">Все статусы</option>
                {STAGE_ORDER.map((stage) => (
                  <option key={stage} value={stage}>
                    {STAGE_TRANSLATIONS[stage] || stage}
                  </option>
                ))}
                <option value="Нет сделки">Нет сделки</option>
              </select>
            </div>
          )}

          {/* Фильтры площади от/до — RPT-015, RPT-016, RPT-018 */}
          {(activeReportId === "RPT-015" ||
            activeReportId === "RPT-016" ||
            activeReportId === "RPT-018") && (
            <>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Площадь от (м²)</label>
                <input
                  type="number"
                  placeholder="Мин"
                  className={styles.filterInput}
                  value={minArea}
                  onChange={(e) => setMinArea(e.target.value)}
                />
              </div>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Площадь до (м²)</label>
                <input
                  type="number"
                  placeholder="Макс"
                  className={styles.filterInput}
                  value={maxArea}
                  onChange={(e) => setMaxArea(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Фильтры цены от/до — RPT-015, RPT-018 */}
          {(activeReportId === "RPT-015" || activeReportId === "RPT-018") && (
            <>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Цена от ($)</label>
                <input
                  type="number"
                  placeholder="Мин"
                  className={styles.filterInput}
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                />
              </div>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Цена до ($)</label>
                <input
                  type="number"
                  placeholder="Макс"
                  className={styles.filterInput}
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Фильтр этажа — RPT-018 */}
          {activeReportId === "RPT-018" && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Этаж</label>
              <input
                type="number"
                placeholder="Этаж"
                className={styles.filterInput}
                value={filterFloor}
                onChange={(e) => setFilterFloor(e.target.value)}
              />
            </div>
          )}

          {/* Фильтр вида из окна — RPT-018 */}
          {activeReportId === "RPT-018" && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Вид из окна</label>
              <select
                className={styles.filterInput}
                value={filterView}
                onChange={(e) => setFilterView(e.target.value)}
              >
                <option value="ALL">Любой вид</option>
                <option value="Море">Море</option>
                <option value="Горы">Горы</option>
                <option value="Город">Город</option>
                <option value="Двор">Двор</option>
                <option value="Парк">Парк</option>
              </select>
            </div>
          )}

          {/* Фильтр номера квартиры — RPT-019, RPT-020 */}
          {(activeReportId === "RPT-019" || activeReportId === "RPT-020") && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Номер квартиры</label>
              <input
                type="text"
                placeholder="Номер"
                className={styles.filterInput}
                value={filterUnitNumber}
                onChange={(e) => setFilterUnitNumber(e.target.value)}
              />
            </div>
          )}

          {/* Фильтр инициатора — RPT-019 */}
          {activeReportId === "RPT-019" && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Инициатор</label>
              <select
                className={styles.filterInput}
                value={filterInitiator}
                onChange={(e) => setFilterInitiator(e.target.value)}
              >
                <option value="ALL">Все инициаторы</option>
                {Array.from(
                  new Set(
                    (initialData.priceHistory || [])
                      .map((r: any) => r.initiator)
                      .filter(Boolean),
                  ),
                ).map((init: any) => (
                  <option key={init} value={init}>
                    {init}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            className={styles.searchBtn}
            onClick={() => setReportGenerated(true)}
          >
            Сформировать
          </button>
        </section>

        {/* Таблица результатов */}
        <section className={styles.tableCard}>
          {!reportGenerated ? (
            <div className={styles.noData}>
              Настройте фильтры и нажмите «Сформировать»
            </div>
          ) : activeReportData.length > 0 ? (
            <div className={styles.tableResponsive}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {tableHeaders.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeReportData.map((row, idx) => (
                    <tr key={idx}>
                      {tableHeaders.map((header) => {
                        const val = row[header];

                        // Определяем класс ячейки по содержимому
                        let cellClass = "";
                        if (header === "Статус оплат") {
                          if (val === "Оплачено") cellClass = styles.statusPaid;
                          else if (val === "Просрочено")
                            cellClass = styles.statusOverdue;
                          else if (val === "Ожидается")
                            cellClass = styles.statusPending;
                        } else if (header === "Статус RS.ge") {
                          if (String(val).includes("Успешно"))
                            cellClass = styles.statusSuccess;
                          else if (String(val).includes("Ошибка"))
                            cellClass = styles.statusFailed;
                          else if (String(val).includes("Ожидает"))
                            cellClass = styles.statusWaiting;
                        } else if (header === "Статус ипотеки") {
                          if (String(val).includes("Одобрено"))
                            cellClass = styles.statusApproved;
                          else if (String(val).includes("Отклонено"))
                            cellClass = styles.statusRejected;
                          else if (String(val).includes("рассмотрении"))
                            cellClass = styles.statusReview;
                        } else if (header === "Бакет просрочки") {
                          if (String(val).includes("31–60"))
                            cellClass = styles.bucket30_60;
                          else if (String(val).includes("61–90"))
                            cellClass = styles.bucket60_90;
                          else if (String(val).includes("90+"))
                            cellClass = styles.bucket90plus;
                        }

                        return (
                          <td key={header} className={cellClass || undefined}>
                            {typeof val === "number" && header.includes("($)")
                              ? `$${val.toLocaleString()}`
                              : typeof val === "number" &&
                                  header.includes("(GEL)")
                                ? `₾${val.toLocaleString()}`
                                : val}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.noData}>Нет данных за выбранный период</div>
          )}
        </section>
      </main>
    </div>
  );
}