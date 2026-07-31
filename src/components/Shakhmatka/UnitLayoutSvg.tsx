'use client';

import React, { useState } from 'react';

interface UnitLayoutSvgProps {
  rooms: number;
  area: number;
  layoutUrl?: string | null;
  width?: number | string;
  height?: number | string;
}

export default function UnitLayoutSvg({ rooms, area, layoutUrl, width = '100%', height = 300 }: UnitLayoutSvgProps) {
  const [imageError, setImageError] = useState(false);

  // Если есть ссылка на реальную планировку и картинка загружается без ошибок
  if (layoutUrl && !imageError) {
    return (
      <div style={{ width: width, height: height, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', padding: '8px' }}>
        <img 
          src={layoutUrl} 
          alt="Планировка помещения" 
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          onError={() => setImageError(true)}
        />
      </div>
    );
  }

  // Выберем планировку в зависимости от количества комнат
  const roomCount = Math.max(1, Math.min(4, rooms));

  // Цвета для элементов планировки
  const wallColor = '#0f172a'; // Slate-900
  const wallWidth = '4';
  const dividerColor = '#64748b'; // Slate-500
  const dividerWidth = '2';
  const doorColor = '#94a3b8'; // Slate-400
  const furnitureColor = '#cbd5e1'; // Slate-300
  const textColor = '#475569'; // Slate-600
  const labelColor = '#0f172a'; // Slate-900

  // 1 КОМНАТА (Студия)
  if (roomCount === 1) {
    return (
      <svg viewBox="0 0 300 400" width={width} height={height} style={{ background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        {/* Сетка для красоты */}
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f1f5f9" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />

        {/* Внешние стены */}
        <rect x="20" y="20" width="260" height="320" fill="none" stroke={wallColor} strokeWidth={wallWidth} />
        {/* Балкон */}
        <rect x="50" y="340" width="200" height="40" fill="#f1f5f9" stroke={wallColor} strokeWidth={dividerWidth} strokeDasharray="4 4" />
        
        {/* Окна и двери балкона */}
        <line x1="80" y1="340" x2="160" y2="340" stroke="#3b82f6" strokeWidth="4" />
        <line x1="190" y1="340" x2="220" y2="340" stroke={doorColor} strokeWidth="2" />

        {/* Санузел */}
        <line x1="20" y1="120" x2="130" y2="120" stroke={wallColor} strokeWidth={wallWidth} />
        <line x1="130" y1="20" x2="130" y2="120" stroke={wallColor} strokeWidth={wallWidth} />
        {/* Дверь в санузел */}
        <path d="M 130 90 A 30 30 0 0 1 100 120" fill="none" stroke={doorColor} strokeWidth="2" />
        <line x1="130" y1="90" x2="130" y2="120" stroke="#f8fafc" strokeWidth="6" /> {/* Проем */}

        {/* Зона прихожей */}
        <text x="75" y="70" textAnchor="middle" fill={textColor} fontSize="10" fontWeight="bold">ПРИХОЖАЯ</text>
        <rect x="35" y="30" width="20" height="50" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <line x1="45" y1="30" x2="45" y2="80" stroke={furnitureColor} strokeWidth="1" />

        {/* Санузел наполнение */}
        <text x="190" y="70" textAnchor="middle" fill={textColor} fontSize="10" fontWeight="bold">С/У</text>
        <rect x="235" y="30" width="30" height="30" rx="5" fill="none" stroke={furnitureColor} strokeWidth="1.5" /> {/* Душ */}
        <ellipse cx="160" cy="40" rx="10" ry="15" fill="none" stroke={furnitureColor} strokeWidth="1.5" /> {/* Унитаз */}
        <ellipse cx="200" cy="35" rx="12" ry="8" fill="none" stroke={furnitureColor} strokeWidth="1.5" /> {/* Раковина */}

        {/* Кухонная зона */}
        <text x="210" y="160" textAnchor="middle" fill={textColor} fontSize="10" fontWeight="bold">КУХНЯ</text>
        <rect x="160" y="120" width="120" height="30" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <circle cx="185" cy="135" r="8" fill="none" stroke={furnitureColor} strokeWidth="1.5" /> {/* Плита */}
        <rect x="235" y="125" width="20" height="20" fill="none" stroke={furnitureColor} strokeWidth="1.5" /> {/* Раковина кухонная */}

        {/* Жилая зона (Спальня/Гостиная) */}
        <text x="150" y="240" textAnchor="middle" fill={labelColor} fontSize="14" fontWeight="bold">ЖИЛАЯ КОМНАТА</text>
        <text x="150" y="260" textAnchor="middle" fill={textColor} fontSize="12">{area} м²</text>

        {/* Кровать */}
        <rect x="35" y="150" width="80" height="100" rx="4" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <rect x="35" y="150" width="80" height="20" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <rect x="45" y="155" width="25" height="12" rx="2" fill="none" stroke={furnitureColor} strokeWidth="1" />
        <rect x="80" y="155" width="25" height="12" rx="2" fill="none" stroke={furnitureColor} strokeWidth="1" />

        {/* Обеденный стол */}
        <rect x="200" y="280" width="50" height="40" rx="5" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <circle cx="185" cy="300" r="6" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <circle cx="265" cy="300" r="6" fill="none" stroke={furnitureColor} strokeWidth="1.5" />

        {/* Балкон текст */}
        <text x="150" y="365" textAnchor="middle" fill={textColor} fontSize="10" fontWeight="bold">БАЛКОН</text>
      </svg>
    );
  }

  // 2 КОМНАТЫ (1-спальная)
  if (roomCount === 2) {
    return (
      <svg viewBox="0 0 400 300" width={width} height={height} style={{ background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f1f5f9" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />

        {/* Внешние стены */}
        <rect x="20" y="20" width="360" height="230" fill="none" stroke={wallColor} strokeWidth={wallWidth} />
        {/* Балкон */}
        <rect x="300" y="250" width="60" height="40" fill="#f1f5f9" stroke={wallColor} strokeWidth={dividerWidth} strokeDasharray="4 4" />
        
        {/* Перегородки комнат */}
        <line x1="200" y1="20" x2="200" y2="250" stroke={wallColor} strokeWidth={wallWidth} /> {/* Между спальней и залом */}
        <line x1="20" y1="110" x2="110" y2="110" stroke={wallColor} strokeWidth={wallWidth} /> {/* Санузел стена */}
        <line x1="110" y1="20" x2="110" y2="110" stroke={wallColor} strokeWidth={wallWidth} /> {/* Санузел стена */}

        {/* Двери */}
        {/* Дверь в спальню (справа) */}
        <path d="M 200 200 A 40 40 0 0 1 240 240" fill="none" stroke={doorColor} strokeWidth="2" />
        <line x1="200" y1="200" x2="200" y2="240" stroke="#f8fafc" strokeWidth="6" />
        
        {/* Дверь в санузел */}
        <path d="M 110 80 A 30 30 0 0 1 80 110" fill="none" stroke={doorColor} strokeWidth="2" />
        <line x1="110" y1="80" x2="110" y2="110" stroke="#f8fafc" strokeWidth="6" />

        {/* Входная дверь */}
        <path d="M 20 180 A 40 40 0 0 1 60 220" fill="none" stroke={doorColor} strokeWidth="2" />
        <line x1="20" y1="180" x2="20" y2="220" stroke="#f8fafc" strokeWidth="6" />

        {/* Текстовые метки */}
        <text x="65" y="150" textAnchor="middle" fill={textColor} fontSize="10" fontWeight="bold">ПРИХОЖАЯ</text>
        
        <text x="65" y="65" textAnchor="middle" fill={textColor} fontSize="10" fontWeight="bold">САНУЗЕЛ</text>
        <rect x="25" y="25" width="25" height="25" rx="4" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <ellipse cx="65" cy="30" rx="10" ry="6" fill="none" stroke={furnitureColor} strokeWidth="1.5" />

        {/* Гостиная + Кухня (Левая часть) */}
        <text x="110" y="175" textAnchor="middle" fill={labelColor} fontSize="13" fontWeight="bold">ГОСТИНАЯ + КУХНЯ</text>
        <text x="110" y="195" textAnchor="middle" fill={textColor} fontSize="11">{Math.round(area * 0.55)} м²</text>
        
        {/* Диван */}
        <rect x="135" y="30" width="55" height="40" rx="3" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <rect x="140" y="30" width="45" height="32" fill="none" stroke={furnitureColor} strokeWidth="1" />

        {/* Кухонный гарнитур */}
        <rect x="25" y="210" width="165" height="30" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <circle cx="50" cy="225" r="8" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <rect x="130" y="215" width="20" height="20" fill="none" stroke={furnitureColor} strokeWidth="1.5" />

        {/* Спальня (Правая часть) */}
        <text x="290" y="120" textAnchor="middle" fill={labelColor} fontSize="13" fontWeight="bold">СПАЛЬНЯ</text>
        <text x="290" y="140" textAnchor="middle" fill={textColor} fontSize="11">{Math.round(area * 0.4)} м²</text>

        {/* Двуспальная кровать */}
        <rect x="250" y="30" width="80" height="70" rx="5" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <rect x="250" y="30" width="80" height="15" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <rect x="260" y="35" width="25" height="10" rx="1" fill="none" stroke={furnitureColor} strokeWidth="1" />
        <rect x="295" y="35" width="25" height="10" rx="1" fill="none" stroke={furnitureColor} strokeWidth="1" />

        {/* Шкаф */}
        <rect x="345" y="110" width="25" height="90" fill="none" stroke={furnitureColor} strokeWidth="1.5" />
        <line x1="345" y1="155" x2="370" y2="155" stroke={furnitureColor} strokeWidth="1" />

        {/* Балкон */}
        <text x="330" y="275" textAnchor="middle" fill={textColor} fontSize="9" fontWeight="bold">БАЛКОН</text>
      </svg>
    );
  }

  // 3 КОМНАТЫ (2-спальная)
  if (roomCount === 3) {
    return (
      <svg viewBox="0 0 400 300" width={width} height={height} style={{ background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f1f5f9" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />

        {/* Внешние стены */}
        <rect x="20" y="20" width="360" height="240" fill="none" stroke={wallColor} strokeWidth={wallWidth} />
        {/* Балкон */}
        <rect x="20" y="260" width="100" height="30" fill="#f1f5f9" stroke={wallColor} strokeWidth={dividerWidth} strokeDasharray="4 4" />
        
        {/* Внутренние стены */}
        <line x1="140" y1="20" x2="140" y2="260" stroke={wallColor} strokeWidth={wallWidth} /> {/* Вертикальная */}
        <line x1="140" y1="140" x2="380" y2="140" stroke={wallColor} strokeWidth={wallWidth} /> {/* Горизонтальная правая */}
        <line x1="20" y1="100" x2="140" y2="100" stroke={wallColor} strokeWidth={wallWidth} /> {/* Горизонтальная левая */}

        {/* Двери */}
        <path d="M 140 180 A 30 30 0 0 1 170 210" fill="none" stroke={doorColor} strokeWidth="2" />
        <line x1="140" y1="180" x2="140" y2="210" stroke="#f8fafc" strokeWidth="6" />

        <path d="M 140 90 A 30 30 0 0 1 170 120" fill="none" stroke={doorColor} strokeWidth="2" />
        <line x1="140" y1="90" x2="140" y2="120" stroke="#f8fafc" strokeWidth="6" />

        {/* Зоны комнат */}
        {/* Спальня 1 (Вверху слева) */}
        <text x="80" y="55" textAnchor="middle" fill={labelColor} fontSize="11" fontWeight="bold">СПАЛЬНЯ 1</text>
        <text x="80" y="75" textAnchor="middle" fill={textColor} fontSize="10">{Math.round(area * 0.25)} м²</text>
        <rect x="40" y="30" width="50" height="20" fill="none" stroke={furnitureColor} strokeWidth="1.2" />

        {/* Гостиная + Кухня (Внизу слева) */}
        <text x="80" y="160" textAnchor="middle" fill={labelColor} fontSize="11" fontWeight="bold">ГОСТИНАЯ</text>
        <text x="80" y="180" textAnchor="middle" fill={textColor} fontSize="10">{Math.round(area * 0.35)} м²</text>
        <rect x="35" y="210" width="70" height="30" fill="none" stroke={furnitureColor} strokeWidth="1.2" />

        {/* Спальня 2 (Вверху справа) */}
        <text x="260" y="70" textAnchor="middle" fill={labelColor} fontSize="11" fontWeight="bold">СПАЛЬНЯ 2</text>
        <text x="260" y="90" textAnchor="middle" fill={textColor} fontSize="10">{Math.round(area * 0.22)} м²</text>
        <rect x="235" y="30" width="50" height="30" fill="none" stroke={furnitureColor} strokeWidth="1.2" />

        {/* Детская / Кабинет (Внизу справа) */}
        <text x="260" y="180" textAnchor="middle" fill={labelColor} fontSize="11" fontWeight="bold">ДЕТСКАЯ</text>
        <text x="260" y="200" textAnchor="middle" fill={textColor} fontSize="10">{Math.round(area * 0.18)} м²</text>
        <rect x="240" y="220" width="40" height="30" fill="none" stroke={furnitureColor} strokeWidth="1.2" />

        {/* Балкон */}
        <text x="70" y="280" textAnchor="middle" fill={textColor} fontSize="9" fontWeight="bold">БАЛКОН</text>
      </svg>
    );
  }

  // 4 И БОЛЕЕ КОМНАТ
  return (
    <svg viewBox="0 0 400 300" width={width} height={height} style={{ background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f1f5f9" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />

      {/* Внешние стены */}
      <rect x="20" y="20" width="360" height="240" fill="none" stroke={wallColor} strokeWidth={wallWidth} />
      
      {/* Перегородки */}
      <line x1="120" y1="20" x2="120" y2="260" stroke={wallColor} strokeWidth={wallWidth} />
      <line x1="250" y1="20" x2="250" y2="260" stroke={wallColor} strokeWidth={wallWidth} />
      <line x1="120" y1="130" x2="250" y2="130" stroke={wallColor} strokeWidth={wallWidth} />

      {/* Разметка комнат */}
      {/* Левая секция: Спальня 1 */}
      <text x="70" y="120" textAnchor="middle" fill={labelColor} fontSize="11" fontWeight="bold">СПАЛЬНЯ 1</text>
      <text x="70" y="140" textAnchor="middle" fill={textColor} fontSize="10">{Math.round(area * 0.28)} м²</text>
      <rect x="35" y="30" width="70" height="40" fill="none" stroke={furnitureColor} strokeWidth="1.2" />

      {/* Средняя секция верх: Спальня 2 */}
      <text x="185" y="65" textAnchor="middle" fill={labelColor} fontSize="11" fontWeight="bold">СПАЛЬНЯ 2</text>
      <text x="185" y="85" textAnchor="middle" fill={textColor} fontSize="10">{Math.round(area * 0.2)} м²</text>

      {/* Средняя секция низ: Кухня */}
      <text x="185" y="175" textAnchor="middle" fill={labelColor} fontSize="11" fontWeight="bold">КУХНЯ</text>
      <text x="185" y="195" textAnchor="middle" fill={textColor} fontSize="10">{Math.round(area * 0.17)} м²</text>

      {/* Правая секция: Большая Гостиная */}
      <text x="315" y="120" textAnchor="middle" fill={labelColor} fontSize="12" fontWeight="bold">ГОСТИНАЯ</text>
      <text x="315" y="140" textAnchor="middle" fill={textColor} fontSize="10">{Math.round(area * 0.35)} м²</text>
      <rect x="280" y="180" width="70" height="50" rx="5" fill="none" stroke={furnitureColor} strokeWidth="1.2" />
    </svg>
  );
}
