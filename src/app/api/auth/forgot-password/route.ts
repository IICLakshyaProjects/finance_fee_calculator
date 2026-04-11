import { NextResponse } from 'next/server';

import { findUserByEmail, savePasswordResetToken, generateRawResetToken, hashResetToken } from '@/lib/server/users';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function appOrigin() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000';
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email =
    typeof body === 'object' && body && 'email' in body ? String((body as { email: unknown }).email).trim() : '';

  if (!email || !EMAIL_RE.test(email.toLowerCase())) {
    return NextResponse.json({ ok: true });
  }

  const user = await findUserByEmail(email);
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const raw = generateRawResetToken();
  const tokenHash = hashResetToken(raw);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  try {
    await savePasswordResetToken(user.id, tokenHash, expiresAt);
  } catch (e) {
    console.error('[forgot-password]', e);
    return NextResponse.json({ ok: true });
  }

  const link = `${appOrigin().replace(/\/$/, '')}/auth/reset-password?token=${encodeURIComponent(raw)}`;

  if (process.env.NODE_ENV === 'development') {
    console.info('[dev] Password reset link:', link);
  }

  return NextResponse.json({
    ok: true,
    ...(process.env.NODE_ENV === 'development' ? { resetLink: link } : {}),
  });
}
