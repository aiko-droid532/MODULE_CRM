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
  admin:          ['analytics', 'clients', 'deals', 'shakhmatka', 'pricing', 'contracts', 'finance', 'reports', 'debts', 'departments'],
  rop:            ['analytics', 'clients', 'deals', 'shakhmatka', 'pricing', 'contracts', 'finance', 'reports', 'debts', 'departments'],
  senior_manager: ['analytics', 'clients', 'deals', 'shakhmatka', 'pricing', 'contracts', 'finance', 'debts'],
  manager:        ['analytics', 'clients', 'deals', 'shakhmatka', 'pricing', 'contracts', 'finance', 'debts'],
  lawyer:         ['analytics', 'clients', 'deals', 'shakhmatka', 'pricing', 'contracts', 'finance', 'reports'],
  marketing:      ['analytics'],
  // call_center получает доступ к разделу "Клиенты" (пул нераспределённых
  // лидов, первичная квалификация) — Ролевая модель, фаза 3, TO-BE "Работа
  // маркетинга"/"Распределение входящего лида". Раньше был фактически исключён.
  call_center:    ['analytics', 'clients'],
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
//
// Ролевая модель, фаза 4 (BR-B05): "Порог самостоятельной скидки — параметр
// коммерческой политики, а не свойство программы" — эти значения теперь только
// ДЕФОЛТ для организаций, которые ещё не настроили свои пороги через интерфейс
// (см. actions/discountPolicy.ts, /departments). Функции ниже принимают
// необязательный параметр thresholds — передавайте туда результат
// getDiscountThresholds(organizationId), если он уже загружен; без него
// поведение остаётся ровно таким же, как было до фазы 4.
export const DEFAULT_DISCOUNT_THRESHOLDS: Record<UserRole, number> = {
  manager: 3,
  senior_manager: 5,
  rop: 10,
  admin: Infinity,
  lawyer: 0,
  marketing: 0,
  call_center: 0,
};

// Максимальный % скидки, который роль может сохранить самостоятельно
export function getMaxDiscountPercent(role: UserRole, thresholds?: Record<string, number>): number {
  const table = thresholds || DEFAULT_DISCOUNT_THRESHOLDS;
  return table[role] ?? 0;
}

// Может ли роль сохранить скидку данного размера (в %) без дополнительного согласования
export function canApplyDiscountPercent(role: UserRole, percent: number, thresholds?: Record<string, number>): boolean {
  return percent <= getMaxDiscountPercent(role, thresholds);
}

// Кто должен согласовать скидку такого размера — для текста подсказки в интерфейсе.
// Реально согласовать заявку (approveDiscountRequest/rejectDiscountRequest) может только
// роль с canApprovePromotions (rop/admin) — senior_manager кнопки согласования не видит
// и провести согласование не может, поэтому "Старший менеджер" как отдельная ступень
// здесь не указывается, чтобы не вводить в заблуждение (границы берём из thresholds).
export function getRequiredApproverLabel(percent: number, thresholds?: Record<string, number>): string {
  if (percent <= getMaxDiscountPercent('manager', thresholds)) return 'Менеджер';
  if (percent <= getMaxDiscountPercent('rop', thresholds)) return 'Руководитель ОП';
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

// ─── Отделы (Ролевая модель) ──────────────────────────────────────────────────

// Создание/переименование/удаление отдела, назначение руководителя отдела —
// только администратор (RACI: "Создание отдела" R,A = Админ).
export function canManageDepartments(role: UserRole): boolean {
  return role === 'admin';
}

// Включение сотрудника в отдел / перевод между отделами — РОП или администратор
// (RACI: "Включение сотрудника в отдел" R,A = РОП, R = Админ).
export function canAssignDepartmentMembership(role: UserRole): boolean {
  return ['admin', 'rop'].includes(role);
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

// ── Эффективная роль (Ролевая модель, фаза 2) ───────────────────────────────
// Роль во внешнем токене (ERP/Supabase) мы изменить не можем — нет доступа к
// их admin API. Поэтому CRM-назначенная роль (Manager.role/roleExpiresAt)
// имеет ПРИОРИТЕТ над токеном, пока не истекла — единственный способ выдавать
// полномочия "на период" (см. accounts.ts: linkAccountToCard/setManagerRole).
// Живёт в roles.ts (а не в accounts.ts), чтобы не образовался цикл импортов —
// accounts.ts и так уже импортирует requireRole/canManageSystem отсюда.
export async function resolveEffectiveRole(jwtRole: UserRole, managerId: string): Promise<UserRole> {
  if (!managerId) return jwtRole;
  try {
    const { db } = await import('./db');
    const rows: any[] = await db.$queryRaw`
      SELECT "role", "roleExpiresAt" FROM "Manager" WHERE id = ${managerId} LIMIT 1
    `;
    const m = rows[0];
    if (!m || !m.role) return jwtRole;
    if (m.roleExpiresAt && new Date(m.roleExpiresAt) < new Date()) return jwtRole; // срок вышел — откат к токену
    return m.role as UserRole;
  } catch (error) {
    // Колонки ещё не созданы (ленивая миграция в accounts.ts) или БД недоступна —
    // никогда не блокируем вход из-за этого, просто используем роль из токена.
    return jwtRole;
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

  const jwtRole = extractRole(payload);
  const managerId = (typeof payload !== 'string' && (payload as any).sub) || '';
  return resolveEffectiveRole(jwtRole, managerId);
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