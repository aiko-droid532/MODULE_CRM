export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { getTemplates, getContractsList, getDealsForContract } from '@/app/actions/contracts';
import ContractsClient from './ContractsClient';
import { extractRole } from '@/lib/roles';

export default async function ContractsPage({
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

  const [templates, contracts, deals] = await Promise.all([
    getTemplates(organizationId),
    getContractsList(organizationId, userRole, managerId),
    getDealsForContract(organizationId, userRole, managerId)
  ]);

  return (
    <ContractsClient 
      initialTemplates={templates} 
      initialContracts={contracts} 
      deals={deals}
      organizationId={organizationId}
      userRole={userRole}
      managerId={managerId}
    />
  );
}