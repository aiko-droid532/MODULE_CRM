import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { getLeads } from '@/app/actions/leads';
import { getProjectsLite } from '@/app/actions/units';
import { getVisibleManagerIds, getVisibleDepartmentIds } from '@/app/actions/departments';
import { escalateExpiredLeads, getDepartmentPool } from '@/app/actions/leadDistribution';
import { getEffectiveManagerIds } from '@/app/actions/employeeLifecycle';
import ClientManagementClient from './ClientManagementClient';
import { extractRole, resolveEffectiveRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const cookieStore = cookies();
  const token = cookieStore.get('auth_token')?.value;
  
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

  // SLA на распределение (BR-B09) — проверяем на каждом заходе на страницу,
  // как и checkAndReleaseExpiredBookings в шахматке (в проекте нет крона).
  await escalateExpiredLeads(organizationId);

  const visibleDepartmentIds = await getVisibleDepartmentIds(userRole as any, managerId, organizationId);

  const [leads, projects, visibleManagerIds, departmentPool, effectiveManagerIds] = await Promise.all([
    getLeads(organizationId),
    getProjectsLite(organizationId),
    getVisibleManagerIds(userRole as any, managerId, organizationId),
    getDepartmentPool(organizationId, visibleDepartmentIds),
    getEffectiveManagerIds(managerId, organizationId),
  ]);

  return (
    <ClientManagementClient
      initialLeads={leads}
      projects={projects}
      visibleManagerIds={visibleManagerIds}
      departmentPool={departmentPool}
      effectiveManagerIds={effectiveManagerIds}
      organizationId={organizationId}
      userRole={userRole}
      managerId={managerId}
    />
  );
}