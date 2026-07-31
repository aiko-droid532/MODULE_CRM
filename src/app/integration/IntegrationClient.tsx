'use client';

import React, { useEffect, useState, useCallback } from 'react';
import styles from './Integration.module.css';

interface IntegrationStatus {
  ok: boolean;
  webhookUrl: string;
  leads: {
    total: number;
    last: { id: string; name: string; phone: string; createdAt: string; status: string } | null;
  };
  units: {
    total: number;
    byStatus: { status: string; count: number }[];
    lastSync: { lastSyncAt: string; syncStatus: string } | null;
  };
  webhookStats: { status: string; count: number }[];
  recentLogs: {
    id: string;
    eventType: string;
    status: string;
    errorMessage: string | null;
    resultLeadId: string | null;
    createdAt: string;
    ipAddress: string | null;
  }[];
}

const STATUS_COLORS: Record<string, string> = {
  FREE:             '#22c55e',
  SOLD:             '#ef4444',
  RESERVATION_ORAL: '#f59e0b',
  RESERVATION_PAID: '#f97316',
  SERVICE:          '#6b7280',
};

const STATUS_LABELS: Record<string, string> = {
  FREE:             'Свободно',
  SOLD:             'Продано',
  RESERVATION_ORAL: 'Устная брон.',
  RESERVATION_PAID: 'Оплачена брон.',
  SERVICE:          'Сервис',
};

const LOG_BADGE: Record<string, { bg: string; label: string }> = {
  SUCCESS:   { bg: '#22c55e', label: 'Успешно' },
  ERROR:     { bg: '#ef4444', label: 'Ошибка' },
  DUPLICATE: { bg: '#f59e0b', label: 'Дубликат' },
};

export default function IntegrationClient() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const WEBHOOK_URL = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhooks/leads`
    : '/api/webhooks/leads';

  const API_KEY = 'pb-secret-token';

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/integration/georgia/status');
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const copyWebhook = () => {
    navigator.clipboard.writeText(WEBHOOK_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const testWebhook = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/webhooks/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({
          name: 'Тест Грузия',
          phone: `+99599${Math.floor(Math.random() * 9000000 + 1000000)}`,
          email: 'test@parkboulevard.ge',
          comment: 'Тестовая заявка с панели управления',
          source: 'parkboulevard.ge',
          language: 'RU',
        }),
      });
      const data = await res.json();
      setSyncResult(data.success
        ? `Лид создан успешно! ID: ${data.leadId}`
        : `Ошибка: ${data.error || data.message}`
      );
      await fetchStatus();
    } catch (e: any) {
      setSyncResult('Сетевая ошибка: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const totalWebhookCalls = status?.webhookStats.reduce((s, r) => s + r.count, 0) || 0;
  const successCalls = status?.webhookStats.find(r => r.status === 'SUCCESS')?.count || 0;
  const successRate = totalWebhookCalls > 0 ? Math.round((successCalls / totalWebhookCalls) * 100) : 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.badge}>Интеграция</div>
          <h1 className={styles.title}>Park Boulevard Georgia</h1>
          <p className={styles.subtitle}>parkboulevard.ge — синхронизация лидов и квартир</p>
        </div>
        <button
          className={styles.refreshBtn}
          onClick={fetchStatus}
          disabled={loading}
        >
          {loading ? 'Обновление...' : 'Обновить'}
        </button>
      </div>

      {/* Карточки статистики */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{status?.leads.total ?? '—'}</div>
          <div className={styles.statLabel}>Лидов с сайта</div>
          {status?.leads.last && (
            <div className={styles.statSub}>
              Последний: {status.leads.last.name} · {new Date(status.leads.last.createdAt).toLocaleDateString('ru-RU')}
            </div>
          )}
        </div>

        <div className={styles.statCard}>
          <div className={styles.statValue}>{status?.units.total ?? '—'}</div>
          <div className={styles.statLabel}>Квартир синхронизировано</div>
          {status?.units.lastSync && (
            <div className={styles.statSub}>
              Синхр.: {new Date(status.units.lastSync.lastSyncAt).toLocaleString('ru-RU')}
            </div>
          )}
        </div>

        <div className={styles.statCard}>
          <div className={styles.statValue}>{totalWebhookCalls}</div>
          <div className={styles.statLabel}>Запросов webhook</div>
          <div className={styles.statSub}>Успешных: {successRate}%</div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#2563eb' }}>{successRate}%</div>
          <div className={styles.statLabel}>Успешность</div>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${successRate}%` }} />
          </div>
        </div>
      </div>

      <div className={styles.twoCol}>
        {/* Левая колонка: webhook */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Webhook для сайта Грузии</h2>
          <p className={styles.cardDesc}>
            Этот URL необходимо внести в настройки Elementor Forms на сайте parkboulevard.ge
          </p>

          <div className={styles.urlBox}>
            <span className={styles.method}>POST</span>
            <code className={styles.url}>{WEBHOOK_URL}</code>
            <button className={styles.copyBtn} onClick={copyWebhook}>
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>

          <div className={styles.infoBlock}>
            <div className={styles.infoRow}>
              <span className={styles.infoKey}>Header</span>
              <code className={styles.infoVal}>x-api-key: {API_KEY}</code>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoKey}>Поля</span>
              <code className={styles.infoVal}>name, phone, email, comment</code>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoKey}>Дополнительно</span>
              <code className={styles.infoVal}>flat_id, language, submission_id</code>
            </div>
          </div>

          <div className={styles.testSection}>
            <button
              className={styles.testBtn}
              onClick={testWebhook}
              disabled={syncing}
            >
              {syncing ? 'Отправка...' : 'Тестовая отправка — создать лид'}
            </button>
            {syncResult && (
              <div className={`${styles.testResult} ${syncResult.includes('успешно') ? styles.ok : styles.err}`}>
                {syncResult}
              </div>
            )}
          </div>
        </div>

        {/* Правая колонка: синхронизация квартир */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Синхронизация квартир</h2>
          <p className={styles.cardDesc}>
            Endpoint для загрузки квартир из базы данных Park Boulevard в систему CRM
          </p>

          <div className={styles.urlBox}>
            <span className={styles.method}>POST</span>
            <code className={styles.url}>{typeof window !== 'undefined' ? window.location.origin : ''}/api/integration/georgia/sync-units</code>
          </div>

          <div className={styles.infoBlock}>
            <div className={styles.infoRow}>
              <span className={styles.infoKey}>Header</span>
              <code className={styles.infoVal}>x-api-key: {API_KEY}</code>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoKey}>Body</span>
              <code className={styles.infoVal}>{`{ "flats": [...] }`}</code>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoKey}>Поля квартиры</span>
              <code className={styles.infoVal}>id, number, floor, area, rooms, price, status, block, rooms_detail</code>
            </div>
          </div>

          {/* Квартиры по статусам */}
          {status?.units.byStatus && status.units.byStatus.length > 0 && (
            <div className={styles.unitStatuses}>
              <div className={styles.unitStatusTitle}>Квартиры в системе:</div>
              {status.units.byStatus.map(s => (
                <div key={s.status} className={styles.unitStatusRow}>
                  <span
                    className={styles.unitDot}
                    style={{ background: STATUS_COLORS[s.status] || '#6b7280' }}
                  />
                  <span className={styles.unitStatusName}>{STATUS_LABELS[s.status] || s.status}</span>
                  <span className={styles.unitStatusCount}>{s.count}</span>
                </div>
              ))}
            </div>
          )}

          {status?.units.total === 0 && (
            <div className={styles.emptyState}>
              <p>Квартиры еще не синхронизированы.</p>
              <p className={styles.emptyHint}>Необходимо вызвать endpoint /sync-units с данными из базы сайта.</p>
            </div>
          )}
        </div>
      </div>

      {/* Журнал последних запросов */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Журнал входящих заявок (последние 10)</h2>
        {status?.recentLogs && status.recentLogs.length > 0 ? (
          <div className={styles.logsTable}>
            <div className={styles.logsHeader}>
              <span>Статус</span>
              <span>Тип</span>
              <span>Лид ID</span>
              <span>IP адрес</span>
              <span>Дата / Время</span>
              <span>Сообщение / Ошибка</span>
            </div>
            {status.recentLogs.map(log => {
              const badge = LOG_BADGE[log.status] || { bg: '#6b7280', label: log.status };
              return (
                <div key={log.id} className={styles.logRow}>
                  <span>
                    <span className={styles.logBadge} style={{ background: badge.bg }}>
                      {badge.label}
                    </span>
                  </span>
                  <span className={styles.logType}>{log.eventType}</span>
                  <span className={styles.logLeadId}>{log.resultLeadId ? `…${log.resultLeadId.slice(-8)}` : '—'}</span>
                  <span className={styles.logIp}>{log.ipAddress || '—'}</span>
                  <span className={styles.logDate}>
                    {new Date(log.createdAt).toLocaleString('ru-RU', {
                      day: '2-digit', month: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                  <span className={styles.logError}>{log.errorMessage || '—'}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <p>Заявок с сайта пока не поступало.</p>
            <p className={styles.emptyHint}>После настройки webhook со стороны сайта здесь появятся данные.</p>
          </div>
        )}
      </div>

      {/* Инструкция для разработчиков */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Инструкция по настройке для команды Park Boulevard</h2>
        <div className={styles.instructionBlock}>
          <div className={styles.instructionStep}>
            <div className={styles.stepNum}>1</div>
            <div className={styles.stepContent}>
              <strong>Webhook для лидов (форма "Запросить звонок")</strong>
              <p>В настройках Elementor Forms → Actions → Add Action → Webhook</p>
              <code className={styles.codeBlock}>
                {`URL: ${WEBHOOK_URL}
Method: POST
Headers: x-api-key: ${API_KEY}

Поля формы:
  name          -> имя клиента
  phone         -> телефон  
  email         -> email (необязательно)
  comment       -> сообщение (необязательно)
  flat_id       -> ID квартиры (необязательно)
  submission_id -> ID заявки (необязательно)`}
              </code>
            </div>
          </div>

          <div className={styles.instructionStep}>
            <div className={styles.stepNum}>2</div>
            <div className={styles.stepContent}>
              <strong>Синхронизация квартир</strong>
              <p>Вызывать для передача базы квартир и обновлении их статусов:</p>
              <code className={styles.codeBlock}>
                {`POST ${typeof window !== 'undefined' ? window.location.origin : ''}/api/integration/georgia/sync-units
Headers: x-api-key: ${API_KEY}

Body:
{
  "flats": [
    {
      "id": 123,
      "number": "A-101",
      "floor": 1,
      "area": 65.5,
      "living_area": 48.0,
      "balcony_area": 5.0,
      "rooms": 2,
      "type": "APARTMENT",
      "price": 95000,
      "price_gel": 260000,
      "status": "FREE",
      "block": "A",
      "rooms_detail": [
        { "room_type": "studio", "area": 22.30 },
        { "room_type": "bedroom", "area": 18.10 }
      ]
    }
  ]
}`}
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
