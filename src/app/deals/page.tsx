import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { getDeals } from '@/app/actions/deals';
import { getVisibleManagerIds } from '@/app/actions/departments';
import { getEffectiveManagerIds } from '@/app/actions/employeeLifecycle';
import DealsClient from './DealsClient';
import { extractRole } from '@/lib/roles';
import { resolveEffectiveRole } from '@/lib/serverAuth';

export default async function DealsPage({
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
        // Ролевая модель, фаза 2: CRM-назначенная роль (с истечением) имеет
        // приоритет над ролью из токена — см. lib/roles.ts.
        userRole = await resolveEffectiveRole(userRole as any, managerId);
      }
    } catch (e) {
      console.error('Token verification failed:', e);
    }
  }

  const [deals, visibleManagerIds, effectiveManagerIds] = await Promise.all([
    getDeals(organizationId),
    getVisibleManagerIds(userRole as any, managerId, organizationId),
    getEffectiveManagerIds(managerId, organizationId),
  ]);

  return (
    <DealsClient
      initialDeals={deals}
      visibleManagerIds={visibleManagerIds}
      effectiveManagerIds={effectiveManagerIds}
      organizationId={organizationId}
      userRole={userRole}
      managerId={managerId}
    />
  );
}