// Движок расчёта акционной цены — Модуль "Акции и специальные предложения" (Этап 1)
// Формулы строго по разделу 3 ТЗ ("Акции и специальные предложения").

export type PromotionEffectType =
  | 'DISCOUNT_PER_SQM'      // Скидка за м²
  | 'DISCOUNT_TOTAL'        // Скидка на общую стоимость
  | 'SPECIAL_RATE_PER_SQM'  // Спецтариф USD/м²
  | 'MARKUP'                // Наценка
  | 'FIXED_PRICE';          // Фиксированная цена

export type PromotionEffectValueType = 'PERCENT' | 'AMOUNT';

export const EFFECT_TYPE_LABELS: Record<PromotionEffectType, string> = {
  DISCOUNT_PER_SQM: 'Скидка за м²',
  DISCOUNT_TOTAL: 'Скидка на общую стоимость',
  SPECIAL_RATE_PER_SQM: 'Спецтариф USD/м²',
  MARKUP: 'Наценка',
  FIXED_PRICE: 'Фиксированная цена',
};

export interface PromotionEffect {
  effectType: PromotionEffectType;
  effectValueType: PromotionEffectValueType; // применимо только к DISCOUNT_TOTAL и MARKUP
  effectValue: number;
}

export interface PromoPriceResult {
  originalPriceUSD: number;      // текущая (актуальная, с учётом МИЦ) цена помещения
  originalPricePerSqmUSD: number;
  promoPriceUSD: number;
  promoPricePerSqmUSD: number;
  promoPriceGEL: number;
  promoPricePerSqmGEL: number;
  nbgRate: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Считает акционную цену помещения по текущей (актуальной) цене — раздел 3 ТЗ.
 * currentPriceUSD — это ВСЕГДА Unit.price на данный момент (уже с учётом МИЦ, если оно применялось).
 */
export function calcPromoPrice(
  currentPriceUSD: number,
  area: number,
  effect: PromotionEffect,
  nbgRate: number
): PromoPriceResult {
  const originalPricePerSqmUSD = area > 0 ? currentPriceUSD / area : 0;
  let promoPriceUSD = currentPriceUSD;

  switch (effect.effectType) {
    case 'DISCOUNT_PER_SQM': {
      // Акционная цена $ = (Начальная цена за м² − Скидка за м²) × Площадь
      const promoPerSqm = originalPricePerSqmUSD - effect.effectValue;
      promoPriceUSD = promoPerSqm * area;
      break;
    }
    case 'DISCOUNT_TOTAL': {
      // Акционная цена $ = Начальная цена − Скидка (сумма или %)
      const discountAmount =
        effect.effectValueType === 'PERCENT'
          ? currentPriceUSD * (effect.effectValue / 100)
          : effect.effectValue;
      promoPriceUSD = currentPriceUSD - discountAmount;
      break;
    }
    case 'SPECIAL_RATE_PER_SQM': {
      // Акционная цена $ = Спецтариф × Площадь
      promoPriceUSD = effect.effectValue * area;
      break;
    }
    case 'MARKUP': {
      // Акционная цена $ = Начальная цена + Наценка (сумма или %)
      const markupAmount =
        effect.effectValueType === 'PERCENT'
          ? currentPriceUSD * (effect.effectValue / 100)
          : effect.effectValue;
      promoPriceUSD = currentPriceUSD + markupAmount;
      break;
    }
    case 'FIXED_PRICE': {
      // Акционная цена $ = заданная сумма
      promoPriceUSD = effect.effectValue;
      break;
    }
  }

  promoPriceUSD = round2(Math.max(0, promoPriceUSD));
  const promoPricePerSqmUSD = area > 0 ? round2(promoPriceUSD / area) : 0;

  return {
    originalPriceUSD: round2(currentPriceUSD),
    originalPricePerSqmUSD: round2(originalPricePerSqmUSD),
    promoPriceUSD,
    promoPricePerSqmUSD,
    promoPriceGEL: round2(promoPriceUSD * nbgRate),
    promoPricePerSqmGEL: round2(promoPricePerSqmUSD * nbgRate),
    nbgRate,
  };
}

/** Активна ли акция прямо сейчас (по статусу и периоду) */
export function isPromotionLive(status: string, startAt: string | Date, endAt: string | Date): boolean {
  if (status !== 'ACTIVE') return false;
  const now = Date.now();
  return now >= new Date(startAt).getTime() && now <= new Date(endAt).getTime();
}

/** Формальный (авто-вычисляемый на лету, без физического апдейта в БД) жизненный статус акции для отображения */
export function computeDisplayStatus(status: string, startAt: string | Date, endAt: string | Date): string {
  if (status === 'DRAFT' || status === 'CANCELLED') return status;
  if (status === 'ACTIVE') {
    const now = Date.now();
    if (now > new Date(endAt).getTime()) return 'EXPIRED';
    if (now < new Date(startAt).getTime()) return 'ACTIVE'; // согласована, но ещё не наступила
    return 'ACTIVE';
  }
  return status;
}

// Показ даты/времени акции всегда в часовом поясе Грузии (UTC+4, без перехода на летнее время) —
// НЕ полагаемся на локальный часовой пояс браузера/сервера, т.к. он может отличаться и "плыть".
export function formatGeorgiaDateTime(d: string | Date): string {
  // Показ времени всегда в РЕАЛЬНОМ локальном часовом поясе того, кто смотрит
  // (браузер сам знает свой часовой пояс — не хардкодим конкретную страну/смещение).
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatEffectSummary(effect: PromotionEffect): string {
  const v = effect.effectValue;
  switch (effect.effectType) {
    case 'DISCOUNT_PER_SQM':
      return `−$${v}/м²`;
    case 'DISCOUNT_TOTAL':
      return effect.effectValueType === 'PERCENT' ? `−${v}%` : `−$${v}`;
    case 'SPECIAL_RATE_PER_SQM':
      return `$${v}/м² (спецтариф)`;
    case 'MARKUP':
      return effect.effectValueType === 'PERCENT' ? `+${v}%` : `+$${v}`;
    case 'FIXED_PRICE':
      return `$${v} (фикс.)`;
    default:
      return '';
  }
}