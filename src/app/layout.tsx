import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Layout from "@/components/Layout/Layout";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { extractRole, UserRole } from "@/lib/roles";
import { resolveEffectiveRole } from "@/lib/serverAuth";
import { ensureAccountTracked } from "@/app/actions/accounts";
import { isManagerTerminated } from "@/app/actions/employeeLifecycle";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sales CRM | Real Estate",
  description: "Advanced CRM for Real Estate Sales",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = cookies();
  const token = cookieStore.get('auth_token')?.value;

  let userRole = 'manager';
  let jwtRole: UserRole = 'manager';
  let managerId = '';
  let claimedEmail: string | null = null;
  let isLinked = true;
  let isTerminated = false;

  if (token) {
    try {
      const { payload } = await verifyToken(token);
      if (payload && typeof payload !== 'string') {
        jwtRole = extractRole(payload);
        managerId = (payload.sub as string) || '';
        claimedEmail = (payload as any).email || (payload as any).user_metadata?.email || null;
        const organizationId = ((payload as any).app_metadata?.organization_id as string) || '741be209-ad6f-4483-92ee-298a36899bcf';
        userRole = await resolveEffectiveRole(jwtRole, managerId);

        // Ролевая модель, фаза 2 (BR: "сотрудник входит из ERP — система создаёт
        // учётку и помещает её в очередь несвязанных"). Единственная точка,
        // через которую проходит абсолютно каждый заход в приложение — поэтому
        // отслеживание аккаунта и заглушка для несвязанных живут именно здесь,
        // а не в каждой странице отдельно.
        if (managerId) {
          const claimedName = (payload as any).name || (payload as any).user_metadata?.name || (payload as any).user_metadata?.full_name || null;
          isLinked = await ensureAccountTracked(managerId, organizationId, claimedName, claimedEmail);
          // Ролевая модель, фаза 5 (BR-B07): доступ прекращается в момент
          // увольнения — та же единственная точка входа, что и для очереди
          // несвязанных выше.
          if (isLinked) {
            isTerminated = await isManagerTerminated(managerId);
          }
        }
      }
    } catch (e) {}
  }

  // "Админ по умолчанию, без настройки": userRole учитывает CRM-роль
  // (Manager.role), которая ИМЕЕТ ПРИОРИТЕТ над токеном — если эта строка в
  // нашей БД случайно испортится (ровно так и произошло в инциденте с
  // блокировкой), userRole перестанет быть 'admin', хотя внешний токен
  // (ERP/Supabase, подписан, наша БД на него не влияет) продолжает верно
  // называть человека админом. Поэтому здесь проверяем ОБА источника —
  // человек считается админом, если так говорит хотя бы один из них.
  const isAdmin = jwtRole === 'admin' || userRole === 'admin';

  // Аварийный обход для случаев, когда и токен не задан/не про того человека
  // (например, работаем от имени HR/другого лица) — список id/email в
  // переменных окружения ВСЕГДА проходит мимо обоих экранов ниже. Пусто по
  // умолчанию — поведение не меняется, пока не задано.
  const superAdminIds = (process.env.SUPER_ADMIN_MANAGER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const superAdminEmails = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const isSuperAdminOverride =
    (!!managerId && superAdminIds.includes(managerId)) ||
    (!!claimedEmail && superAdminEmails.includes(claimedEmail.toLowerCase()));

  // BR-B07: доступ прекращается в момент увольнения. Админ теперь тоже
  // исключение (симметрично гейту "не привязан" ниже) — блокировка входа
  // ВСЕМ сразу недопустима, даже если это защищает от одного уволенного
  // админа; настоящая защита от "последнего админа" — BR-B12 в
  // employeeLifecycle.ts (wouldRemoveLastAdmin), которая не даёт увольнению
  // произойти в первую очередь.
  if (token && managerId && isTerminated && !isAdmin && !isSuperAdminOverride) {
    return (
      <html lang="en">
        <body className={inter.className}>
          <div style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#f8fafc', padding: '24px',
          }}>
            <div style={{
              maxWidth: '440px', background: 'white', border: '1px solid #fecaca', borderRadius: '16px',
              padding: '32px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔒</div>
              <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#991b1b', margin: '0 0 10px 0' }}>
                Доступ прекращён
              </h1>
              <p style={{ color: '#64748b', fontSize: '0.92rem', lineHeight: 1.5, margin: 0 }}>
                Ваша учётная запись отключена от этой системы. Если это ошибка — обратитесь к администратору.
              </p>
            </div>
          </div>
        </body>
      </html>
    );
  }

  // До связывания учётной записи с карточкой сотрудника показываем понятный
  // экран вместо пустых списков (TO-BE "Приём нового менеджера"). Админ —
  // исключение: иначе некому будет зайти и связать аккаунты в /departments.
  if (token && managerId && !isLinked && !isAdmin && !isSuperAdminOverride) {
    return (
      <html lang="en">
        <body className={inter.className}>
          <div style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#f8fafc', padding: '24px',
          }}>
            <div style={{
              maxWidth: '440px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px',
              padding: '32px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>⏳</div>
              <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', margin: '0 0 10px 0' }}>
                Ваша учётная запись пока не привязана
              </h1>
              <p style={{ color: '#64748b', fontSize: '0.92rem', lineHeight: 1.5, margin: 0 }}>
                Вход выполнен успешно, но администратор ещё не связал вашу учётную запись
                с карточкой сотрудника в CRM. Как только это произойдёт, здесь появятся
                ваши сделки и клиенты. Обратитесь к администратору.
              </p>
            </div>
          </div>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body className={inter.className}>
        <Layout userRole={userRole}>{children}</Layout>
      </body>
    </html>
  );
}