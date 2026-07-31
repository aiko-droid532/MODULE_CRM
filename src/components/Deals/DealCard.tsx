'use client';

import React, { useState, useEffect } from 'react';
import styles from './DealCard.module.css';
import Calculator from '../Finance/Calculator';
import { createDeal } from '@/app/actions/leads';
import { getLeads } from '@/app/actions/leads';
import { getExchangeRate } from '@/app/actions/exchange';

interface DealCardProps {
  deal: any; // Can be a partial deal or empty for new ones
  onClose: () => void;
  onSuccess?: () => void;
}

const DealCard: React.FC<DealCardProps> = ({ deal, onClose, onSuccess }) => {
  const [activeTab, setActiveTab] = useState('info');
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(2.7);

  // Prices are stored in USD directly
  const initialPrice = deal.price || 120000;
  
  const [formData, setFormData] = useState({
    leadId: deal.leadId || '',
    unitId: deal.unitId || 'test-unit-id', // Placeholder if not from shakhmatka
    status: 'Negotiation',
    price: initialPrice
  });

  useEffect(() => {
    // Load leads so manager can pick a client
    const loadLeads = async () => {
      const data = await getLeads('dev-org-123');
      setLeads(data);
    };
    loadLeads();

    // Fetch dynamic exchange rate
    const fetchRate = async () => {
      try {
        const rate = await getExchangeRate();
        setExchangeRate(rate);
      } catch (e) {
        console.error('Failed to fetch exchange rate in DealCard:', e);
      }
    };
    fetchRate();
  }, []);

  const handleSave = async () => {
    if (!formData.leadId) {
      alert('Пожалуйста, выберите клиента (Лида)');
      return;
    }
    
    setLoading(true);
    const res = await createDeal({
      ...formData,
      organizationId: 'dev-org-123',
      interestId: deal.interestId || 'dummy-interest-id'
    });

    if (res.success) {
      if (onSuccess) onSuccess();
      onClose();
    } else {
      alert('Ошибка при сохранении сделки: ' + (res.error || 'Неизвестная ошибка'));
    }
    setLoading(false);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.card} premium-shadow`} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.titleArea}>
            <span className={styles.badge}>{deal.id === 'new' ? 'Новая сделка' : deal.status}</span>
            <h2>{deal.client || 'Оформление сделки'}</h2>
            <p>{deal.id !== 'new' && deal.id ? `ID Сделки: ${deal.id}` : 'Привязка клиента к объекту'}</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose}></button>
        </header>

        <nav className={styles.tabs}>
          <button className={activeTab === 'info' ? styles.activeTab : ''} onClick={() => setActiveTab('info')}> Инфо</button>
          <button className={activeTab === 'unit' ? styles.activeTab : ''} onClick={() => setActiveTab('unit')}> Объект</button>
          <button className={activeTab === 'finance' ? styles.activeTab : ''} onClick={() => setActiveTab('finance')}> Финансы</button>
          <button className={activeTab === 'mortgage' ? styles.activeTab : ''} onClick={() => setActiveTab('mortgage')}> Ипотека</button>
        </nav>

        <div className={styles.content}>
          {activeTab === 'info' && (
            <div className={styles.infoForm}>
              <div className={styles.group}>
                <label>Выберите клиента (Лида)</label>
                <select 
                  value={formData.leadId} 
                  onChange={(e) => setFormData({...formData, leadId: e.target.value})}
                >
                  <option value="">-- Выберите из списка --</option>
                  {leads.map(lead => (
                    <option key={lead.id} value={lead.id}>{lead.name} ({lead.phone})</option>
                  ))}
                </select>
                <p className={styles.hint}>Сначала создайте лида в разделе «Лиды», если его нет в списке.</p>
              </div>
              <div className={styles.group}>
                <label>Статус сделки</label>
                <select 
                  value={formData.status}
                  onChange={(e) => setFormData({...formData, status: e.target.value})}
                >
                  <option value="Negotiation">Переговоры</option>
                  <option value="Reservation">Бронирование</option>
                  <option value="Contract">Подготовка договора</option>
                </select>
              </div>
            </div>
          )}

          {activeTab === 'unit' && (
            <div className={styles.unitBlock}>
              <div className={styles.unitCard}>
                <div className={styles.unitPreview}><div className={styles.svgPlaceholder}>План квартиры</div></div>
                <div className={styles.unitData}>
                  <h3>{deal.unit || 'Кв. 402'}</h3>
                  <p>{deal.project || 'ЖК Grand Park'}</p>
                  <div className={styles.grid}>
                    <div><span>Этаж</span><strong>{deal.floor || '4'}</strong></div>
                    <div><span>Площадь</span><strong>{deal.area || '64.5'} м²</strong></div>
                    <div><span>Цена (USD)</span><strong>${formData.price.toLocaleString()}</strong></div>
                    <div><span>Цена (GEL)</span><strong>{Math.round(formData.price * exchangeRate).toLocaleString()} ₾</strong></div>
                  </div>
                </div>
              </div>
              <button className={styles.changeUnitBtn}>Изменить объект</button>
            </div>
          )}

          {activeTab === 'finance' && (
            <div className={styles.financeBlock}>
              <Calculator initialPrice={formData.price} />
            </div>
          )}

          {activeTab === 'mortgage' && (
            <div className={styles.mortgageBlock}>
              <h3>Статус ипотеки</h3>
              <div className={styles.bankList}>
                {['TBC Bank', 'Bank of Georgia', 'Liberty Bank'].map(bank => (
                  <div key={bank} className={styles.bankItem}>
                    <span>{bank}</span>
                    <select><option>Не подавали</option><option>В процессе</option><option>Одобрено</option></select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Отмена</button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={loading}>
            {loading ? 'Сохранение...' : 'Сохранить сделку'}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default DealCard;