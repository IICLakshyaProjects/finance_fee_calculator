import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '@/lib/auth/constants';
import { verifyAccessToken, type JwtPayload } from '@/lib/auth/jwt';
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export async function getSession(): Promise<JwtPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  return verifyAccessToken(token);
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function setSessionCookie(token: string, maxAgeSeconds: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(maxAgeSeconds));
}
