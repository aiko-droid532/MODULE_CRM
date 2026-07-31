import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { getDeals } from '@/app/actions/deals';
import DealsClient from './DealsClient';
import { extractRole } from '@/lib/roles';

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
      }
    } catch (e) {
      console.error('Token verification failed:', e);
    }
  }

  const deals = await getDeals(organizationId);

  return (
    <DealsClient
      initialDeals={deals}
      organizationId={organizationId}
      userRole={userRole}
      managerId={managerId}
    />
  );
}