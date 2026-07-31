// Центральный файл ролей модуля ОП
// Роль читается из JWT app_metadata.role

export type UserRole =
  | 'admin'
  | 'rop'
  | 'senior_manager'
  | 'manager'
  | 'lawyer'
  | 'marketing'
  | 'call_center';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Администратор',
  rop: 'Руководитель ОП',
  senior_manager: 'Главный менеджер',
  manager: 'Менеджер',
  lawyer: 'Юрист',
  marketing: 'Маркетинг',
  call_center: 'Колл-центр',
};

// ─── Навигация ────────────────────────────────────────────────────────────────
// Список разделов которые роль может видеть в меню
export const NAV_ACCESS: Record<UserRole, string[]> = {
  admin:          ['analytics', 'clients', 'deals', 'shakhmatka', 'pricing', 'contracts', 'finance', 'reports'],
  rop:            ['analytics', 'clients', 'deals', 'shakhmatka', 'pricing', 'contracts', 'finance', 'reports'],
  senior_manager: ['analytics', 'clients', 'deals', 'shakhmatka', 'pricing', 'contracts', 'finance'],
  manager:        ['analytics', 'clients', 'deals', 'shakhmatka', 'pricing', 'contracts', 'finance'],
  lawyer:         ['analytics', 'clients', 'deals', 'shakhmatka', 'pricing', 'contracts', 'finance', 'reports'],
  marketing:      ['analytics'],
  call_center:    ['analytics'],
};

// ─── Права ────────────────────────────────────────────────────────────────────

// Может создавать/редактировать помещения и корпуса в шахматке
export function canManageUnits(role: UserRole): boolean {
  return ['admin', 'rop', 'senior_manager'].includes(role);
}

// Может менять цены на помещения
export function canManagePrices(role: UserRole): boolean {
  return ['admin', 'rop', 'senior_manager'].includes(role);
}

// ── Индивидуальная скидка (раздел "Скидка" в калькуляторе рассрочки) ────────
// Пороги согласования по ролям — раздел 3 ТЗ "Акции и специальные предложения".
// В оригинальном ТЗ пороги завязаны на Back-office/Топ-менеджмент/Совет директоров,
// которых в нашей ролевой модели нет — согласовано, что маппим по нарастающей:
// manager → senior_manager → rop → admin.
const DISCOUNT_THRESHOLDS: Record<UserRole, number> = {
  manager: 3,
  senior_manager: 5,
  rop: 10,
  admin: Infinity,
  lawyer: 0,
  marketing: 0,
  call_center: 0,
};

// Максимальный % скидки, который роль может сохранить самостоятельно
export function getMaxDiscountPercent(role: UserRole): number {
  return DISCOUNT_THRESHOLDS[role] ?? 0;
}

// Может ли роль сохранить скидку данного размера (в %) без дополнительного согласования
export function canApplyDiscountPercent(role: UserRole, percent: number): boolean {
  return percent <= getMaxDiscountPercent(role);
}

// Кто должен согласовать скидку такого размера — для текста подсказки в интерфейсе
export function getRequiredApproverLabel(percent: number): string {
  if (percent <= 3) return 'Менеджер';
  if (percent <= 5) return 'Старший менеджер';
  if (percent <= 10) return 'Руководитель ОП';
  return 'Администратор';
}

// Может создавать черновик акции (конструктор акций)
export function canCreatePromotions(role: UserRole): boolean {
  return ['admin', 'rop', 'senior_manager', 'manager'].includes(role);
}

// Может согласовывать, редактировать и удалять акции — только руководитель ОП и админ
export function canApprovePromotions(role: UserRole): boolean {
  return ['admin', 'rop'].includes(role);
}

// Видит раздел Отчёты
export function canViewReports(role: UserRole): boolean {
  return ['admin', 'rop', 'lawyer'].includes(role);
}

// Может создавать/редактировать сделки и лиды
export function canManageDeals(role: UserRole): boolean {
  return ['admin', 'rop', 'senior_manager', 'manager'].includes(role);
}

// Видит все сделки (не только свои)
export function canViewAllDeals(role: UserRole): boolean {
  return ['admin', 'rop', 'senior_manager', 'lawyer'].includes(role);
}

// Видит все договора (не только свои)
export function canViewAllContracts(role: UserRole): boolean {
  return ['admin', 'rop', 'senior_manager', 'lawyer'].includes(role);
}

// Может создавать/изменять договора
export function canManageContracts(role: UserRole): boolean {
  return ['admin', 'rop', 'senior_manager', 'manager'].includes(role);
}

// Может согласовывать (утверждать/отклонять) договор — только руководитель ОП и админ
export function canApproveContracts(role: UserRole): boolean {
  return ['admin', 'rop'].includes(role);
}

// Может оставлять комментарии-уточнения к договорам — только юрист, руководитель ОП и админ
export function canCommentContracts(role: UserRole): boolean {
  return ['admin', 'rop', 'lawyer'].includes(role);
}

// Видит все финансы (не только по своим договорам)
export function canViewAllFinance(role: UserRole): boolean {
  return ['admin', 'rop', 'senior_manager', 'lawyer'].includes(role);
}

// Может выполнять финансовые операции (создавать платежи и т.д.)
export function canManageFinance(role: UserRole): boolean {
  return ['admin', 'rop', 'senior_manager'].includes(role);
}

// Режим только чтения — видит всё но ничего не меняет
export function isReadOnly(role: UserRole): boolean {
  return ['lawyer', 'marketing', 'call_center'].includes(role);
}

// Может управлять пользователями и настройками платформы
export function canManageSystem(role: UserRole): boolean {
  return role === 'admin';
}

// ─── Утилиты ──────────────────────────────────────────────────────────────────

// Парсим роль из JWT payload (app_metadata.role)
export function extractRole(payload: any): UserRole {
  const role =
    payload?.app_metadata?.role ||
    payload?.app_metadata?.user_role ||
    payload?.user_metadata?.role ||
    payload?.role;

  const valid: UserRole[] = ['admin', 'rop', 'senior_manager', 'manager', 'lawyer', 'marketing', 'call_center'];
  if (role && valid.includes(role)) return role as UserRole;

  // Дефолт — самые минимальные права
  return 'manager';
}

// Проверяет есть ли у роли доступ к разделу навигации
export function hasNavAccess(role: UserRole, section: string): boolean {
  return NAV_ACCESS[role]?.includes(section) ?? false;
}

// ─── Серверная авторизация (для server actions) ────────────────────────────
// ВАЖНО: канбан-кнопки на фронтенде — это только UI. Реальная защита
// server actions (createDeal, updateLeadStatus, massUpdatePrices и т.д.)
// должна происходить здесь, потому что server action — это обычный
// сетевой эндпоинт, который можно вызвать напрямую в обход кнопок.

export class ForbiddenError extends Error {
  constructor(action: string) {
    super(`Доступ запрещён: недостаточно прав для действия "${action}"`);
    this.name = 'ForbiddenError';
  }
}

// Достаёт роль текущего пользователя из cookie auth_token (только для server actions/'use server' файлов)
export async function getCurrentRole(): Promise<UserRole> {
  const { cookies } = await import('next/headers');
  const { verifyToken } = await import('./auth');

  const token = cookies().get('auth_token')?.value;
  if (!token) return 'manager'; // дефолт как и в extractRole — минимальные права

  const { payload } = await verifyToken(token);
  if (!payload) return 'manager';

  return extractRole(payload);
}

// Достаёт id текущего пользователя (payload.sub) — для записи managerId в AuditLog и т.п.
export async function getCurrentManagerId(): Promise<string> {
  const { cookies } = await import('next/headers');
  const { verifyToken } = await import('./auth');

  const token = cookies().get('auth_token')?.value;
  if (!token) return 'system';

  const { payload } = await verifyToken(token);
  if (!payload || typeof payload === 'string') return 'system';

  return (payload.sub as string) || 'system';
}

// Бросает ForbiddenError, если роль не проходит проверку check().
// Использование внутри server action:
//   const role = await requireRole(canManageDeals, 'изменение статуса лида');
export async function requireRole(
  check: (role: UserRole) => boolean,
  actionLabel: string
): Promise<UserRole> {
  const role = await getCurrentRole();
  if (!check(role)) {
    throw new ForbiddenError(actionLabel);
  }
  return role;
}