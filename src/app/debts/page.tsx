import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { extractRole } from '@/lib/roles';
import { resolveEffectiveRole } from '@/lib/serverAuth';
import { getDebtRegistry, getExemptionReasons, getGracePeriodDays, getDebtAuditSample } from '@/app/actions/debts';
import DebtsClient from './DebtsClient';

export const dynamic = 'force-dynamic';

export default async function DebtsPage({
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

  const [registry, reasons, gracePeriodDays, auditSample] = await Promise.all([
    getDebtRegistry(organizationId),
    getExemptionReasons(organizationId),
    getGracePeriodDays(organizationId),
    getDebtAuditSample(organizationId),
  ]);

  return (
    <DebtsClient
      initialRegistry={registry}
      initialReasons={reasons}
      initialGracePeriodDays={gracePeriodDays}
      initialAuditSample={auditSample}
      organizationId={organizationId}
      userRole={userRole}
      managerId={managerId}
    />
  );
}
