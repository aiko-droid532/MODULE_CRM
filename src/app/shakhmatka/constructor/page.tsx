export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { getProjectsLite } from '@/app/actions/units';
import ConstructorClient from './ConstructorClient';

export default async function ConstructorPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const cookieStore = cookies();
  const token = searchParams.token || cookieStore.get('auth_token')?.value;

  let organizationId = 'default';

  if (token) {
    try {
      const { payload } = await verifyToken(token);
      if (payload && typeof payload !== 'string') {
        organizationId = ((payload as any).app_metadata?.organization_id as string) || '741be209-ad6f-4483-92ee-298a36899bcf';
      }
    } catch (e) {
      console.error('Token verification failed:', e);
    }
  }

  const projects = await getProjectsLite(organizationId);

  return (
    <ConstructorClient
      projects={projects}
      organizationId={organizationId}
    />
  );
}