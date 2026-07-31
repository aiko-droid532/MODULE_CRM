import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { getLeads } from '@/app/actions/leads';
import { getProjects } from '@/app/actions/units';
import ClientManagementClient from './ClientManagementClient';
import { extractRole } from '@/lib/roles';

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
      }
    } catch (e) {
      console.error('Token verification failed:', e);
    }
  }

  const [leads, projects] = await Promise.all([
    getLeads(organizationId),
    getProjects(organizationId)
  ]);

  return (
    <ClientManagementClient 
      initialLeads={leads} 
      projects={projects} 
      organizationId={organizationId}
      userRole={userRole}
      managerId={managerId}
    />
  );
}