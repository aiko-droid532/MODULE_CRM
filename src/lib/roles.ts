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
// администратор или РОП. В ТЗ по RACI "Создание отдела" R,A = Админ, но на
// практике отделы фактически заводит и наполняет именно РОП, а не админ —
// решено дать это право и ему (2026-08-21).
export function canManageDepartments(role: UserRole): boolean {
  return ['admin', 'rop'].includes(role);
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

// ─── Серверная авторизация ──────────────────────────────────────────────────
// ForbiddenError, requireRole, getCurrentRole, getCurrentManagerId,
// resolveEffectiveRole переехали в lib/serverAuth.ts — этот файл (roles.ts)
// импортируется НАПРЯМУЮ из клиентских *Client.tsx компонентов (canManageDeals,
// UserRole и т.п.), и любая ссылка на @/lib/db здесь (даже динамический
// import внутри неиспользуемой на клиенте функции) заставляет webpack
// пытаться собрать пакет 'pg' в браузерный бандл — сборка падает на
// fs/net/tls/dns. См. серверный файл для деталей и импортируйте оттуда.