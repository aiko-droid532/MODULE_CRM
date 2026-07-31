'use client';

import React, { useState, useEffect } from 'react';
import styles from './Calculator.module.css';
import { getExchangeRate } from '@/app/actions/exchange';

interface CalculatorProps {
  initialPrice?: number;
}

const Calculator: React.FC<CalculatorProps> = ({ initialPrice = 120000 }) => {
  const [price, setPrice] = useState(initialPrice);
  const [downPayment, setDownPayment] = useState(30); // percentage
  const [period, setPeriod] = useState(12); // months
  const [schedule, setSchedule] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(2.7);

  // Sync with prop when it changes
  useEffect(() => {
    if (initialPrice) {
      setPrice(initialPrice);
    }
  }, [initialPrice]);

  // Fetch current exchange rate
  useEffect(() => {
    const fetchRate = async () => {
      try {
        const rate = await getExchangeRate();
        setExchangeRate(rate);
      } catch (e) {
        console.error('Failed to fetch exchange rate in Calculator:', e);
      }
    };
    fetchRate();
  }, []);

  const calculate = () => {
    const dpAmount = (price * downPayment) / 100;
    const remaining = price - dpAmount;
    const monthly = remaining / period;
    
    const newSchedule = [];
    for (let i = 1; i <= period; i++) {
      const usdAmount = Math.round(monthly);
      const gelAmount = Math.round(monthly * exchangeRate);
      newSchedule.push({
        month: i,
        amount: `$${usdAmount.toLocaleString()} (${gelAmount.toLocaleString()} ₾)`
      });
    }
    setSchedule(newSchedule);
  };

  useEffect(() => {
    calculate();
  }, [price, downPayment, period, exchangeRate]);

  return (
    <div className={styles.calculator}>
      <div className={styles.form}>
        <div className={styles.field}>
          <label>Стоимость объекта ($)</label>
          <input 
            type="number" 
            value={price} 
            onChange={(e) => setPrice(Number(e.target.value))} 
          />
        </div>
        
        <div className={styles.field}>
          <label>Первоначальный взнос ({downPayment}%)</label>
          <input 
            type="range" 
            min="10" 
            max="90" 
            step="5"
            value={downPayment} 
            onChange={(e) => setDownPayment(Number(e.target.value))} 
          />
        </div>

        <div className={styles.field}>
          <label>Срок рассрочки ({period} мес.)</label>
          <input 
            type="range" 
            min="3" 
            max="36" 
            step="3"
            value={period} 
            onChange={(e) => setPeriod(Number(e.target.value))} 
          />
        </div>
      </div>

      <div className={styles.results}>
        <div className={styles.resultItem}>
          <span className={styles.resultLabel}>Сумма взноса:</span>
          <span className={styles.resultValue}>
            ${Math.round((price * downPayment) / 100).toLocaleString()} 
            <span className={styles.gelValue}> ({Math.round(((price * downPayment) / 100) * exchangeRate).toLocaleString()} ₾)</span>
          </span>
        </div>
        <div className={styles.resultItem}>
          <span className={styles.resultLabel}>Ежемесячный платеж:</span>
          <span className={`${styles.resultValue} ${styles.highlight}`}>
            ${Math.round(((price - (price * downPayment) / 100) / period)).toLocaleString()}
            <span className={styles.gelValue}> ({Math.round(((price - (price * downPayment) / 100) / period) * exchangeRate).toLocaleString()} ₾)</span>
          </span>
        </div>
      </div>

      <div className={styles.schedule}>
        <h4>График платежей</h4>
        <div className={styles.scrollArea}>
          {schedule.map((item) => (
            <div key={item.month} className={styles.scheduleItem}>
              <span>Месяц {item.month}</span>
              <strong>{item.amount}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Calculator;
