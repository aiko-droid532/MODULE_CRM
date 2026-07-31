// Общий движок калькулятора рассрочки — используется в карточке объекта (Shakhmatka)
// и в карточке лида (LeadDossier) как вариант схемы оплаты.
// Вся логика — по ТЗ заказчика ("Калькулятор графика платежей").

export type Periodicity = 'MONTHLY' | 'QUARTERLY' | 'BIWEEKLY';
export type DiscountApplyType = 'TOTAL_AREA' | 'PER_SQM';
export type ScheduleType = 'STANDARD' | 'CUSTOM';

export const PERIODICITY_LABELS: Record<Periodicity, string> = {
  MONTHLY: 'Раз в месяц',
  QUARTERLY: 'Раз в квартал',
  BIWEEKLY: 'Раз в 2 недели',
};

export interface InstallmentInput {
  area: number;               // площадь, м²
  basePricePerSqm: number;    // начальная цена за м², $ (из каталога)
  discountApplyType: DiscountApplyType;
  discountAmount: number;     // сумма скидки, $ (за м² либо на всю площадь — см. discountApplyType)
  nbgRate: number;            // курс НБГ, ₾ за $1
  firstPaymentDate: string;   // YYYY-MM-DD — вводится вручную
  firstPaymentAmount: number; // $
  recurringAmount: number;    // $ за один периодический платёж
  periodicity: Periodicity;
  deliveryDate: string;       // YYYY-MM-DD — дата сдачи (объекта либо ЖК), задаёт конец графика и дату остатка
  lastPaymentAmount: number;  // $ — остаток, вводится/синхронизируется независимо
}

export interface ScheduleRow {
  index: number;
  date: string;       // YYYY-MM-DD
  label: 'Первый взнос' | 'Периодический платёж' | 'Финальный платёж';
  amountUSD: number;
  amountGEL: number;
  isWeekend: boolean;
}

export interface InstallmentResult {
  basePriceUSD: number;
  basePricePerSqmUSD: number;
  basePriceGEL: number;
  basePricePerSqmGEL: number;
  discountTotalUSD: number;       // фактическая сумма скидки на всю площадь
  finalPriceUSD: number;
  finalPricePerSqmUSD: number;
  finalPriceGEL: number;
  finalPricePerSqmGEL: number;
  scheduleStartDate: string;      // авто: месяц, следующий за первым взносом
  scheduleEndDate: string;        // авто: месяц перед датой сдачи
  monthsCount: number;
  lastPaymentDate: string;        // = дата сдачи
  controlSumUSD: number;          // первый + периодические*N + последний
  isValid: boolean;               // контрольная сумма == итоговая цена (допуск 1 цент)
  schedule: ScheduleRow[];
}

// ── Базовая и итоговая цена ─────────────────────────────────────────────
export function calcBasePrice(area: number, basePricePerSqm: number): number {
  return round2(area * basePricePerSqm);
}

export function calcFinalPrice(area: number, basePricePerSqm: number, discountApplyType: DiscountApplyType, discountAmount: number): number {
  return round2(calcBasePrice(area, basePricePerSqm) - calcDiscountTotal(area, discountApplyType, discountAmount));
}

export function calcDiscountTotal(
  area: number,
  discountApplyType: DiscountApplyType,
  discountAmount: number
): number {
  if (!discountAmount) return 0;
  return discountApplyType === 'PER_SQM'
    ? round2(discountAmount * area)
    : round2(discountAmount);
}

// ── Автодаты графика: начало = месяц после первого взноса, конец = месяц перед сдачей ──
export function computeAutoScheduleDates(
  firstPaymentDate: string,
  deliveryDate: string
): { scheduleStartDate: string; scheduleEndDate: string } {
  if (!firstPaymentDate || !deliveryDate) {
    return { scheduleStartDate: '', scheduleEndDate: '' };
  }
  const start = addMonthsKeepDay(firstPaymentDate, 1);
  const end = addMonthsKeepDay(deliveryDate, -1, new Date(firstPaymentDate).getDate());
  return { scheduleStartDate: start, scheduleEndDate: end };
}

function addMonthsKeepDay(dateISO: string, monthsDelta: number, dayOverride?: number): string {
  const d = new Date(dateISO);
  const day = dayOverride ?? d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + monthsDelta, 1);
  const lastDayOfTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDayOfTargetMonth));
  return toISODate(target);
}

// ── Количество периодов между scheduleStartDate и scheduleEndDate ──────
export function calcPeriodsCount(
  startDate: string,
  endDate: string,
  periodicity: Periodicity
): number {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end < start) return 0;

  const stepDays = periodicity === 'BIWEEKLY' ? 14 : null;
  if (stepDays) {
    const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000);
    return Math.floor(diffDays / stepDays) + 1;
  }

  // MONTHLY / QUARTERLY — считаем по месяцам
  const stepMonths = periodicity === 'QUARTERLY' ? 3 : 1;
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  return Math.floor(months / stepMonths) + 1;
}

export function generatePeriodDates(
  startDate: string,
  count: number,
  periodicity: Periodicity
): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    if (periodicity === 'BIWEEKLY') {
      d.setDate(d.getDate() + i * 14);
    } else {
      const stepMonths = periodicity === 'QUARTERLY' ? 3 : 1;
      d.setMonth(d.getMonth() + i * stepMonths);
    }
    dates.push(toISODate(d));
  }
  return dates;
}

// ── Полный расчёт графика ───────────────────────────────────────────────
export function calculateInstallmentPlan(input: InstallmentInput): InstallmentResult {
  const basePriceUSD = calcBasePrice(input.area, input.basePricePerSqm);
  const basePricePerSqmUSD = round2(input.basePricePerSqm);
  const discountTotalUSD = calcDiscountTotal(input.area, input.discountApplyType, input.discountAmount);

  const finalPriceUSD = round2(basePriceUSD - discountTotalUSD);
  const finalPricePerSqmUSD = input.area > 0 ? round2(finalPriceUSD / input.area) : 0;

  const rate = input.nbgRate || 0;
  const basePriceGEL = round2(basePriceUSD * rate);
  const basePricePerSqmGEL = round2(basePricePerSqmUSD * rate);
  const finalPriceGEL = round2(finalPriceUSD * rate);
  const finalPricePerSqmGEL = round2(finalPricePerSqmUSD * rate);

  const { scheduleStartDate, scheduleEndDate } = computeAutoScheduleDates(input.firstPaymentDate, input.deliveryDate);
  const monthsCount = calcPeriodsCount(scheduleStartDate, scheduleEndDate, input.periodicity);
  const periodDates = generatePeriodDates(scheduleStartDate, monthsCount, input.periodicity);

  const recurringTotal = round2(input.recurringAmount * monthsCount);
  const lastPaymentDate = input.deliveryDate;
  const lastPaymentAmountUSD = round2(input.lastPaymentAmount);

  const controlSumUSD = round2(input.firstPaymentAmount + recurringTotal + lastPaymentAmountUSD);
  const isValid = Math.abs(controlSumUSD - finalPriceUSD) < 0.02 && finalPriceUSD > 0;

  const schedule: ScheduleRow[] = [];
  if (input.firstPaymentDate && input.firstPaymentAmount) {
    schedule.push(makeRow(0, input.firstPaymentDate, 'Первый взнос', input.firstPaymentAmount, rate));
  }
  periodDates.forEach((date) => {
    schedule.push(makeRow(schedule.length, date, 'Периодический платёж', input.recurringAmount, rate));
  });
  if (lastPaymentAmountUSD !== 0 && lastPaymentDate) {
    schedule.push(makeRow(schedule.length, lastPaymentDate, 'Финальный платёж', lastPaymentAmountUSD, rate));
  }

  return {
    basePriceUSD,
    basePricePerSqmUSD,
    basePriceGEL,
    basePricePerSqmGEL,
    discountTotalUSD,
    finalPriceUSD,
    finalPricePerSqmUSD,
    finalPriceGEL,
    finalPricePerSqmGEL,
    scheduleStartDate,
    scheduleEndDate,
    monthsCount,
    lastPaymentDate,
    controlSumUSD,
    isValid,
    schedule,
  };
}

// ── Стандартный пресет: 10% / 20% равномерно / остаток = 100% - 10% - 20% ──
export function applyStandardPreset(
  finalPriceUSD: number,
  firstPaymentDate: string,
  deliveryDate: string,
  periodicity: Periodicity
): { firstPaymentAmount: number; recurringAmount: number; lastPaymentAmount: number } {
  const firstPaymentAmount = round2(finalPriceUSD * 0.1);
  const monthlyTotalTarget = round2(finalPriceUSD * 0.2);
  const { scheduleStartDate, scheduleEndDate } = computeAutoScheduleDates(firstPaymentDate, deliveryDate);
  const monthsCount = Math.max(1, calcPeriodsCount(scheduleStartDate, scheduleEndDate, periodicity));
  const recurringAmount = Math.round(monthlyTotalTarget / monthsCount);
  const lastPaymentAmount = round2(finalPriceUSD - firstPaymentAmount - recurringAmount * monthsCount);
  return { firstPaymentAmount, recurringAmount, lastPaymentAmount };
}

// ── Доступность рассрочки по статусу объекта ────────────────────────────
export function isUnitDelivered(deliveryDate?: string | null): boolean {
  if (!deliveryDate) return false;
  return new Date(deliveryDate) <= new Date();
}

// ── Вспомогательные ──────────────────────────────────────────────────────
function makeRow(
  index: number,
  date: string,
  label: ScheduleRow['label'],
  amountUSD: number,
  rate: number
): ScheduleRow {
  const d = new Date(date);
  const day = d.getDay(); // 0 = вс, 6 = сб
  return {
    index: index + 1,
    date,
    label,
    amountUSD: round2(amountUSD),
    amountGEL: round2(amountUSD * rate),
    isWeekend: day === 0 || day === 6,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateRu(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// Приводит значение даты из БД (может прийти и JS Date-объектом, и ISO-строкой,
// и строкой в формате "2028-02-28T00:00:00.000Z") к чистому "YYYY-MM-DD".
export function toDateInputValue(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return toISODate(value);
  }
  const str = String(value);
  const match = str.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? '' : toISODate(parsed);
}

// ── Экспорт графика (MVP: CSV с локализованными заголовками) ───────────
// Прим.: реализация — базовый CSV-экспорт для скачивания/печати.
// Если нужен брендированный PDF/DOCX по шаблону — потребуется отдельный шаблон
// (сообщите, если такой уже есть у заказчика).
type ExportLang = 'GEO' | 'ENG' | 'RUS';

const EXPORT_HEADERS: Record<ExportLang, string[]> = {
  RUS: ['№', 'Дата платежа', 'Сумма ($)', 'Сумма (₾)'],
  ENG: ['#', 'Payment Date', 'Amount ($)', 'Amount (GEL)'],
  GEO: ['#', 'გადახდის თარიღი', 'თანხა ($)', 'თანხა (₾)'],
};

export function exportScheduleCsv(schedule: ScheduleRow[], lang: ExportLang, unitLabel: string) {
  const headers = EXPORT_HEADERS[lang];
  const lines = [headers.join(';')];
  schedule.forEach((r) => {
    lines.push([r.index, formatDateRu(r.date), r.amountUSD, r.amountGEL].join(';'));
  });
  const csv = '\uFEFF' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Grafik_${lang}_${unitLabel}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}