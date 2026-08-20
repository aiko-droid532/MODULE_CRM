import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { extractRole } from '@/lib/roles';
import { resolveEffectiveRole } from '@/lib/serverAuth';
import { getDepartments, getManagersWithDepartment } from '@/app/actions/departments';
import { getUnlinkedAccounts, getPendingManagerCards, getPermissionAuditLog } from '@/app/actions/accounts';
import { getProjectsWithDepartment, getDistributionSettings } from '@/app/actions/leadDistribution';
import { getDiscountThresholds } from '@/app/actions/discountPolicy';
import { getSubstitutions } from '@/app/actions/employeeLifecycle';
import DepartmentsClient from './DepartmentsClient';

export const dynamic = 'force-dynamic';

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const cookieStore = cookies();
  const token = searchParams.token || cookieStore.get('auth_token')?.value;

  let organizationId = 'default';
  let userRole = 'manager';
  let managerId = '';

  if (token) {
    try {
      const { payload } = await verifyToken(token);
      if (payload && typeof payload !== 'string') {
        organizationId = ((payload as any).app_metadata?.organization_id as string) || '741be209-ad6f-4483-92ee-298a36899bcf';
        userRole = extractRole(payload);
        managerId = (payload.sub as string) || '';
        userRole = await resolveEffectiveRole(userRole as any, managerId);
      }
    } catch (e) {
      console.error('Token verification failed:', e);
    }
  }

  // Очередь несвязанных учёток, черновики карточек и журнал изменения прав —
  // видны только админу/РОП (сами server actions тоже это перепроверяют).
  const isAdminOrRop = userRole === 'admin' || userRole === 'rop';
  const [departments, managers, unlinkedAccounts, pendingCards, auditLog, projects, distributionSettings, discountThresholds, substitutions] = await Promise.all([
    getDepartments(organizationId),
    getManagersWithDepartment(organizationId),
    isAdminOrRop ? getUnlinkedAccounts(organizationId) : Promise.resolve([]),
    isAdminOrRop ? getPendingManagerCards(organizationId) : Promise.resolve([]),
    isAdminOrRop ? getPermissionAuditLog(organizationId) : Promise.resolve([]),
    isAdminOrRop ? getProjectsWithDepartment(organizationId) : Promise.resolve([]),
    getDistributionSettings(organizationId),
    userRole === 'admin' ? getDiscountThresholds(organizationId) : Promise.resolve(null),
    userRole === 'admin' ? getSubstitutions(organizationId) : Promise.resolve([]),
  ]);

  return (
    <DepartmentsClient
      initialDepartments={departments}
      initialManagers={managers}
      initialUnlinkedAccounts={unlinkedAccounts}
      initialPendingCards={pendingCards}
      initialAuditLog={auditLog}
      initialProjects={projects}
      initialDistributionSettings={distributionSettings}
      initialDiscountThresholds={discountThresholds}
      initialSubstitutions={substitutions}
      organizationId={organizationId}
      userRole={userRole}
      managerId={managerId}
    />
  );
}
