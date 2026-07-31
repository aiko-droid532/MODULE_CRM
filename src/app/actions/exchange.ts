'use server';

import { db as prisma } from '@/lib/db';

// Альтернативные API для курса USD/GEL
// 1. exchangerate.host (бесплатно, без ключа)
// 2. api.exchangerate-api.com
// 3. Frankfurter API

export async function getExchangeRate(date?: Date): Promise<number> {
  try {
    const targetDate = date || new Date();
    const todayStr = targetDate.toISOString().split('T')[0];
    
    // 1. Сначала пробуем получить из базы на конкретную дату
    const cached = await prisma.$queryRaw<any>`
      SELECT rate, date, "isFallback" FROM "ExchangeRate" 
      WHERE currency = 'USD' AND date = ${todayStr}::date
      LIMIT 1
    `;
    
    if (cached.length > 0 && !cached[0].isFallback) {
      console.log(` Курс из БД на ${todayStr}: ${cached[0].rate}`);
      return cached[0].rate;
    }
    
    // 2. Если нет в БД, пробуем получить из API
    const rate = await fetchRateFromAPI();
    
    // 3. Сохраняем в базу
    await prisma.$executeRaw`
      INSERT INTO "ExchangeRate" (id, currency, rate, date, "isFallback", "createdAt")
      VALUES (${crypto.randomUUID()}, 'USD', ${rate}, ${todayStr}::date, false, NOW())
    `;
    
    console.log(` Курс из API: ${rate}`);
    return rate;
    
  } catch (error) {
    console.error('Failed to get exchange rate:', error);
    
    // 4. Fallback: последний курс из БД
    const lastRate = await getLastKnownRate();
    if (lastRate) {
      console.log(` Используем последний известный курс: ${lastRate}`);
      return lastRate;
    }
    
    // 5. Супер-fallback: 2.70
    console.log(' Используем fallback курс 2.70');
    return 2.70;
  }
}

async function fetchRateFromAPI(): Promise<number> {
  // Пробуем несколько API по очереди
  
  // API 1: exchangerate.host (бесплатно, без ключа)
  try {
    const response = await fetch('https://api.exchangerate.host/convert?from=USD&to=GEL', {
      next: { revalidate: 3600 } // кэш на 1 час
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data && data.result) {
        console.log(' Курс из exchangerate.host:', data.result);
        return parseFloat(data.result.toFixed(4));
      }
    }
  } catch (error) {
    console.log('exchangerate.host failed:', error);
  }
  
  // API 2: Frankfurter API (бесплатно)
  try {
    const response = await fetch('https://api.frankfurter.app/latest?from=USD&to=GEL', {
      next: { revalidate: 3600 }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data && data.rates && data.rates.GEL) {
        console.log(' Курс из Frankfurter:', data.rates.GEL);
        return parseFloat(data.rates.GEL.toFixed(4));
      }
    }
  } catch (error) {
    console.log('Frankfurter API failed:', error);
  }
  
  // API 3: Currency API (бесплатно, регистрация не нужна для базовых запросов)
  try {
    const response = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', {
      next: { revalidate: 3600 }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data && data.usd && data.usd.gel) {
        console.log(' Курс из currency-api:', data.usd.gel);
        return parseFloat(data.usd.gel.toFixed(4));
      }
    }
  } catch (error) {
    console.log('Currency API failed:', error);
  }
  
  throw new Error('All APIs failed');
}

async function getLastKnownRate(): Promise<number | null> {
  try {
    const result = await prisma.$queryRaw<any>`
      SELECT rate FROM "ExchangeRate" 
      WHERE currency = 'USD' 
      ORDER BY date DESC 
      LIMIT 1
    `;
    
    if (result.length > 0) {
      return result[0].rate;
    }
    return null;
  } catch (error) {
    console.error('Failed to get last known rate:', error);
    return null;
  }
}

// Обновление курсов (вызывать по расписанию)
export async function updateExchangeRates() {
  try {
    const rate = await fetchRateFromAPI();
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Проверяем, есть ли уже курс на сегодня
    const exists = await prisma.$queryRaw<any>`
      SELECT EXISTS(SELECT 1 FROM "ExchangeRate" WHERE currency = 'USD' AND date = ${todayStr}::date) as exists
    `;
    
    if (exists[0]?.exists) {
      await prisma.$executeRaw`
        UPDATE "ExchangeRate" 
        SET rate = ${rate}, "isFallback" = false, "createdAt" = NOW()
        WHERE currency = 'USD' AND date = ${todayStr}::date
      `;
    } else {
      await prisma.$executeRaw`
        INSERT INTO "ExchangeRate" (id, currency, rate, date, "isFallback", "createdAt")
        VALUES (${crypto.randomUUID()}, 'USD', ${rate}, ${todayStr}::date, false, NOW())
      `;
    }
    
    console.log(` Курс обновлен: USD/GEL = ${rate}`);
    return { success: true, rate };
  } catch (error) {
    console.error('Failed to update exchange rates:', error);
    return { success: false, error: String(error) };
  }
}

// Получить исторический курс
export async function getHistoricalExchangeRate(date: Date): Promise<number> {
  const dateStr = date.toISOString().split('T')[0];
  
  const result = await prisma.$queryRaw<any>`
    SELECT rate FROM "ExchangeRate" 
    WHERE currency = 'USD' AND date <= ${dateStr}::date
    ORDER BY date DESC 
    LIMIT 1
  `;
  
  if (result.length > 0) {
    return result[0].rate;
  }
  
  return await getExchangeRate();
}