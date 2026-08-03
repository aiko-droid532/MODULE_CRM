'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from './Pricing.module.css';
import {
  getFilteredUnitsForPromotion,
  createPromotionDraft,
  updatePromotionDraft,
  getPromotionDetail,
  approvePromotion,
  cancelPromotion,
  deletePromotion,
  getPromotionAnalytics,
} from '@/app/actions/promotions';
import { massUpdatePrices } from '@/app/actions/units';
import {
  getCumulativeDiscountTiers,
  upsertCumulativeDiscountTier,
  deleteCumulativeDiscountTier,
} from '@/app/actions/loyalty';
import {
  EFFECT_TYPE_LABELS,
  computeDisplayStatus,
  formatEffectSummary,
  formatGeorgiaDateTime,
  calcPromoPrice,
  type PromotionEffectType,
  type PromotionEffectValueType,
} from '@/lib/promotionCalculator';
import { canCreatePromotions, canApprovePromotions, canManagePrices, canApplyDiscountPercent, getMaxDiscountPercent, getRequiredApproverLabel, UserRole } from '@/lib/roles';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  ACTIVE: 'Активна',
  EXPIRED: 'Истекла',
  CANCELLED: 'Отменена',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  DRAFT: 'badgeDraft',
  ACTIVE: 'badgeActive',
  EXPIRED: 'badgeExpired',
  CANCELLED: 'badgeCancelled',
};

// Даты/время акции всегда работают в РЕАЛЬНОМ локальном часовом поясе того, кто пользуется
// платформой (браузер сам знает свой пояс — мы не хардкодим конкретную страну/смещение).
function toDatetimeLocal(d?: string | Date): string {
  if (!d) return '';
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// datetime-local input не содержит часового пояса — если интерпретировать такую строку
// голым `new Date(...)` НА СЕРВЕРЕ, JS возьмёт локальный пояс сервера (не пользователя), и время уедет.
// Поэтому явно дописываем РЕАЛЬНОЕ смещение часового пояса БРАУЗЕРА пользователя (не хардкодим страну) —
// тогда сервер разберёт этот момент времени правильно, кто бы где ни находился.
function toLocalTZISOString(datetimeLocal: string): string {
  if (!datetimeLocal) return '';
  const probe = new Date(datetimeLocal); // интерпретируется в поясе браузера
  const offsetMin = -probe.getTimezoneOffset(); // например, +300 для Казахстана (UTC+5)
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${datetimeLocal}:00${sign}${oh}:${om}`;
}

interface PricingClientProps {
  projects: any[];
  initialPromotions: any[];
  organizationId: string;
  userRole?: string;
  managerId?: string;
}

export default function PricingClient({ projects, initialPromotions, organizationId, userRole = 'manager', managerId = '' }: PricingClientProps) {
  const role = userRole as UserRole;
  const canCreate = canCreatePromotions(role);
  const canApprove = canApprovePromotions(role);
  const canMic = canManagePrices(role);

  // Дата/время акции форматируются в локальном часовом поясе браузера смотрящего
  // (см. formatGeorgiaDateTime) — на сервере при SSR его нет, поэтому первый рендер
  // до монтирования в браузере не должен пытаться его показывать (иначе hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ── Накопительные скидки (Этап 2.2) ──────────────────────────────────────
  const [loyaltyTiers, setLoyaltyTiers] = useState<any[]>([]);
  const [loyaltyMinPurchases, setLoyaltyMinPurchases] = useState(2);
  const [loyaltyPercent, setLoyaltyPercent] = useState(0);
  const [editingLoyaltyId, setEditingLoyaltyId] = useState<string | null>(null);

  useEffect(() => {
    getCumulativeDiscountTiers(organizationId).then(setLoyaltyTiers);
  }, [organizationId]);

  function handleEditLoyaltyTier(t: any) {
    setEditingLoyaltyId(t.id);
    setLoyaltyMinPurchases(t.minPurchases);
    setLoyaltyPercent(t.discountPercent);
  }

  async function handleSaveLoyaltyTier() {
    setLoading(true);
    const res = await upsertCumulativeDiscountTier({
      id: editingLoyaltyId || undefined,
      minPurchases: loyaltyMinPurchases,
      discountPercent: loyaltyPercent,
      organizationId,
    });
    setLoading(false);
    if (res.success) {
      setEditingLoyaltyId(null);
      setLoyaltyMinPurchases(2);
      setLoyaltyPercent(0);
      getCumulativeDiscountTiers(organizationId).then(setLoyaltyTiers);
    } else {
      alert('Ошибка: ' + (res.error || ''));
    }
  }

  async function handleDeleteLoyaltyTier(id: string) {
    if (!confirm('Удалить уровень?')) return;
    setLoading(true);
    const res = await deleteCumulativeDiscountTier(id, organizationId);
    setLoading(false);
    if (res.success) {
      getCumulativeDiscountTiers(organizationId).then(setLoyaltyTiers);
    } else {
      alert('Ошибка: ' + (res.error || ''));
    }
  }
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'promotions' | 'mic' | 'loyalty' | 'analytics'>('promotions');
  const [promotions, setPromotions] = useState(initialPromotions);
  // router.refresh() после создания/согласования/отмены акции перезапрашивает данные на
  // сервере и обновляет initialPromotions, но useState выше берёт его только при первом
  // монтировании — без этого эффекта список не обновится без ручной перезагрузки страницы.
  useEffect(() => {
    setPromotions(initialPromotions);
  }, [initialPromotions]);

  // ── Аналитика по акциям (раздел 7 ТЗ) ────────────────────────────────────
  const [promoAnalytics, setPromoAnalytics] = useState<any[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  useEffect(() => {
    if (activeTab !== 'analytics') return;
    setAnalyticsLoading(true);
    getPromotionAnalytics(organizationId).then(rows => {
      setPromoAnalytics(rows);
      setAnalyticsLoading(false);
    });
  }, [activeTab, organizationId]);

  // Статус "Истекла" — вычисляемый (не хранится в БД), поэтому без тика по таймеру
  // бейдж не обновится сам, пока не перезагрузить страницу — досчитываем каждые 30с.
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);
  const [loading, setLoading] = useState(false);

  // ── Конструктор акции ──────────────────────────────────────────────────
  const [showConstructor, setShowConstructor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [filterProjectId, setFilterProjectId] = useState('');
  const [filterBlockId, setFilterBlockId] = useState('');
  const [filterFloorFrom, setFilterFloorFrom] = useState('');
  const [filterFloorTo, setFilterFloorTo] = useState('');
  const [filterAreaMin, setFilterAreaMin] = useState('');
  const [filterAreaMax, setFilterAreaMax] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterRooms, setFilterRooms] = useState('');

  const [previewUnits, setPreviewUnits] = useState<any[]>([]);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [listFinalized, setListFinalized] = useState(false);

  const [promoName, setPromoName] = useState('');
  const [effectType, setEffectType] = useState<PromotionEffectType>('DISCOUNT_PER_SQM');
  const [effectValueType, setEffectValueType] = useState<PromotionEffectValueType>('PERCENT');
  const [effectValue, setEffectValue] = useState(0);
  const [nbgRate, setNbgRate] = useState(2.7);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  // Лимиты применений (раздел 2 ТЗ) — пусто = без ограничения
  const [totalLimit, setTotalLimit] = useState('');
  const [perClientLimit, setPerClientLimit] = useState('');
  const [perUnitLimit, setPerUnitLimit] = useState('');

  const selectedBlock = projects.find((p: any) => p.id === filterProjectId);

  const finalUnits = useMemo(
    () => previewUnits.filter(u => !excludedIds.has(u.id)),
    [previewUnits, excludedIds]
  );

  // Предварительная оценка максимального % скидки среди помещений списка (худший случай) —
  // порог согласования по роли проверяется так же и на сервере при сохранении черновика.
  const maxPromoDiscountPercent = useMemo(() => {
    if (finalUnits.length === 0 || !effectValue) return 0;
    let max = 0;
    for (const u of finalUnits) {
      if (!u.price || u.price <= 0) continue;
      const promoPriceUSD = calcPromoPrice(u.price, u.area, { effectType, effectValueType, effectValue }, nbgRate).promoPriceUSD;
      const percent = ((u.price - promoPriceUSD) / u.price) * 100;
      if (percent > max) max = percent;
    }
    return Math.round(max * 10) / 10;
  }, [finalUnits, effectType, effectValueType, effectValue, nbgRate]);
  const promoDiscountAllowed = canApplyDiscountPercent(role, maxPromoDiscountPercent);

  // Граничное значение поля "Размер", при котором худший случай среди помещений списка
  // РОВНО упирается в порог согласования текущей роли — считается в обратную сторону от
  // порога (а не наоборот, как maxPromoDiscountPercent выше), чтобы подсказать сразу,
  // какое значение ещё не потребует согласования. Для SPECIAL_RATE_PER_SQM/FIXED_PRICE
  // эффект действует "наоборот" (чем МЕНЬШЕ величина — тем БОЛЬШЕ скидка), поэтому граница
  // там снизу (min), а не сверху (max). MARKUP скидкой не является — порога не имеет.
  const effectValueThresholdBoundary = useMemo(() => {
    if (finalUnits.length === 0) return null;
    const roleMax = getMaxDiscountPercent(role);
    if (!isFinite(roleMax)) return null; // admin — без ограничения, подсказка не нужна
    const t = roleMax / 100;
    const round2 = (n: number) => Math.round(n * 100) / 100;

    switch (effectType) {
      case 'DISCOUNT_PER_SQM': {
        const perSqmValues = finalUnits.map((u: any) => u.pricePerSqmVAT || (u.price / u.area)).filter((v: number) => v > 0);
        if (perSqmValues.length === 0) return null;
        return { value: round2(t * Math.min(...perSqmValues)), direction: 'max' as const, unit: '$/м²' };
      }
      case 'DISCOUNT_TOTAL': {
        if (effectValueType === 'PERCENT') {
          return { value: Math.round(roleMax * 10) / 10, direction: 'max' as const, unit: '%' };
        }
        const totals = finalUnits.map((u: any) => u.price).filter((v: number) => v > 0);
        if (totals.length === 0) return null;
        return { value: round2(t * Math.min(...totals)), direction: 'max' as const, unit: '$' };
      }
      case 'SPECIAL_RATE_PER_SQM': {
        const perSqmValues = finalUnits.map((u: any) => u.pricePerSqmVAT || (u.price / u.area)).filter((v: number) => v > 0);
        if (perSqmValues.length === 0) return null;
        return { value: round2(Math.max(...perSqmValues) * (1 - t)), direction: 'min' as const, unit: '$/м²' };
      }
      case 'FIXED_PRICE': {
        const totals = finalUnits.map((u: any) => u.price).filter((v: number) => v > 0);
        if (totals.length === 0) return null;
        return { value: round2(Math.max(...totals) * (1 - t)), direction: 'min' as const, unit: '$' };
      }
      default:
        return null; // MARKUP — не скидка, порог не применяется
    }
  }, [finalUnits, effectType, effectValueType, role]);

  function resetConstructor() {
    setEditingId(null);
    setFilterProjectId('');
    setFilterBlockId('');
    setFilterFloorFrom('');
    setFilterFloorTo('');
    setFilterAreaMin('');
    setFilterAreaMax('');
    setFilterType('');
    setFilterRooms('');
    setPreviewUnits([]);
    setExcludedIds(new Set());
    setListFinalized(false);
    setPromoName('');
    setEffectType('DISCOUNT_PER_SQM');
    setEffectValueType('PERCENT');
    setEffectValue(0);
    setNbgRate(2.7);
    setStartAt('');
    setEndAt('');
    setTotalLimit('');
    setPerClientLimit('');
    setPerUnitLimit('');
  }

  async function handleRunFilter() {
    setLoading(true);
    try {
      const units = await getFilteredUnitsForPromotion({
        organizationId,
        projectId: filterProjectId || undefined,
        blockId: filterBlockId || undefined,
        floorFrom: filterFloorFrom ? Number(filterFloorFrom) : undefined,
        floorTo: filterFloorTo ? Number(filterFloorTo) : undefined,
        areaMin: filterAreaMin ? Number(filterAreaMin) : undefined,
        areaMax: filterAreaMax ? Number(filterAreaMax) : undefined,
        type: filterType || undefined,
        rooms: filterRooms ? Number(filterRooms) : undefined,
      });
      setPreviewUnits(units);
      setExcludedIds(new Set());
      setListFinalized(false);
    } finally {
      setLoading(false);
    }
  }

  function toggleExclude(unitId: string) {
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }

  async function handleEditPromotion(promo: any) {
    setLoading(true);
    try {
      const detail = await getPromotionDetail(promo.id);
      if (!detail) return;
      setEditingId(promo.id);
      setPromoName(detail.name);
      setEffectType(detail.effectType);
      setEffectValueType(detail.effectValueType);
      setEffectValue(detail.effectValue);
      setNbgRate(detail.nbgRate);
      setStartAt(toDatetimeLocal(detail.startAt));
      setEndAt(toDatetimeLocal(detail.endAt));
      setTotalLimit(detail.totalLimit != null ? String(detail.totalLimit) : '');
      setPerClientLimit(detail.perClientLimit != null ? String(detail.perClientLimit) : '');
      setPerUnitLimit(detail.perUnitLimit != null ? String(detail.perUnitLimit) : '');
      setPreviewUnits(detail.units || []);
      setExcludedIds(new Set());
      setListFinalized(true);
      setShowConstructor(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDraft() {
    if (!promoName || !startAt || !endAt || finalUnits.length === 0) {
      alert('Заполните название, период и убедитесь, что список помещений не пуст.');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        name: promoName,
        effectType,
        effectValueType,
        effectValue,
        nbgRate,
        startAt: toLocalTZISOString(startAt),
        endAt: toLocalTZISOString(endAt),
        unitIds: finalUnits.map(u => u.id),
        organizationId,
        totalLimit: totalLimit ? Number(totalLimit) : null,
        perClientLimit: perClientLimit ? Number(perClientLimit) : null,
        perUnitLimit: perUnitLimit ? Number(perUnitLimit) : null,
      };
      const res = editingId
        ? await updatePromotionDraft({ ...payload, promotionId: editingId })
        : await createPromotionDraft({ ...payload, createdById: managerId });

      if (res.success) {
        alert(editingId ? 'Акция обновлена.' : 'Черновик акции сохранён.');
        setShowConstructor(false);
        resetConstructor();
        router.refresh();
      } else {
        alert('Ошибка: ' + (res.error || ''));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(id: string) {
    if (!confirm('Согласовать акцию? Она сразу станет доступна и начнёт действовать с указанной даты/времени начала.')) return;
    setLoading(true);
    const res = await approvePromotion(id, managerId, organizationId);
    setLoading(false);
    if (res.success) router.refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  async function handleCancel(id: string) {
    if (!confirm('Отменить акцию?')) return;
    setLoading(true);
    const res = await cancelPromotion(id, organizationId);
    setLoading(false);
    if (res.success) router.refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  async function handleDelete(id: string) {
    if (!confirm('Удалить черновик безвозвратно?')) return;
    setLoading(true);
    const res = await deletePromotion(id, organizationId);
    setLoading(false);
    if (res.success) router.refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  // ── МИЦ ──────────────────────────────────────────────────────────────────
  const [micProjectId, setMicProjectId] = useState('');
  const [micBlockId, setMicBlockId] = useState('');
  const [micRooms, setMicRooms] = useState('ALL');
  const [micChangeType, setMicChangeType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [micChangeValue, setMicChangeValue] = useState(0);
  const [micReason, setMicReason] = useState('');
  const micProject = projects.find((p: any) => p.id === micProjectId);

  async function handleMassUpdate() {
    if (!micProjectId || !micReason) {
      alert('Выберите ЖК и укажите причину изменения.');
      return;
    }
    setLoading(true);
    try {
      const res = await massUpdatePrices({
        projectId: micProjectId,
        blockId: micBlockId || undefined,
        rooms: micRooms !== 'ALL' ? micRooms : undefined,
        changeType: micChangeType,
        changeValue: micChangeValue,
        reason: micReason,
        organizationId,
        initiatorId: managerId,
      });
      if (res.success) {
        alert('Массовое изменение цен успешно выполнено!');
        setMicChangeValue(0);
        setMicReason('');
      } else {
        alert('Ошибка: ' + (res.error || ''));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Ценообразование</h1>
          <p className={styles.subtitle}>Акции и массовое изменение цен на помещения</p>
        </div>
        {activeTab === 'promotions' && canCreate && (
          <button className={styles.primaryBtn} onClick={() => { resetConstructor(); setShowConstructor(true); }}>
            + Создать акцию
          </button>
        )}
      </div>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${activeTab === 'promotions' ? styles.tabActive : ''}`} onClick={() => setActiveTab('promotions')}>Акции</button>
        <button className={`${styles.tab} ${activeTab === 'mic' ? styles.tabActive : ''}`} onClick={() => setActiveTab('mic')}>Массовое изменение цен</button>
        <button className={`${styles.tab} ${activeTab === 'loyalty' ? styles.tabActive : ''}`} onClick={() => setActiveTab('loyalty')}>Накопительные скидки</button>
        <button className={`${styles.tab} ${activeTab === 'analytics' ? styles.tabActive : ''}`} onClick={() => setActiveTab('analytics')}>Аналитика акций</button>
      </div>

      {activeTab === 'promotions' && (
        promotions.length === 0 ? (
          <div className={styles.emptyState}>Акций пока нет.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Название</th>
                <th>Эффект</th>
                <th>Период</th>
                <th>Помещений</th>
                <th>Статус</th>
                <th>Создал</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((p: any) => {
                const displayStatus = computeDisplayStatus(p.status, p.startAt, p.endAt);
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 700 }}>{p.name}</td>
                    <td>{EFFECT_TYPE_LABELS[p.effectType as PromotionEffectType]}: {formatEffectSummary({ effectType: p.effectType, effectValueType: p.effectValueType, effectValue: p.effectValue })}</td>
                    <td style={{ fontSize: '0.78rem' }}>{mounted ? `${formatGeorgiaDateTime(p.startAt)} — ${formatGeorgiaDateTime(p.endAt)}` : '…'}</td>
                    <td>{p.unitsCount}</td>
                    <td><span className={`${styles.badge} ${(styles as any)[STATUS_BADGE_CLASS[displayStatus]]}`}>{STATUS_LABELS[displayStatus]}</span></td>
                    <td style={{ fontSize: '0.78rem', color: '#64748b' }}>{p.createdByName || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        {p.status === 'DRAFT' && canApprove && (
                          <button className={styles.successBtn} onClick={() => handleApprove(p.id)} disabled={loading}>Согласовать</button>
                        )}
                        {canApprove && p.status !== 'CANCELLED' && (
                          <button className={styles.secondaryBtn} onClick={() => handleEditPromotion(p)} disabled={loading}>Редактировать</button>
                        )}
                        {canApprove && p.status === 'DRAFT' && (
                          <button className={styles.dangerBtn} onClick={() => handleDelete(p.id)} disabled={loading}>Удалить</button>
                        )}
                        {canApprove && p.status === 'ACTIVE' && (
                          <button className={styles.dangerBtn} onClick={() => handleCancel(p.id)} disabled={loading}>Отменить</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}

      {activeTab === 'mic' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', maxWidth: '760px' }}>
          {!canMic ? (
            <p style={{ color: '#94a3b8' }}>У вашей роли нет доступа к массовому изменению цен.</p>
          ) : (
            <>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>ЖК *</label>
                  <select className={styles.input} value={micProjectId} onChange={e => { setMicProjectId(e.target.value); setMicBlockId(''); }}>
                    <option value="">— Выберите ЖК —</option>
                    {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Корпус</label>
                  <select className={styles.input} value={micBlockId} onChange={e => setMicBlockId(e.target.value)}>
                    <option value="">Все корпуса</option>
                    {micProject?.blocks?.map((b: any) => <option key={b.id} value={b.id}>{b.number}</option>)}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Комнатность</label>
                  <select className={styles.input} value={micRooms} onChange={e => setMicRooms(e.target.value)}>
                    <option value="ALL">Все</option>
                    <option value="1">1-комнатные</option>
                    <option value="2">2-комнатные</option>
                    <option value="3">3-комнатные</option>
                  </select>
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Тип изменения</label>
                  <select className={styles.input} value={micChangeType} onChange={e => setMicChangeType(e.target.value as any)}>
                    <option value="PERCENT">В процентах (%)</option>
                    <option value="FIXED">Фиксированная сумма ($)</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Величина</label>
                  <input type="number" className={styles.input} value={micChangeValue} onChange={e => setMicChangeValue(Number(e.target.value))} />
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup} style={{ flex: 3 }}>
                  <label>Причина изменения *</label>
                  <input className={styles.input} value={micReason} onChange={e => setMicReason(e.target.value)} placeholder="Например: Корректировка цен" />
                </div>
              </div>
              <button className={styles.primaryBtn} onClick={handleMassUpdate} disabled={loading || !micReason || !micProjectId}>
                {loading ? '...' : 'Применить'}
              </button>
            </>
          )}
        </div>
      )}

      {activeTab === 'loyalty' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', maxWidth: '760px' }}>
          <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: 0 }}>
            Скидка применяется автоматически по количеству предыдущих покупок клиента (без учёта отменённых сделок, только на самого клиента — связанные лица пока не учитываются).
            Уровней пока нет — ничего не применяется, пока вы не добавите хотя бы один.
          </p>
          {loyaltyTiers.length > 0 && (
            <table className={styles.table} style={{ marginBottom: '16px' }}>
              <thead>
                <tr><th>От какой покупки (включительно)</th><th>Скидка (%)</th><th></th></tr>
              </thead>
              <tbody>
                {loyaltyTiers.map((t: any) => (
                  <tr key={t.id}>
                    <td>{t.minPurchases}-я и далее</td>
                    <td>{t.discountPercent}%</td>
                    <td>
                      {canApprove && (
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button className={styles.secondaryBtn} onClick={() => handleEditLoyaltyTier(t)}>Редактировать</button>
                          <button className={styles.dangerBtn} onClick={() => handleDeleteLoyaltyTier(t.id)}>Удалить</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canApprove && (
            <div className={styles.formRow} style={{ alignItems: 'flex-end' }}>
              <div className={styles.formGroup}>
                <label>От какой по счёту покупки</label>
                <input type="number" min="1" className={styles.input} value={loyaltyMinPurchases} onChange={e => setLoyaltyMinPurchases(Number(e.target.value))} />
              </div>
              <div className={styles.formGroup}>
                <label>Скидка (%)</label>
                <input type="number" step="0.1" className={styles.input} value={loyaltyPercent} onChange={e => setLoyaltyPercent(Number(e.target.value))} />
              </div>
              <button className={styles.primaryBtn} onClick={handleSaveLoyaltyTier} disabled={loading}>
                {editingLoyaltyId ? 'Сохранить изменения' : '+ Добавить уровень'}
              </button>
              {editingLoyaltyId && (
                <button className={styles.secondaryBtn} onClick={() => { setEditingLoyaltyId(null); setLoyaltyMinPurchases(2); setLoyaltyPercent(0); }}>Отмена</button>
              )}
            </div>
          )}
          {!canApprove && loyaltyTiers.length === 0 && (
            <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Уровни ещё не настроены руководителем ОП.</p>
          )}
        </div>
      )}

      {activeTab === 'analytics' && (
        analyticsLoading ? (
          <div className={styles.emptyState}>Загрузка...</div>
        ) : promoAnalytics.length === 0 ? (
          <div className={styles.emptyState}>Акций пока нет.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Название</th>
                <th>Статус</th>
                <th>Помещений</th>
                <th>Сделок (активных / выиграно / отказ-расторжение)</th>
                <th>Лимиты (общий / клиент / объект)</th>
                <th>Сумма скидок</th>
                <th>Выручка по акции</th>
              </tr>
            </thead>
            <tbody>
              {promoAnalytics.map((p: any) => {
                const displayStatus = computeDisplayStatus(p.status, p.startAt, p.endAt);
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 700 }}>{p.name}</td>
                    <td><span className={`${styles.badge} ${(styles as any)[STATUS_BADGE_CLASS[displayStatus]]}`}>{STATUS_LABELS[displayStatus]}</span></td>
                    <td>{p.unitsCount}</td>
                    <td>{p.activeDealsCount} / {p.wonDealsCount} / {p.lostDealsCount}</td>
                    <td style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      {p.totalLimit != null ? `${p.activeDealsCount}/${p.totalLimit}` : '—'} · {p.perClientLimit ?? '—'} · {p.perUnitLimit ?? '—'}
                    </td>
                    <td>${Math.round(Number(p.totalDiscountUSD) || 0).toLocaleString()}</td>
                    <td>${Math.round(Number(p.totalRevenueUSD) || 0).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}

      {/* ── Модалка конструктора акции ─────────────────────────────────────── */}
      {showConstructor && (
        <div className={styles.modalOverlay} onClick={() => setShowConstructor(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>{editingId ? 'Редактирование акции' : 'Новая акция'}</h2>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>Подбор помещений → список → настройки эффекта → период</p>

            {/* Шаг 1: Фильтр */}
            <div className={styles.stepBlock}>
              <div className={styles.stepTitle}>1. Подбор помещений (фильтр)</div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>ЖК</label>
                  <select className={styles.input} value={filterProjectId} onChange={e => { setFilterProjectId(e.target.value); setFilterBlockId(''); }}>
                    <option value="">Любой</option>
                    {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Корпус</label>
                  <select className={styles.input} value={filterBlockId} onChange={e => setFilterBlockId(e.target.value)}>
                    <option value="">Любой</option>
                    {selectedBlock?.blocks?.map((b: any) => <option key={b.id} value={b.id}>{b.number}</option>)}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Тип помещения</label>
                  <select className={styles.input} value={filterType} onChange={e => setFilterType(e.target.value)}>
                    <option value="">Любой</option>
                    <option value="Apartment">Квартира</option>
                    <option value="Commercial">Коммерция</option>
                    <option value="Parking">Паркинг</option>
                    <option value="Storage">Кладовка</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Комнатность</label>
                  <select className={styles.input} value={filterRooms} onChange={e => setFilterRooms(e.target.value)}>
                    <option value="">Любая</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </select>
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Этаж от</label>
                  <input type="number" className={styles.input} value={filterFloorFrom} onChange={e => setFilterFloorFrom(e.target.value)} />
                </div>
                <div className={styles.formGroup}>
                  <label>Этаж до</label>
                  <input type="number" className={styles.input} value={filterFloorTo} onChange={e => setFilterFloorTo(e.target.value)} />
                </div>
                <div className={styles.formGroup}>
                  <label>Площадь от, м²</label>
                  <input type="number" className={styles.input} value={filterAreaMin} onChange={e => setFilterAreaMin(e.target.value)} />
                </div>
                <div className={styles.formGroup}>
                  <label>Площадь до, м²</label>
                  <input type="number" className={styles.input} value={filterAreaMax} onChange={e => setFilterAreaMax(e.target.value)} />
                </div>
              </div>
              <button className={styles.secondaryBtn} onClick={handleRunFilter} disabled={loading}>
                {loading ? 'Подбираю...' : 'Подобрать помещения'}
              </button>
              <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '6px' }}>
                Помещение может входить в несколько акций с пересекающимися периодами — скидки не суммируются,
                действует та акция, что началась раньше, и до конца именно её периода.
              </p>
            </div>

            {/* Шаг 2: Список и исключения */}
            {previewUnits.length > 0 && (
              <div className={styles.stepBlock}>
                <div className={styles.stepTitle}>2. Список помещений ({finalUnits.length} из {previewUnits.length})</div>
                <div className={styles.previewTableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr><th></th><th>Помещение</th><th>Этаж</th><th>Площадь</th><th>Цена</th><th></th></tr>
                    </thead>
                    <tbody>
                      {previewUnits.map((u: any) => {
                        const excluded = excludedIds.has(u.id);
                        return (
                          <tr key={u.id} style={excluded ? { opacity: 0.4, textDecoration: 'line-through' } : undefined}>
                            <td>{u.projectName}, {u.blockNumber}</td>
                            <td>№{u.number}</td>
                            <td>{u.floor}</td>
                            <td>{u.area} м²</td>
                            <td>${Number(u.price).toLocaleString()}</td>
                            <td>
                              <button className={styles.secondaryBtn} onClick={() => toggleExclude(u.id)}>
                                {excluded ? 'Вернуть' : 'Исключить'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Шаг 3: Настройки эффекта */}
            {finalUnits.length > 0 && (
              <div className={styles.stepBlock}>
                <div className={styles.stepTitle}>3. Настройки акции (ценовой эффект)</div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup} style={{ flex: 2 }}>
                    <label>Название акции *</label>
                    <input className={styles.input} value={promoName} onChange={e => setPromoName(e.target.value)} placeholder="Например: Летняя распродажа" />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Курс НБГ (₾/$)</label>
                    <input type="number" step="0.0001" className={styles.input} value={nbgRate} onChange={e => setNbgRate(Number(e.target.value))} />
                  </div>
                </div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Тип эффекта</label>
                    <select className={styles.input} value={effectType} onChange={e => setEffectType(e.target.value as PromotionEffectType)}>
                      {Object.entries(EFFECT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  {(effectType === 'DISCOUNT_TOTAL' || effectType === 'MARKUP') && (
                    <div className={styles.formGroup}>
                      <label>Единица</label>
                      <select className={styles.input} value={effectValueType} onChange={e => setEffectValueType(e.target.value as PromotionEffectValueType)}>
                        <option value="PERCENT">%</option>
                        <option value="AMOUNT">Сумма ($)</option>
                      </select>
                    </div>
                  )}
                  <div className={styles.formGroup}>
                    <label>
                      {effectType === 'DISCOUNT_PER_SQM' && 'Скидка за м² ($)'}
                      {effectType === 'DISCOUNT_TOTAL' && (effectValueType === 'PERCENT' ? 'Скидка (%)' : 'Скидка ($)')}
                      {effectType === 'SPECIAL_RATE_PER_SQM' && 'Спецтариф ($/м²)'}
                      {effectType === 'MARKUP' && (effectValueType === 'PERCENT' ? 'Наценка (%)' : 'Наценка ($)')}
                      {effectType === 'FIXED_PRICE' && 'Фиксированная цена ($)'}
                    </label>
                    <input
                      type="number"
                      className={styles.input}
                      value={effectValue}
                      onChange={e => setEffectValue(Number(e.target.value))}
                      {...(effectValueThresholdBoundary?.direction === 'max' ? { max: effectValueThresholdBoundary.value } : {})}
                      {...(effectValueThresholdBoundary?.direction === 'min' ? { min: effectValueThresholdBoundary.value } : {})}
                    />
                    {effectValueThresholdBoundary && (
                      <p style={{ fontSize: '0.7rem', color: '#94a3b8', margin: '4px 0 0' }}>
                        {effectValueThresholdBoundary.direction === 'max'
                          ? `Вы можете создать черновик до ${getMaxDiscountPercent(role)}% или ${effectValueThresholdBoundary.value}${effectValueThresholdBoundary.unit}.`
                          : `Вы можете создать черновик до ${getMaxDiscountPercent(role)}% или ${effectValueThresholdBoundary.value}${effectValueThresholdBoundary.unit}.`}
                      </p>
                    )}
                  </div>
                </div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Начало акции (дата и время)</label>
                    <input type="datetime-local" className={styles.input} value={startAt} onChange={e => setStartAt(e.target.value)} />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Окончание акции (дата и время)</label>
                    <input type="datetime-local" className={styles.input} value={endAt} onChange={e => setEndAt(e.target.value)} />
                  </div>
                </div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Общий лимит применений</label>
                    <input type="number" min="1" className={styles.input} placeholder="Без ограничения" value={totalLimit} onChange={e => setTotalLimit(e.target.value)} />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Лимит на клиента</label>
                    <input type="number" min="1" className={styles.input} placeholder="Без ограничения" value={perClientLimit} onChange={e => setPerClientLimit(e.target.value)} />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Лимит на объект</label>
                    <input type="number" min="1" className={styles.input} placeholder="Без ограничения" value={perUnitLimit} onChange={e => setPerUnitLimit(e.target.value)} />
                  </div>
                </div>
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px' }}>
                  Лимиты считаются по количеству сделок, к которым фактически применена акция (расторгнутые и отказные не считаются). Оставьте поле пустым, если ограничение не нужно.
                </p>
                {maxPromoDiscountPercent > 0 && (
                  <div style={{
                    marginTop: '10px', padding: '8px 12px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600,
                    background: promoDiscountAllowed ? '#f0fdf4' : '#fef2f2',
                    color: promoDiscountAllowed ? '#166534' : '#dc2626',
                    border: `1px solid ${promoDiscountAllowed ? '#bbf7d0' : '#fecaca'}`
                  }}>
                    Максимальная скидка по акции (среди помещений списка): {maxPromoDiscountPercent}%{promoDiscountAllowed
                      ? ' — вы можете сохранить черновик.'
                      : ` — превышает ваш порог (до ${getMaxDiscountPercent(role)}%). Создать акцию такого размера может только ${getRequiredApproverLabel(maxPromoDiscountPercent)}.`}
                  </div>
                )}
              </div>
            )}

            <div className={styles.modalFooter}>
              <button className={styles.secondaryBtn} onClick={() => { setShowConstructor(false); resetConstructor(); }}>Отмена</button>
              <button className={styles.primaryBtn} onClick={handleSaveDraft} disabled={loading || finalUnits.length === 0 || !promoDiscountAllowed}>
                {loading ? 'Сохранение...' : editingId ? 'Сохранить изменения' : 'Сохранить как черновик'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}