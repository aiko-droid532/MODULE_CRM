'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import styles from './Finance.module.css';
import { 
  syncTBCBankAPIAction, 
  importBankStatementAction, 
  manuallyMatchTransactionAction, 
  unmatchTransactionAction 
} from '@/app/actions/finance';

import { canViewAllFinance, canManageFinance, isReadOnly, UserRole } from '@/lib/roles';

interface FinanceClientProps {
  initialTransactions: any[];
  initialSchedules: any[];
  // Отделы (Ролевая модель, фаза 1): null — без ограничений, массив — РОП видит
  // только данные сотрудников своих отделов (см. пояснение в DealsClientProps).
  visibleManagerIds?: string[] | null;
  organizationId: string;
  userRole?: string;
  managerId?: string;
}

export default function FinanceClient({
  initialTransactions,
  initialSchedules,
  visibleManagerIds = null,
  organizationId,
  userRole = 'manager',
  managerId = ''
}: FinanceClientProps) {
  const role = userRole as UserRole;
  const canViewAll = canViewAllFinance(role);
  const canManage = canManageFinance(role);
  const readOnly = isReadOnly(role);

  // Менеджер видит только транзакции и платежи по своим договорам.
  // РОП с отделами — только по сотрудникам своего отдела.
  const roleFilteredTransactions = canViewAll
    ? (visibleManagerIds ? initialTransactions.filter(t => visibleManagerIds.includes(t.managerId) || !t.managerId) : initialTransactions)
    : initialTransactions.filter(t => t.managerId === managerId || !t.managerId);
  const roleFilteredSchedules = canViewAll
    ? (visibleManagerIds ? initialSchedules.filter(s => visibleManagerIds.includes(s.managerId) || !s.managerId) : initialSchedules)
    : initialSchedules.filter(s => s.managerId === managerId || !s.managerId);

  const [transactions, setTransactions] = useState(roleFilteredTransactions);
  const [schedules, setSchedules] = useState(roleFilteredSchedules);
  
  const [activeTab, setActiveTab] = useState<'statement' | 'schedule'>('statement');
  const [searchQuery, setSearchQuery] = useState('');
  const [txFilter, setTxFilter] = useState<'ALL' | 'MATCHED' | 'UNMATCHED'>('ALL');
  const [scheduleFilter, setScheduleFilter] = useState<'ALL' | 'PENDING' | 'OVERDUE'>('ALL');

  // Loading States
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  // Modal States
  const [matchingTx, setMatchingTx] = useState<any | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [submittingMatch, setSubmittingMatch] = useState(false);

  const router = useRouter();

  // 1. Расчет статистики оплат
  const stats = useMemo(() => {
    const totalCount = transactions.length;
    const matched = transactions.filter(t => t.status === 'MATCHED');
    const matchedCount = matched.length;
    const unmatchedCount = totalCount - matchedCount;
    const matchRate = totalCount > 0 ? Math.round((matchedCount / totalCount) * 100) : 0;
    const totalAmount = matched.reduce((sum, t) => sum + (t.amount || 0), 0);

    return {
      totalCount,
      matchedCount,
      unmatchedCount,
      matchRate,
      totalAmount
    };
  }, [transactions]);

  // 2. Фильтрация выписки
  const filteredTxs = useMemo(() => {
    return transactions.filter(t => {
      const matchesSearch = 
        (t.payerName && t.payerName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (t.purpose && t.purpose.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (t.amount && t.amount.toString().includes(searchQuery)) ||
        (t.payerIin && t.payerIin.includes(searchQuery));

      const matchesStatus = 
        txFilter === 'ALL' || t.status === txFilter;

      return matchesSearch && matchesStatus;
    });
  }, [transactions, searchQuery, txFilter]);

  // 3. Фильтрация графиков оплат
  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => {
      const matchesSearch = 
        (s.leadName && s.leadName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (s.unitNumber && s.unitNumber.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (s.amount && s.amount.toString().includes(searchQuery));

      // Для графика проверяем просрочку (если dueDate < сейчас и не оплачен)
      const isOverdue = new Date(s.dueDate).getTime() < Date.now();
      const matchesStatus = 
        scheduleFilter === 'ALL' ||
        (scheduleFilter === 'OVERDUE' && isOverdue) ||
        (scheduleFilter === 'PENDING' && !isOverdue);

      return matchesSearch && matchesStatus;
    });
  }, [schedules, searchQuery, scheduleFilter]);

  // 4. Синхронизация с TBC Bank API
  const handleTbcSync = async () => {
    setSyncing(true);
    try {
      const res = await syncTBCBankAPIAction(organizationId);
      if (res.success) {
        alert(` Синхронизация завершена!\nИмпортировано транзакций: ${res.importedCount}\nАвтоматически сопоставлено: ${res.matchedCount}`);
        router.refresh();
      } else {
        alert(' Ошибка синхронизации: ' + (res.message || 'Не удалось получить данные с сервера.'));
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка при выполнении запроса к банку.');
    } finally {
      setSyncing(false);
    }
  };

  // 5. Импорт Excel выписки
  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await importBankStatementAction(formData, organizationId);
      if (res.success) {
        alert(` Файл выписки успешно обработан!\nНовых транзакций добавлено: ${res.importedCount}\nАвтоматически распознано и сопоставлено: ${res.matchedCount}`);
        router.refresh();
      } else {
        alert(' Ошибка импорта: ' + (res.message || 'Некорректный формат файла.'));
      }
    } catch (err) {
      console.error(err);
      alert('Произошла ошибка при загрузке выписки.');
    } finally {
      setUploading(false);
      // Сбросить инпут
      e.target.value = '';
    }
  };

  // 6. Ручное сопоставление платежа
  const handleOpenMatchModal = (tx: any) => {
    setMatchingTx(tx);
    setSelectedScheduleId('');
  };

  const handleCloseMatchModal = () => {
    setMatchingTx(null);
    setSelectedScheduleId('');
  };

  const handleConfirmMatch = async () => {
    if (!matchingTx || !selectedScheduleId) return;
    setSubmittingMatch(true);
    
    try {
      const res = await manuallyMatchTransactionAction({
        bankTxId: matchingTx.id,
        scheduleId: selectedScheduleId,
        organizationId
      });

      if (res.success) {
        alert(' Платеж успешно сопоставлен с графиком оплат!');
        handleCloseMatchModal();
        router.refresh();
      } else {
        alert(' Ошибка: ' + (res.message || 'Не удалось сопоставить платеж.'));
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка при сохранении сопоставления.');
    } finally {
      setSubmittingMatch(false);
    }
  };

  // 7. Отмена сопоставления
  const handleUnmatch = async (txId: string) => {
    const confirmed = confirm('Вы действительно хотите отменить сопоставление этого платежа?\nСделка вернется на предыдущий этап воронки, а статус оплаты сбросится на ожидание.');
    if (!confirmed) return;

    try {
      const res = await unmatchTransactionAction({
        bankTxId: txId,
        organizationId
      });

      if (res.success) {
        alert(' Сопоставление платежа отменено.');
        router.refresh();
      } else {
        alert(' Не удалось отменить сопоставление: ' + res.message);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сервера при отмене сопоставления.');
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <h1>Управление финансами</h1>
        </div>

        {canManage && (
          <div className={styles.actionsPanel}>
            <div className={styles.fileInputWrapper}>
              <button disabled={uploading} className={styles.btnSecondary}>
                 {uploading ? 'Загрузка...' : 'Загрузить выписку (Excel)'}
              </button>
              <input 
                type="file" 
                accept=".xlsx,.xls" 
                onChange={handleExcelImport} 
                className={styles.fileInput}
                disabled={uploading}
              />
            </div>
          </div>
        )}
      </header>

      {/* Grid Статистики */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ backgroundColor: '#e0e7ff', color: '#4f46e5' }}>
            
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statTitle}>Всего транзакций</span>
            <h2 className={styles.statValue}>{stats.totalCount} шт</h2>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ backgroundColor: '#d1fae5', color: '#10b981' }}>
            
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statTitle}>Сопоставлено</span>
            <h2 className={styles.statValue}>{stats.matchedCount} ({stats.matchRate}%)</h2>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ backgroundColor: '#fee2e2', color: '#ef4444' }}>
            
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statTitle}>Не распознано</span>
            <h2 className={styles.statValue}>{stats.unmatchedCount} шт</h2>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ backgroundColor: '#fef3c7', color: '#f59e0b' }}>
            
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statTitle}>Поступило оплат</span>
            <h2 className={styles.statValue}>${stats.totalAmount.toLocaleString()}</h2>
          </div>
        </div>
      </div>

      {/* Главная карточка с вкладками */}
      <div className={styles.dashboardCard}>
        <div className={styles.cardHeader}>
          <div className={styles.tabs}>
            <button 
              onClick={() => { setActiveTab('statement'); setSearchQuery(''); }}
              className={`${styles.tabButton} ${activeTab === 'statement' ? styles.activeTab : ''}`}
            >
               Банковская выписка
            </button>
            <button 
              onClick={() => { setActiveTab('schedule'); setSearchQuery(''); }}
              className={`${styles.tabButton} ${activeTab === 'schedule' ? styles.activeTab : ''}`}
            >
               График платежей (Реестр)
            </button>
          </div>

          <div className={styles.searchWrapper}>
            <input 
              type="text" 
              placeholder={activeTab === 'statement' ? "Поиск по плательщику или назначению..." : "Поиск по клиенту или квартире..."} 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />

            {activeTab === 'statement' ? (
              <select 
                value={txFilter} 
                onChange={(e) => setTxFilter(e.target.value as any)}
                className={styles.dropdownSelect}
                style={{ padding: '6px 12px', minWidth: '150px' }}
              >
                <option value="ALL">Все статусы</option>
                <option value="MATCHED">Сопоставленные</option>
                <option value="UNMATCHED">Не распознанные</option>
              </select>
            ) : (
              <select 
                value={scheduleFilter} 
                onChange={(e) => setScheduleFilter(e.target.value as any)}
                className={styles.dropdownSelect}
                style={{ padding: '6px 12px', minWidth: '150px' }}
              >
                <option value="ALL">Все статусы</option>
                <option value="PENDING">Ожидается</option>
                <option value="OVERDUE">Просрочен</option>
              </select>
            )}
          </div>
        </div>

        <div className={styles.tableContainer}>
          {activeTab === 'statement' ? (
            filteredTxs.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}></span>
                <p className={styles.emptyText}>Выписка пуста. Синхронизируйте API TBC Bank или загрузите Excel-файл выписки.</p>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Дата платежа</th>
                    <th>Плательщик</th>
                    <th>Сумма</th>
                    <th>Назначение платежа</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxs.map((tx) => (
                    <tr key={tx.id}>
                      <td>{new Date(tx.date).toLocaleDateString()} {new Date(tx.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                      <td>
                        <div className={styles.payerCell}>
                          <span className={styles.payerName}>{tx.payerName || 'Не указан'}</span>
                          <span className={styles.payerIin}>ИИН: {tx.payerIin || '—'}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`${styles.amountText} ${styles.amountPlus}`}>
                          +${tx.amount.toLocaleString()}
                        </span>
                      </td>
                      <td>
                        <div className={styles.purposeText} title={tx.purpose}>
                          {tx.purpose}
                        </div>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${tx.status === 'MATCHED' ? styles.badgeMatched : styles.badgeUnmatched}`}>
                          {tx.status === 'MATCHED' ? ' Сопоставлен' : ' Не распознан'}
                        </span>
                      </td>
                      <td>
                        {tx.status === 'MATCHED' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                              Кв №{tx.unitNumber} ({tx.leadName})
                            </span>
                            {canManage && (
                              <button 
                                onClick={() => handleUnmatch(tx.id)}
                                className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                              >
                                Отвязать
                              </button>
                            )}
                          </div>
                        ) : (
                          canManage && (
                            <button 
                              onClick={() => handleOpenMatchModal(tx)}
                              className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                            >
                               Сопоставить вручную
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            filteredSchedules.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}></span>
                <p className={styles.emptyText}>Нет ожидаемых оплат по графику с выбранным фильтром.</p>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Срок оплаты</th>
                    <th>Покупатель</th>
                    <th>Сумма платежа</th>
                    <th>Объект</th>
                    <th>Статус шага</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSchedules.map((s) => {
                    const isOverdue = new Date(s.dueDate).getTime() < Date.now();
                    return (
                      <tr key={s.id}>
                        <td>{new Date(s.dueDate).toLocaleDateString()}</td>
                        <td>
                          <div className={styles.payerCell}>
                            <span className={styles.payerName}>{s.leadName}</span>
                            <span className={styles.payerIin}>ИИН: {s.leadIin || '—'}</span>
                          </div>
                        </td>
                        <td>
                          <span className={styles.amountText}>
                            ${s.amount.toLocaleString()}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>Квартира №{s.unitNumber}</span>
                        </td>
                        <td>
                          <span className={`${styles.badge} ${isOverdue ? styles.badgeOverdue : styles.badgePending}`}>
                            {isOverdue ? '⏰ Просрочен' : '⏳ Ожидается'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                            Сделка: {s.dealStatus}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>

      {/* Модальное окно ручного сопоставления */}
      {matchingTx && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h3>Ручное распределение платежа</h3>
              <button onClick={handleCloseMatchModal} className={styles.closeBtn}></button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.txDetailsCard}>
                <span className={styles.txDetailsTitle}>Детали нераспознанной транзакции</span>
                <div className={styles.txDetailsGrid}>
                  <div>
                    <span className={styles.txDetailLabel}>Плательщик:</span>
                    <p className={styles.txDetailVal} style={{ margin: '4px 0 0 0' }}>{matchingTx.payerName || 'Не указан'}</p>
                  </div>
                  <div>
                    <span className={styles.txDetailLabel}>Сумма:</span>
                    <p className={styles.txDetailVal} style={{ margin: '4px 0 0 0', color: '#10b981' }}>+${matchingTx.amount.toLocaleString()}</p>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <span className={styles.txDetailLabel}>Назначение платежа:</span>
                    <p className={styles.txDetailVal} style={{ margin: '4px 0 0 0', fontWeight: 'normal', color: '#64748b' }}>{matchingTx.purpose}</p>
                  </div>
                </div>
              </div>

              <div className={styles.selectGroup}>
                <label>Выберите сделку и неоплаченный шаг графика</label>
                <select 
                  value={selectedScheduleId}
                  onChange={(e) => setSelectedScheduleId(e.target.value)}
                  className={styles.dropdownSelect}
                >
                  <option value="">-- Выберите из списка неоплаченных --</option>
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.leadName} | Кв №{s.unitNumber} | ${s.amount.toLocaleString()} (срок: {new Date(s.dueDate).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button 
                onClick={handleCloseMatchModal} 
                className={styles.btnSecondary}
                style={{ padding: '8px 16px' }}
                disabled={submittingMatch}
              >
                Отмена
              </button>
              <button 
                onClick={handleConfirmMatch} 
                className={styles.btnPrimary}
                style={{ padding: '8px 16px' }}
                disabled={submittingMatch || !selectedScheduleId}
              >
                {submittingMatch ? 'Привязка...' : ' Привязать платеж'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}