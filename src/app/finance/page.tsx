import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { getBankTransactions, getPendingSchedules } from '@/app/actions/finance';
import FinanceClient from './FinanceClient';
import { extractRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

export default async function FinancePage({
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

  const transactions = await getBankTransactions(organizationId);
  const pendingSchedules = await getPendingSchedules(organizationId);

  return (
    <FinanceClient 
      initialTransactions={transactions}
      initialSchedules={pendingSchedules}
      organizationId={organizationId}
      userRole={userRole}
      managerId={managerId}
    />
  );
}