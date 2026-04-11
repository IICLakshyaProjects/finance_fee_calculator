import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { verifyAccessToken } from '@/lib/auth/jwt';
import { isAdminRole, isUserAppRole } from '@/lib/auth/roles';
import { SESSION_COOKIE } from '@/lib/auth/constants';

/** Normalize so `/home/` and `/home` behave the same (trailing slash bypassed matchers before). */
function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '') || '/';
  }
  return pathname;
}

function redirect(request: NextRequest, pathname: string, search?: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search ?? '';
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  if (request.method === 'OPTIONS') {
    return NextResponse.next();
  }

  const pathname = normalizePathname(request.nextUrl.pathname);
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  const session = token ? await verifyAccessToken(token) : null;
  const role = session?.role;

  if (pathname === '/admin/login') {
    if (isAdminRole(role)) {
      return redirect(request, '/admin/dashboard');
    }
    return NextResponse.next();
  }

  if (pathname === '/auth/login') {
    if (isUserAppRole(role)) {
      return redirect(request, '/home');
    }
    if (isAdminRole(role)) {
      return redirect(request, '/admin/dashboard');
    }
    return NextResponse.next();
  }

  if (pathname === '/auth/forgot-password' || pathname.startsWith('/auth/reset-password')) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/fees')) {
    const isMutation =
      request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS';

    if (isMutation) {
      if (!isAdminRole(role)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.next();
    }

    if (isUserAppRole(role) || isAdminRole(role)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (pathname === '/api/auth/me') {
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname === '/api/users' || pathname.startsWith('/api/users/')) {
    if (!session || !isAdminRole(role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname === '/') {
    if (!isUserAppRole(role)) {
      if (isAdminRole(role)) {
        return redirect(request, '/admin/dashboard');
      }
      return redirect(request, '/auth/login');
    }
    return redirect(request, '/home');
  }

  if (pathname === '/home') {
    if (!isUserAppRole(role)) {
      if (isAdminRole(role)) {
        return redirect(request, '/admin/dashboard');
      }
      return redirect(request, '/auth/login');
    }
    return NextResponse.next();
  }

  /** Alias often typed instead of `/admin/dashboard` */
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    if (isAdminRole(role)) {
      return redirect(request, '/admin/dashboard');
    }
    if (isUserAppRole(role)) {
      return redirect(request, '/home');
    }
    return redirect(request, '/auth/login');
  }

  if (pathname === '/admin') {
    if (isAdminRole(role)) {
      return redirect(request, '/admin/dashboard');
    }
    if (isUserAppRole(role)) {
      return redirect(request, '/home');
    }
    return redirect(request, '/admin/login');
  }

  if (pathname.startsWith('/admin/')) {
    if (!isAdminRole(role)) {
      if (isUserAppRole(role)) {
        return redirect(request, '/home');
      }
      const url = request.nextUrl.clone();
      url.pathname = '/admin/login';
      url.search = '';
      url.searchParams.set('from', pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/home',
    '/home/',
    '/dashboard',
    '/dashboard/:path*',
    '/admin',
    '/admin/:path*',
    '/auth/login',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/api/fees',
    '/api/fees/:path*',
    '/api/users',
    '/api/users/:path*',
    '/api/auth/me',
  ],
};
