import { cookies } from 'next/headers';
import { db as prisma } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import styles from './page.module.css';
import { UsersIcon, DealsIcon, DollarIcon, ConversionIcon } from '@/components/Icons';

import FunnelView from './FunnelView';

type FunnelItem = {
  key: string;
  label: string;
  type: 'normal' | 'group' | 'child';
  statusKeys?: string[];
};

const FUNNEL_STRUCTURE: FunnelItem[] = [
  { key: 'NEW_LEAD', label: 'Новый лид', type: 'normal' },
  { key: 'CLARIFICATION', label: 'Обработанный лид', type: 'normal' },
  { key: 'CALL', label: 'Колл-центр', type: 'group', statusKeys: ['CALL', 'SECOND_CALL', 'THIRD_CALL'] },
  { key: 'SECOND_CALL', label: 'Коллцентр 2', type: 'child' },
  { key: 'THIRD_CALL', label: 'Обработанный Звонок', type: 'child' },
  { key: 'PRE_RESERVATION', label: '1-й звонок', type: 'normal' },
  { key: 'RESERVATION', label: '2-й звонок', type: 'normal' },
  { key: 'CONTRACT_PREPARATION', label: '3-й звонок', type: 'normal' },
  { key: 'CONSULTATION', label: 'Распределён', type: 'normal' },
  { key: 'MEETING', label: 'Встреча назначена', type: 'normal' },
  { key: 'CLIENT_CONFIRMATION', label: 'Встреча проведена', type: 'normal' },
  { key: 'CONTRACT', label: 'Запрошено бронирование', type: 'normal' },
  { key: 'PAYMENT_CONFIRMED', label: 'Бронирование подтверждено', type: 'normal' },
  { key: 'DEAL', label: 'Договор', type: 'normal' },
  { key: 'WAITING_PAYMENT', label: 'Ожидание оплаты', type: 'normal' },
  { key: 'SUCCESS', label: 'WON/Продано', type: 'normal' },
  { key: 'FAILED', label: 'LOST', type: 'normal' },
  { key: 'CANCELLED', label: 'Cancelled (расторжение)', type: 'normal' }
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const cookieStore = cookies();
  const token = searchParams.token || cookieStore.get('auth_token')?.value;
  
  let organizationId = 'default';
  
  if (token) {
    try {
      const { payload } = await verifyToken(token);
      if (payload && typeof payload !== 'string') {
        organizationId = ((payload as any).app_metadata?.organization_id as string) || '741be209-ad6f-4483-92ee-298a36899bcf';
      }
    } catch {}
  }

  let leadsCount = 0;
  let dealsCount = 0;
  let totalRevenueUSD = 0;
  const statusData: Record<string, { count: number; money: number; avgMinutes: number }> = {};
  let dbError = false;
  let totalDealsAll = 0;
  let dealsWithDetails: any[] = [];

  try {
    // Загружаем данные для дашборда параллельно (устраняет waterfall)
    const [leadsCountResult, dealsCountResult, rawDeals, revenueResult] = await Promise.all([
      prisma.$queryRaw`
        SELECT COUNT(*)::int as "count" FROM "Lead" WHERE "organizationId" = ${organizationId}
      `,
      prisma.$queryRaw`
        SELECT COUNT(*)::int as "count" FROM "Deal" 
        WHERE "organizationId" = ${organizationId} AND "status"::text != 'FAILED'
      `,
      prisma.$queryRaw`
        SELECT 
          d.id as "dealId",
          d.status as "dealStatus",
          d."organizationId" as "dealOrgId",
          d."managerId" as "dealManagerId",
          d."paymentType" as "dealPaymentType",
          d."downPayment" as "dealDownPayment",
          d."totalAmount" as "dealTotalAmount",
          d."createdAt" as "dealCreatedAt",
          d."updatedAt" as "dealUpdatedAt",
          l.id as "leadId",
          l.name as "leadName",
          l.phone as "leadPhone",
          l.email as "leadEmail",
          l.iin as "leadIin",
          u.id as "unitId",
          u.number as "unitNumber",
          u.floor as "unitFloor",
          u.rooms as "unitRooms",
          u.type as "unitType",
          u.area as "unitArea",
          u.price as "unitPrice",
          b.number as "blockNumber",
          p.name as "projectName"
        FROM "Deal" d
        LEFT JOIN "Lead" l ON d."leadId" = l.id
        LEFT JOIN "Unit" u ON d."unitId" = u.id
        LEFT JOIN "Block" b ON u."blockId" = b.id
        LEFT JOIN "Project" p ON b."projectId" = p.id
        WHERE d."organizationId" = ${organizationId}
        ORDER BY d."updatedAt" DESC
      `,
      prisma.$queryRaw`
        SELECT COALESCE(SUM("amount"), 0)::float as "total"
        FROM "PaymentSchedule"
        WHERE "organizationId" = ${organizationId} AND "status"::text = 'PAID'
      `
    ]);

    leadsCount = (leadsCountResult as any[])[0]?.count || 0;
    dealsCount = (dealsCountResult as any[])[0]?.count || 0;
    totalRevenueUSD = (revenueResult as any[])[0]?.total || 0;

    // Преобразуем плоский SQL-результат в вложенную древовидную структуру для воронки
    dealsWithDetails = (rawDeals as any[]).map(d => ({
      id: d.dealId,
      status: d.dealStatus,
      organizationId: d.dealOrgId,
      managerId: d.dealManagerId,
      paymentType: d.dealPaymentType,
      downPayment: d.dealDownPayment,
      totalAmount: d.dealTotalAmount,
      createdAt: d.dealCreatedAt,
      updatedAt: d.dealUpdatedAt,
      lead: d.leadId ? {
        id: d.leadId,
        name: d.leadName,
        phone: d.leadPhone,
        email: d.leadEmail,
        iin: d.leadIin
      } : null,
      unit: d.unitId ? {
        id: d.unitId,
        number: d.unitNumber,
        floor: d.unitFloor,
        rooms: d.unitRooms,
        type: d.unitType,
        area: d.unitArea,
        price: d.unitPrice,
        block: {
          number: d.blockNumber,
          project: {
            name: d.projectName
          }
        }
      } : null
    }));

    totalDealsAll = dealsWithDetails.length;
    const now = new Date();

    dealsWithDetails.forEach((deal: any) => {
      const s = deal.status as string;
      if (!statusData[s]) statusData[s] = { count: 0, money: 0, avgMinutes: 0 };
      
      statusData[s].count += 1;
      statusData[s].money += deal.unit?.price || 0;
      
      const diffMs = now.getTime() - new Date(deal.updatedAt).getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      statusData[s].avgMinutes += diffMins; 
    });

    // Расчет среднего времени нахождения на этапе воронки
    Object.keys(statusData).forEach(key => {
      const data = statusData[key];
      if (data.count > 0) {
        data.avgMinutes = Math.floor(data.avgMinutes / data.count);
      }
    });

  } catch (e) {
    console.error('[Dashboard] DB error:', e);
    dbError = true;
  }

  const stats = [
    { title: 'Всего лидов', value: leadsCount.toString(), icon: <UsersIcon size={22} />, color: '#6366f1' },
    { title: 'Активные сделки', value: dealsCount.toString(), icon: <DealsIcon size={22} />, color: '#f59e0b' },
    { title: 'Выручка (факт)', value: `$${totalRevenueUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: <DollarIcon size={22} />, color: '#10b981' },
    { title: 'Конверсия', value: leadsCount > 0 ? `${Math.round((dealsCount / leadsCount) * 100)}%` : '0%', icon: <ConversionIcon size={22} />, color: '#3b82f6' },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <h1>Аналитика продаж</h1>
          <p className={styles.subtitle}>Воронка продаж · {totalDealsAll} сделок</p>
        </div>
        {dbError && (
          <div className={styles.errorBanner}>
            Ошибка БД. Проверьте .env (нужен знак ? перед параметрами)
          </div>
        )}
      </header>

      <div className={styles.statsGrid}>
        {stats.map((stat, i) => (
          <div key={i} className={styles.statCard}>
            <div className={styles.statIcon} style={{ backgroundColor: `${stat.color}15`, color: stat.color }}>
              {stat.icon}
            </div>
            <div className={styles.statInfo}>
              <span className={styles.statTitle}>{stat.title}</span>
              <h2 className={styles.statValue}>{stat.value}</h2>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.fullWidthCard}>
        <div className={styles.cardHeader}>
          <h3>Анализ воронки</h3>
        </div>
        <FunnelView 
          structure={FUNNEL_STRUCTURE} 
          statusData={statusData} 
          leadsCount={leadsCount} 
          deals={dealsWithDetails as any} 
        />
      </div>
    </div>
  );
}
