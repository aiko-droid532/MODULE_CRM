// Общие типы/константы статусов реестра задолженности — вынесены из debts.ts,
// потому что файлы с 'use server' могут экспортировать только async-функции.

export type DebtRowStatus = 'PENDING' | 'OVERDUE' | 'PARTIALLY_PAID' | 'PAID' | 'EXEMPTED' | 'CONTRACT_CANCELLED_UNPAID';

// Согласовано с "платёж" (мужской род) — статус относится к строке графика платежей, а не к сделке/оплате.
export const DEBT_STATUS_LABELS: Record<DebtRowStatus, string> = {
  PENDING: 'Ожидается',
  OVERDUE: 'Просрочен',
  PARTIALLY_PAID: 'Частично оплачен',
  PAID: 'Оплачен',
  EXEMPTED: 'Освобождён',
  CONTRACT_CANCELLED_UNPAID: 'Договор расторгнут, долг не погашен',
};
