import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';
import { isAdminRole } from '@/lib/auth/roles';

/**
 * Server-side guard for the admin panel (in addition to middleware).
 */
export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !isAdminRole(session.role)) {
    redirect('/admin/login');
  }
  return children;
}
