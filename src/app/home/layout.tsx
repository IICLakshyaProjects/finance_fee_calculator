import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';
import { isUserAppRole } from '@/lib/auth/roles';

/**
 * Server-side guard (in addition to middleware) so `/home` cannot be served without a valid session.
 */
export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !isUserAppRole(session.role)) {
    redirect('/auth/login');
  }
  return children;
}
