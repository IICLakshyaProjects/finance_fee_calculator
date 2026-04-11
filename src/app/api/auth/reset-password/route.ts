import { NextResponse } from 'next/server';

import { hashPassword } from '@/lib/auth/password';
import { consumePasswordResetToken, updateUserPassword } from '@/lib/server/users';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const token =
    typeof body === 'object' && body && 'token' in body ? String((body as { token: unknown }).token) : '';
  const password =
    typeof body === 'object' && body && 'password' in body
      ? String((body as { password: unknown }).password)
      : '';

  if (!token || !password || password.length < 8) {
    return NextResponse.json({ error: 'Invalid token or password' }, { status: 400 });
  }

  const consumed = await consumePasswordResetToken(token);
  if (!consumed) {
    return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
  }

  const hash = await hashPassword(password);
  await updateUserPassword(consumed.userId, hash);

  return NextResponse.json({ ok: true });
}
