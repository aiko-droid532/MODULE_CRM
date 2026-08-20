export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { getProjects } from '@/app/actions/units';
import { getLeadsList, checkAndReleaseExpiredBookings } from '@/app/actions/booking';
import ShakhmatkaClient from './ShakhmatkaClient';
import { extractRole } from '@/lib/roles';

export default async function ShakhmatkaPage({
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

  await checkAndReleaseExpiredBookings();

  const [projects, leads] = await Promise.all([
    getProjects(organizationId),
    getLeadsList(organizationId)
  ]);

  return (
    <ShakhmatkaClient 
      projects={projects} 
      leads={leads} 
      organizationId={organizationId} 
      userRole={userRole}
      managerId={managerId}
    />
  );
}