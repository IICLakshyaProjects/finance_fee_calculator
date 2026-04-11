import { NextResponse } from 'next/server';

import { signAccessToken } from '@/lib/auth/jwt';
import { SESSION_COOKIE } from '@/lib/auth/constants';
import { sessionCookieOptions } from '@/lib/auth/session';
import { sessionMaxAgeSeconds } from '@/lib/auth/cookie-max-age';
import { verifyPassword } from '@/lib/auth/password';
import { isAdminRole } from '@/lib/auth/roles';
import { findUserByEmail } from '@/lib/server/users';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = typeof body === 'object' && body && 'email' in body ? String((body as { email: unknown }).email) : '';
  const password =
    typeof body === 'object' && body && 'password' in body
      ? String((body as { password: unknown }).password)
      : '';

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail) || !password || password.length < 8) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 400 });
  }

  const user = await findUserByEmail(trimmedEmail);
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const token = await signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, role: user.role },
  });
  const maxAge = sessionMaxAgeSeconds();
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
  return res;
}
