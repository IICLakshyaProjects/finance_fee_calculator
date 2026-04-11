import { NextResponse } from 'next/server';

import { getAppOrigin } from '@/lib/auth/app-url';
import { findUserByEmail, savePasswordResetToken, generateRawResetToken, hashResetToken } from '@/lib/server/users';
import { isSmtpConfigured, sendPasswordResetEmail } from '@/lib/server/mail';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const link = `${getAppOrigin()}/auth/reset-password?token=${encodeURIComponent(raw)}`;

  if (isSmtpConfigured()) {
    try {
      await sendPasswordResetEmail({ to: user.email, resetUrl: link });
    } catch (e) {
      console.error('[forgot-password] SMTP', e);
    }
  } else if (process.env.NODE_ENV === 'development') {
    console.info('[dev] Password reset link (SMTP not configured):', link);
  }

  return NextResponse.json({
    ok: true,
    ...(process.env.NODE_ENV === 'development' ? { resetLink: link } : {}),
  });
}
