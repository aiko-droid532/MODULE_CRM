'use client';

import React, { useState } from 'react';
import styles from './Leads.module.css';
import LeadModal from '@/components/Leads/LeadModal';
import LeadDossier from '@/components/Leads/LeadDossier';
import { useRouter } from 'next/navigation';
import { createClient, getLeadById } from '@/app/actions/leads';

interface LeadsClientProps {
  initialLeads: any[];
  organizationId: string;
}

export default function LeadsClient({ initialLeads, organizationId }: LeadsClientProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any | null>(null);
  const [filters, setFilters] = useState({ query: '', source: '', date: '' });
  const router = useRouter();

  const filteredLeads = initialLeads.filter(lead => {
    const matchQuery = lead.name.toLowerCase().includes(filters.query.toLowerCase()) || 
                       lead.phone.includes(filters.query);
    const matchSource = filters.source ? lead.source === filters.source : true;
    const matchDate = filters.date ? new Date(lead.createdAt).toLocaleDateString() === new Date(filters.date).toLocaleDateString() : true;
    return matchQuery && matchSource && matchDate;
  });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <h1>База клиентов</h1>
          <p>Всего в системе: {initialLeads.length} клиентов</p>
        </div>
        <button className={styles.addBtn} onClick={() => setIsModalOpen(true)}>
          + Добавить клиента
        </button>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.searchWrapper}>
          <span className={styles.searchIcon}></span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Поиск по имени или телефону..."
            value={filters.query}
            onChange={(e) => setFilters({...filters, query: e.target.value})}
          />
        </div>
        
        <div className={styles.filterGroup}>
          <select 
            className={styles.selectInput}
            value={filters.source}
            onChange={(e) => setFilters({...filters, source: e.target.value})}
          >
            <option value="">Все источники</option>
            <option value="Instagram">Instagram</option>
            <option value="Krisha.kz">Krisha.kz</option>
            <option value="Facebook">Facebook</option>
            <option value="Website">Сайт</option>
            <option value="Referral">Рекомендация</option>
          </select>

          <input
            type="date"
            className={styles.dateInput}
            value={filters.date}
            onChange={(e) => setFilters({...filters, date: e.target.value})}
          />
        </div>
      </div>

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
            {filteredLeads.map((client) => (
              <tr key={client.id} onClick={() => setSelectedLead(client)}>
                <td>
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
                    <span className={styles.interestCount}> {client.interests.length} объекта</span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>Нет подборов</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className={styles.actionBtn} onClick={() => setSelectedLead(client)}>Открыть досье</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredLeads.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px', color: '#64748b' }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}></div>
            <h3>Клиенты не найдены</h3>
            <p>Попробуйте изменить параметры поиска или фильтры</p>
          </div>
        )}
      </div>

      {isModalOpen && (
        <LeadModal
          onClose={() => setIsModalOpen(false)}
          organizationId={organizationId}
          onSuccess={() => router.refresh()}
          onSelectExisting={async (id) => {
            setIsModalOpen(false); 
            
            // Всегда загружаем полные данные клиента из базы, 
            // чтобы в досье были и логи, и интересы
            const fullLead = await getLeadById(id.toString());
            if (fullLead) {
              setSelectedLead(fullLead);
            }
          }}
        />
      )}

      {selectedLead && (
        <LeadDossier
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          organizationId={organizationId}
        />
      )}
    </div>
  );
}