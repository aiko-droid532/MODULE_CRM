// Общие типы/константы статусов реестра задолженности — вынесены из debts.ts,
// потому что файлы с 'use server' могут экспортировать только async-функции.

export type DebtRowStatus = 'PENDING' | 'OVERDUE' | 'PARTIALLY_PAID' | 'PAID' | 'EXEMPTED' | 'CONTRACT_CANCELLED_UNPAID';

export const DEBT_STATUS_LABELS: Record<DebtRowStatus, string> = {
  PENDING: 'Ожидается',
  OVERDUE: 'Просрочена',
  PARTIALLY_PAID: 'Частично оплачена',
  PAID: 'Оплачена',
  EXEMPTED: 'Освобождена',
  CONTRACT_CANCELLED_UNPAID: 'Договор расторгнут, долг не погашен',
};
