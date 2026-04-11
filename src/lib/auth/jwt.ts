import { SignJWT, jwtVerify } from 'jose';

import type { UserRole } from '@/lib/auth/types';

export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
};

function getSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET must be set and at least 16 characters');
  }
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(payload: JwtPayload): Promise<string> {
  const exp = process.env.JWT_EXPIRES_IN?.trim() || '1d';
  return new SignJWT({
    email: payload.email,
    role: payload.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(getSecretKey());
}

export async function verifyAccessToken(token: string): Promise<JwtPayload | null> {
  let key: Uint8Array;
  try {
    key = getSecretKey();
  } catch {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, key);
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email : '';
    const role = payload.role as UserRole;
    if (!sub || !email) {
      return null;
    }
    if (
      role !== 'ADMIN' &&
      role !== 'SUPER_ADMIN' &&
      role !== 'USER' &&
      role !== 'SUB_ADMIN'
    ) {
      return null;
    }
    return { sub, email, role };
  } catch {
    return null;
  }
}
