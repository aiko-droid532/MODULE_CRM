// Серверная авторизация (для server actions и серверных компонентов) —
// вынесена из roles.ts отдельным файлом, потому что roles.ts импортируется
// НАПРЯМУЮ из клиентских *Client.tsx компонентов (ради чистых функций вроде
// canManageDeals/UserRole), а этот файл трогает базу данных (@/lib/db → pg).
// Если бы это жило в одном файле с клиентскими импортами, webpack пытался бы
// собрать 'pg' (fs/net/tls/dns) в БРАУЗЕРНЫЙ бандл и сборка падала бы с
// "Module not found: Can't resolve 'fs'/'net'/'tls'/'dns'" — именно это и
// произошло, когда resolveEffectiveRole на время переехал в roles.ts.
// ВАЖНО: никогда не импортируйте этот файл из компонента с 'use client'.

import { UserRole, extractRole } from './roles';

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
