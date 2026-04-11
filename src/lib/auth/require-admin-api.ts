import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth/session';
import { isAdminRole } from '@/lib/auth/roles';

export async function requireAdminSession() {
  const session = await getSession();
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  if (!isAdminRole(session.role)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }
  return { ok: true as const, session };
}
