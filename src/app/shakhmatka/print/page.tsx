import { db } from '@/lib/db';
import UnitLayoutSvg from '@/components/Shakhmatka/UnitLayoutSvg';
import { getExchangeRate } from '@/app/actions/exchange';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function PrintUnitPage({
  searchParams,
}: {
  searchParams: { unitId?: string };
}) {
  const unitId = searchParams.unitId;
  if (!unitId) return notFound();

  // 1. Получаем характеристики квартиры, ЖК и блока
  const units = await db.$queryRaw<any[]>`
    SELECT u.*, b.number as "blockNumber", p.name as "projectName", p.address as "projectAddress"
    FROM "Unit" u
    JOIN "Block" b ON u."blockId" = b.id
    JOIN "Project" p ON b."projectId" = p.id
    WHERE u.id = ${unitId}
    LIMIT 1
  `;

  if (units.length === 0) return notFound();
  const unit = units[0];

  // 2. Получаем курс обмена
  let exchangeRate = 2.70;
  try {
    exchangeRate = await getExchangeRate();
  } catch (e) {
    console.error('Failed to get exchange rate:', e);
  }

  const priceGel = Math.round(unit.price * exchangeRate);

  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#0f172a' }}>
      
      {/* Шапка бланка */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '20px', marginBottom: '30px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '-0.5px' }}>
            {unit.projectName}
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            📍 {unit.projectAddress || 'Мангилик Ел, Астана'}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '18px', fontWeight: 850, color: '#0f172a' }}>ПАСПОРТ ОБЪЕКТА</div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>Сформирован: {new Date().toLocaleDateString('ru-RU')}</div>
        </div>
      </div>

      {/* Контент бланка */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '30px', marginBottom: '30px' }}>
        
        {/* Левая колонка: Изображение планировки */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', color: '#64748b', alignSelf: 'flex-start' }}>
            Планировочное решение (2D)
          </h3>
          <UnitLayoutSvg rooms={unit.rooms} area={unit.area} layoutUrl={unit.layoutUrl} width="100%" height={320} />
        </div>

        {/* Правая колонка: Характеристики */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ background: '#eff6ff', borderRadius: '16px', padding: '20px', border: '1px solid #bfdbfe' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#1e40af', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
              Номер помещения
            </span>
            <span style={{ fontSize: '28px', fontWeight: 900, color: '#1e3a8a' }}>
              Квартира №{unit.number}
            </span>
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#1e40af', fontWeight: 700 }}>
              Корпус/Блок: {unit.blockNumber} • Этаж: {unit.floor}
            </div>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
              Параметры объекта
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px', fontSize: '14px' }}>
                <span style={{ color: '#64748b' }}>Общая площадь:</span>
                <span style={{ fontWeight: 700 }}>{unit.area} м²</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px', fontSize: '14px' }}>
                <span style={{ color: '#64748b' }}>Количество комнат:</span>
                <span style={{ fontWeight: 700 }}>{unit.rooms}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px', fontSize: '14px' }}>
                <span style={{ color: '#64748b' }}>Тип недвижимости:</span>
                <span style={{ fontWeight: 700 }}>{unit.type === 'Apartment' ? 'Жилая (Квартира)' : unit.type}</span>
              </div>
              {unit.viewType && (
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px', fontSize: '14px' }}>
                  <span style={{ color: '#64748b' }}>Вид из окон:</span>
                  <span style={{ fontWeight: 700 }}>{unit.viewType}</span>
                </div>
              )}
            </div>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', background: '#f8fafc' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
              Стоимость предложения
            </span>
            <span style={{ fontSize: '24px', fontWeight: 900, color: '#0f172a', display: 'block' }}>
              ${unit.price.toLocaleString()}
            </span>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#475569', display: 'block', marginTop: '4px' }}>
              {priceGel.toLocaleString()} ₾
            </span>
          </div>

        </div>

      </div>

      {/* Описание преимуществ */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '40px' }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 800, color: '#0f172a', textTransform: 'uppercase' }}>
          ОПИСАНИЕ ОБЪЕКТА
        </h4>
        <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: '1.6' }}>
          Современное планировочное решение с рациональным использованием площади. Объект располагается в престижном жилом комплексе с развитой инфраструктурой, благоустроенным двором и прямым доступом к ключевым прогулочным зонам города. Идеально подходит как для проживания, так и для инвестиционных целей.
        </p>
      </div>

      {/* Футер бланка */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '20px', textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
        <p style={{ margin: '0 0 4px 0' }}>Данное предложение носит ознакомительный характер и не является публичной офертой.</p>
        <p style={{ margin: 0, fontWeight: 600, color: '#64748b' }}>Отдел продаж | CRM Модуль Недвижимости</p>
      </div>

      {/* Скрипт автоматического запуска печати */}
      <script dangerouslySetInnerHTML={{ __html: 'window.onload = function() { setTimeout(function() { window.print(); }, 500); }' }} />

      {/* Стили для печатной страницы */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body {
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
          }
          /* Скрываем заголовки окон браузера (по возможности) */
          @page {
            size: A4;
            margin: 1.5cm;
          }
        }
      `}} />
      
    </div>
  );
}
