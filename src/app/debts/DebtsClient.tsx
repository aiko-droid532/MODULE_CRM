'use client';

import { useState, useEffect, useMemo } from 'react';
import styles from './Debts.module.css';
import {
  confirmDebtPayment,
  applyDebtExemption,
  createExemptionReason,
  setExemptionReasonActive,
  updateGracePeriodDays,
  getDebtRegistry,
  getExemptionReasons,
  getDebtAuditSample,
} from '@/app/actions/debts';
import { DEBT_STATUS_LABELS, DebtRowStatus } from '@/lib/debtStatus';
import { getExchangeRate } from '@/app/actions/exchange';
import { canViewAllDeals, UserRole } from '@/lib/roles';
import * as XLSX from 'xlsx';

interface DebtsClientProps {
  initialRegistry: any[];
  initialReasons: any[];
  initialGracePeriodDays: number;
  initialAuditSample: any[];
  organizationId: string;
  userRole: string;
  managerId: string;
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  OVERDUE: 'badgeOverdue',
  PARTIALLY_PAID: 'badgePartial',
  EXEMPTED: 'badgeExempted',
  CONTRACT_CANCELLED_UNPAID: 'badgeCancelled',
};

function formatDateRu(d: string | Date) {
  return new Date(d).toLocaleDateString('ru-RU');
}

export default function DebtsClient({
  initialRegistry,
  initialReasons,
  initialGracePeriodDays,
  initialAuditSample,
  organizationId,
  userRole,
  managerId,
}: DebtsClientProps) {
  const role = userRole as UserRole;
  const isAdminOrRop = role === 'admin' || role === 'rop';
  const seeAll = canViewAllDeals(role);

  const [registry, setRegistry] = useState<any[]>(initialRegistry);
  const [reasons, setReasons] = useState<any[]>(initialReasons);
  const [gracePeriodDays, setGracePeriodDays] = useState(initialGracePeriodDays);
  const [exchangeRate, setExchangeRate] = useState(2.7);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getExchangeRate().then(r => { if (r) setExchangeRate(r); });
  }, []);

  async function refresh() {
    const rows = await getDebtRegistry(organizationId);
    setRegistry(rows);
  }

  // ── Фильтры ──────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [minDaysOverdue, setMinDaysOverdue] = useState('');

  const filteredRegistry = useMemo(() => {
    return registry.filter(r => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (minDaysOverdue && r.daysOverdue < Number(minDaysOverdue)) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.clientName || ''} ${r.clientPhone || ''} ${r.unitNumber || ''} ${r.projectName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [registry, statusFilter, search, minDaysOverdue]);

  const totalDebtUSD = filteredRegistry
    .filter(r => r.status === 'OVERDUE' || r.status === 'PARTIALLY_PAID')
    .reduce((sum, r) => sum + r.debtAmount, 0);

  // ── Экспорт реестра (FR-CD-07/23) — учитывает применённые фильтры ──────────
  function buildExportRows() {
    return filteredRegistry.map(r => ({
      'Клиент': r.clientName || '—',
      'Телефон': r.clientPhone || '—',
      'Объект': r.projectName ? `${r.projectName}, №${r.unitNumber}` : '—',
      'Плановая дата': formatDateRu(r.dueDate),
      'Сумма долга (USD)': r.debtAmount,
      'Сумма долга (GEL)': Math.round(r.debtAmount * exchangeRate),
      'Дней просрочки': r.daysOverdue || 0,
      'Статус': DEBT_STATUS_LABELS[r.status as DebtRowStatus],
      'Причина освобождения': r.exemptionReasonLabel || '',
      'Ответственный менеджер': r.managerId || '',
    }));
  }

  function handleExportExcel() {
    const rows = buildExportRows();
    if (rows.length === 0) {
      alert('Нет данных для выгрузки по текущим фильтрам.');
      return;
    }
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const colWidths = Object.keys(rows[0]).map(key => {
      const maxLen = rows.reduce((max, row) => Math.max(max, String((row as any)[key] ?? '').length), key.length);
      return { wch: maxLen + 4 };
    });
    (worksheet as any)['!cols'] = colWidths;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Реестр задолженности');
    XLSX.writeFile(workbook, `Реестр_задолженности_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function handleExportPdf() {
    const rows = buildExportRows();
    if (rows.length === 0) {
      alert('Нет данных для выгрузки по текущим фильтрам.');
      return;
    }
    const headers = Object.keys(rows[0]);
    const tableHtml = `
      <div style="font-family: Arial, sans-serif; padding: 10px;">
        <h2 style="margin: 0 0 4px;">Реестр задолженности</h2>
        <p style="margin: 0 0 16px; color: #64748b; font-size: 12px;">Сформировано: ${new Date().toLocaleString('ru-RU')} · записей: ${rows.length}</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
          <thead>
            <tr>${headers.map(h => `<th style="border: 1px solid #cbd5e1; padding: 6px 8px; background: #f1f5f9; text-align: left;">${h}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows.map(r => `<tr>${headers.map(h => `<td style="border: 1px solid #e2e8f0; padding: 6px 8px;">${(r as any)[h]}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;

    const opt = {
      margin: 10,
      filename: `Реестр_задолженности_${new Date().toISOString().slice(0, 10)}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' },
    };

    const runHtml2pdf = () => {
      const element = document.createElement('div');
      element.innerHTML = tableHtml;
      // @ts-ignore
      window.html2pdf().from(element).set(opt).save();
    };

    // @ts-ignore
    if (window.html2pdf) {
      runHtml2pdf();
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      script.onload = () => runHtml2pdf();
      document.body.appendChild(script);
    }
  }

  // ── Модалка подтверждения оплаты ────────────────────────────────────────
  const [confirmRow, setConfirmRow] = useState<any>(null);
  const [confirmAmount, setConfirmAmount] = useState('');
  const [confirmDate, setConfirmDate] = useState(new Date().toISOString().slice(0, 10));
  const [confirmBasis, setConfirmBasis] = useState('');
  const [saving, setSaving] = useState(false);

  function openConfirmModal(row: any) {
    setConfirmRow(row);
    setConfirmAmount(String(row.debtAmount));
    setConfirmBasis('');
    setConfirmDate(new Date().toISOString().slice(0, 10));
  }

  async function handleConfirmPayment() {
    if (!confirmRow) return;
    setSaving(true);
    const res = await confirmDebtPayment({
      scheduleId: confirmRow.scheduleId,
      dealId: confirmRow.dealId,
      amount: Number(confirmAmount),
      paymentDate: confirmDate,
      basis: confirmBasis,
      organizationId,
    });
    setSaving(false);
    if (res.success) {
      setConfirmRow(null);
      await refresh();
    } else {
      alert('Ошибка: ' + (res.error || 'не удалось подтвердить оплату'));
    }
  }

  // ── Модалка освобождения от долга ───────────────────────────────────────
  const [exemptRow, setExemptRow] = useState<any>(null);
  const [exemptReasonId, setExemptReasonId] = useState('');
  const [exemptComment, setExemptComment] = useState('');

  function openExemptModal(row: any) {
    setExemptRow(row);
    setExemptReasonId(reasons[0]?.id || '');
    setExemptComment('');
  }

  async function handleApplyExemption() {
    if (!exemptRow) return;
    setSaving(true);
    const res = await applyDebtExemption({
      scheduleId: exemptRow.scheduleId,
      dealId: exemptRow.dealId,
      reasonId: exemptReasonId,
      comment: exemptComment,
      organizationId,
    });
    setSaving(false);
    if (res.success) {
      setExemptRow(null);
      await refresh();
    } else {
      alert('Ошибка: ' + (res.error || 'не удалось применить причину освобождения'));
    }
  }

  // ── Панель настроек (админ/РОП): справочник причин + льготный период ───
  const [showSettings, setShowSettings] = useState(false);
  const [newReasonLabel, setNewReasonLabel] = useState('');
  const [graceInput, setGraceInput] = useState(String(initialGracePeriodDays));

  // ── Отчёт-выборка для РОП/админа (FR-CD-18, UC-5) ───────────────────────
  const [showAuditSample, setShowAuditSample] = useState(false);
  const [auditSample, setAuditSample] = useState<any[]>(initialAuditSample);

  async function refreshAuditSample() {
    const rows = await getDebtAuditSample(organizationId);
    setAuditSample(rows);
  }

  async function handleAddReason() {
    if (!newReasonLabel.trim()) return;
    const res = await createExemptionReason(organizationId, newReasonLabel.trim());
    if (res.success) {
      setNewReasonLabel('');
      const list = await getExemptionReasons(organizationId, true);
      setReasons(list);
    } else {
      alert('Ошибка: ' + (res.error || ''));
    }
  }

  async function handleToggleReason(id: string, active: boolean) {
    await setExemptionReasonActive(id, active);
    const list = await getExemptionReasons(organizationId, true);
    setReasons(list);
  }

  async function handleSaveGracePeriod() {
    const days = Number(graceInput);
    if (!days || days < 0) return;
    const res = await updateGracePeriodDays(organizationId, days);
    if (res.success) {
      setGracePeriodDays(days);
    } else {
      alert('Ошибка: ' + (res.error || ''));
    }
  }

  const canAct = (row: any) => role === 'admin' || row.managerId === managerId;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <h1>Реестр задолженности</h1>
          <p className={styles.subtitle}>Просроченные и частично оплаченные платежи по графику договоров · льготный период {gracePeriodDays} дн.</p>
        </div>
        <div className={styles.actionsPanel}>
          <button className={styles.btnSecondary} onClick={handleExportExcel}>Экспорт в Excel</button>
          <button className={styles.btnSecondary} onClick={handleExportPdf}>Экспорт в PDF</button>
          {isAdminOrRop && (
            <button className={styles.btnSecondary} onClick={async () => { await refreshAuditSample(); setShowAuditSample(true); }}>Отчёт-выборка</button>
          )}
          {isAdminOrRop && (
            <button className={styles.btnSecondary} onClick={() => setShowSettings(true)}>Настройки</button>
          )}
        </div>
      </header>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Записей в реестре</span>
          <div className={styles.statValue}>{filteredRegistry.length}</div>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Активный долг (USD)</span>
          <div className={styles.statValue}>${totalDebtUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Активный долг (GEL)</span>
          <div className={styles.statValue}>{Math.round(totalDebtUSD * exchangeRate).toLocaleString()} ₾</div>
        </div>
      </div>

      <div className={styles.filterBar}>
        <input
          className={styles.filterInput}
          placeholder="Поиск: клиент, телефон, объект..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: '220px' }}
        />
        <select className={styles.filterSelect} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="ALL">Все статусы</option>
          <option value="OVERDUE">{DEBT_STATUS_LABELS.OVERDUE}</option>
          <option value="PARTIALLY_PAID">{DEBT_STATUS_LABELS.PARTIALLY_PAID}</option>
          <option value="EXEMPTED">{DEBT_STATUS_LABELS.EXEMPTED}</option>
          <option value="CONTRACT_CANCELLED_UNPAID">{DEBT_STATUS_LABELS.CONTRACT_CANCELLED_UNPAID}</option>
        </select>
        <input
          className={styles.filterInput}
          type="number"
          placeholder="Мин. дней просрочки"
          value={minDaysOverdue}
          onChange={e => setMinDaysOverdue(e.target.value)}
          style={{ width: '160px' }}
        />
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Клиент</th>
              <th>Объект</th>
              <th>Плановая дата</th>
              <th>Сумма долга</th>
              <th>Дней просрочки</th>
              <th>Статус</th>
              {seeAll && <th>Менеджер</th>}
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {filteredRegistry.map(row => (
              <tr key={row.scheduleId}>
                <td>
                  <div style={{ fontWeight: 700 }}>{row.clientName || '—'}</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{row.clientPhone || ''}</div>
                </td>
                <td>{row.projectName ? `${row.projectName}, №${row.unitNumber}` : '—'}</td>
                <td>{formatDateRu(row.dueDate)}</td>
                <td>
                  <div style={{ fontWeight: 700 }}>${row.debtAmount.toLocaleString()}</div>
                  {row.paidAmount > 0 && (
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>из ${row.amount.toLocaleString()}, оплачено ${row.paidAmount.toLocaleString()}</div>
                  )}
                </td>
                <td>{row.daysOverdue > 0 ? `${row.daysOverdue} дн.` : '—'}</td>
                <td>
                  <span className={`${styles.badge} ${(styles as any)[STATUS_BADGE_CLASS[row.status]] || ''}`}>
                    {DEBT_STATUS_LABELS[row.status as DebtRowStatus]}
                  </span>
                  {row.status === 'EXEMPTED' && row.exemptionReasonLabel && (
                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>{row.exemptionReasonLabel}</div>
                  )}
                </td>
                {seeAll && <td>{row.managerId}</td>}
                <td style={{ whiteSpace: 'nowrap' }}>
                  {(row.status === 'OVERDUE' || row.status === 'PARTIALLY_PAID') && canAct(row) && (
                    <>
                      <button className={styles.actionBtn} onClick={() => openConfirmModal(row)}>Подтвердить оплату</button>
                      <button className={styles.actionBtnSecondary} onClick={() => openExemptModal(row)}>Освободить</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {filteredRegistry.length === 0 && (
              <tr>
                <td colSpan={seeAll ? 8 : 7}>
                  <div className={styles.emptyState}>Задолженностей, подходящих под фильтры, не найдено.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Модалка подтверждения оплаты */}
      {confirmRow && (
        <div className={styles.modalOverlay} onClick={() => setConfirmRow(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Подтверждение оплаты</h2>
            <div className={styles.formGroup}>
              <label>Клиент</label>
              <div>{confirmRow.clientName} · {confirmRow.projectName}, №{confirmRow.unitNumber}</div>
            </div>
            <div className={styles.formGroup}>
              <label>Сумма оплаты (USD)</label>
              <input className={styles.input} type="number" value={confirmAmount} onChange={e => setConfirmAmount(e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Фактическая дата оплаты</label>
              <input className={styles.input} type="date" value={confirmDate} onChange={e => setConfirmDate(e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Основание (номер платежа, ссылка на квитанцию/скриншот) *</label>
              <input className={styles.input} value={confirmBasis} onChange={e => setConfirmBasis(e.target.value)} />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setConfirmRow(null)}>Отмена</button>
              <button className={styles.modalSaveBtn} disabled={saving || !confirmBasis.trim() || !confirmAmount} onClick={handleConfirmPayment}>
                {saving ? 'Сохранение...' : 'Подтвердить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка освобождения от долга */}
      {exemptRow && (
        <div className={styles.modalOverlay} onClick={() => setExemptRow(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Освобождение от статуса «Просрочена»</h2>
            <div className={styles.formGroup}>
              <label>Клиент</label>
              <div>{exemptRow.clientName} · {exemptRow.projectName}, №{exemptRow.unitNumber}</div>
            </div>
            <div className={styles.formGroup}>
              <label>Причина освобождения *</label>
              <select className={styles.input} value={exemptReasonId} onChange={e => setExemptReasonId(e.target.value)}>
                {reasons.length === 0 && <option value="">Справочник причин пуст</option>}
                {reasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Комментарий *</label>
              <input className={styles.input} value={exemptComment} onChange={e => setExemptComment(e.target.value)} />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setExemptRow(null)}>Отмена</button>
              <button className={styles.modalSaveBtn} disabled={saving || !exemptReasonId || !exemptComment.trim()} onClick={handleApplyExemption}>
                {saving ? 'Сохранение...' : 'Применить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Панель настроек: справочник причин + льготный период (админ/РОП) */}
      {showSettings && (
        <div className={styles.modalOverlay} onClick={() => setShowSettings(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Настройки реестра задолженности</h2>
            <div className={styles.formGroup}>
              <label>Льготный период по умолчанию (дней)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input className={styles.input} type="number" value={graceInput} onChange={e => setGraceInput(e.target.value)} style={{ flex: 1 }} />
                <button className={styles.modalSaveBtn} onClick={handleSaveGracePeriod}>Сохранить</button>
              </div>
            </div>
            <div className={styles.formGroup}>
              <label>Справочник причин освобождения от долга</label>
              <div className={styles.reasonsPanel}>
                {reasons.map(r => (
                  <div key={r.id} className={styles.reasonRow}>
                    <span style={{ opacity: r.active ? 1 : 0.5 }}>{r.label}</span>
                    <button className={styles.actionBtnSecondary} onClick={() => handleToggleReason(r.id, !r.active)}>
                      {r.active ? 'Скрыть' : 'Включить'}
                    </button>
                  </div>
                ))}
                {reasons.length === 0 && <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Причин пока нет.</div>}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <input className={styles.input} placeholder="Новая причина..." value={newReasonLabel} onChange={e => setNewReasonLabel(e.target.value)} style={{ flex: 1 }} />
                <button className={styles.modalSaveBtn} onClick={handleAddReason}>Добавить</button>
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setShowSettings(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {/* Отчёт-выборка для РОП/админа (FR-CD-18, UC-5) */}
      {showAuditSample && (
        <div className={styles.modalOverlay} onClick={() => setShowAuditSample(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: '760px' }}>
            <h2>Отчёт-выборка: подтверждения оплаты и освобождения</h2>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '-10px', marginBottom: '14px' }}>
              Последние {auditSample.length} действий менеджеров по отделу — для выборочной проверки обоснованности.
            </p>
            <div style={{ maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {auditSample.map(item => (
                <div key={item.id} style={{ border: '1px solid #f1f5f9', borderRadius: '10px', padding: '10px 14px', background: '#f8fafc' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                    <span style={{ fontWeight: 700, color: item.type === 'CONFIRMED' ? '#059669' : '#0369a1' }}>
                      {item.type === 'CONFIRMED' ? 'Подтверждение оплаты' : 'Освобождение от долга'}
                    </span>
                    <span style={{ color: '#94a3b8' }}>{new Date(item.createdAt).toLocaleString('ru-RU')}</span>
                  </div>
                  <div style={{ fontSize: '0.82rem', marginTop: '4px' }}>
                    Менеджер: <strong>{item.managerName}</strong> · {item.clientName || '—'}{item.projectName ? ` · ${item.projectName}, №${item.unitNumber}` : ''}
                  </div>
                  {item.type === 'CONFIRMED' ? (
                    <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '2px' }}>
                      Оплачено: ${item.oldValue} → ${item.newValue} · Основание: {item.reason || '—'}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '2px' }}>
                      Причина: {item.exemptionReasonLabel || '—'} · Комментарий: {item.reason || '—'}
                    </div>
                  )}
                </div>
              ))}
              {auditSample.length === 0 && (
                <div style={{ color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center', padding: '30px 0' }}>Действий пока не зафиксировано.</div>
              )}
            </div>
            <div className={styles.modalActions}>
              <button className={styles.actionBtnSecondary} onClick={refreshAuditSample}>Обновить</button>
              <button className={styles.modalCancelBtn} onClick={() => setShowAuditSample(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
