import { randomBytes } from 'crypto';

import { NextResponse } from 'next/server';

import { getAppOrigin } from '@/lib/auth/app-url';
import { requireAdminSession } from '@/lib/auth/require-admin-api';
import { hashPassword } from '@/lib/auth/password';
import type { UserRole } from '@/lib/auth/types';
import { sendInviteSetPasswordEmail, isSmtpConfigured } from '@/lib/server/mail';
import {
  createUser,
  generateRawResetToken,
  hashResetToken,
  listUsersPaginated,
  savePasswordResetToken,
} from '@/lib/server/users';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Create-user API only allows these roles (matches admin UI). */
const CREATE_ROLES: UserRole[] = ['USER', 'ADMIN'];

function parseCreateRole(v: unknown): UserRole | null {
  if (typeof v !== 'string') return null;
  return CREATE_ROLES.includes(v as UserRole) ? (v as UserRole) : null;
}

export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const limit = Number(url.searchParams.get('limit') ?? '10');

  try {
    const result = await listUsersPaginated(
      Number.isFinite(page) ? page : 1,
      Number.isFinite(limit) ? limit : 10
    );
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  const name = typeof b.name === 'string' ? b.name : null;
  const department = typeof b.department === 'string' ? b.department : null;
  const role = parseCreateRole(b.role);

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }
  if (!role) {
    return NextResponse.json({ error: 'Invalid role (use USER or ADMIN)' }, { status: 400 });
  }

  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && !isSmtpConfigured()) {
    return NextResponse.json(
      {
        error:
          'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_FROM, and SMTP credentials in the environment.',
      },
      { status: 503 }
    );
  }

  const inviteHours = Number(process.env.INVITE_TOKEN_HOURS ?? '48');
  const inviteTtlMs =
    (Number.isFinite(inviteHours) && inviteHours > 0 ? inviteHours : 48) * 60 * 60 * 1000;

  /** Random hash so the user cannot sign in until they use the invite link. */
  const placeholderHash = await hashPassword(randomBytes(32).toString('hex'));

  try {
    const user = await createUser(email, placeholderHash, role, {
      name: name?.trim() || null,
      department: department?.trim() || null,
    });

    const raw = generateRawResetToken();
    const tokenHash = hashResetToken(raw);
    const expiresAt = new Date(Date.now() + inviteTtlMs);
    await savePasswordResetToken(user.id, tokenHash, expiresAt);

    const link = `${getAppOrigin()}/auth/reset-password?token=${encodeURIComponent(raw)}`;

    let inviteSent = false;
    if (isSmtpConfigured()) {
      try {
        await sendInviteSetPasswordEmail({
          to: user.email,
          setPasswordUrl: link,
        });
        inviteSent = true;
      } catch (e) {
        console.error('[create user invite email]', e);
        return NextResponse.json(
          {
            error:
              'User was created but the invitation email could not be sent. Check SMTP settings or share the link manually.',
            user,
            inviteLink: link,
          },
          { status: 502 }
        );
      }
    }

    return NextResponse.json(
      {
        user,
        inviteSent,
        ...(process.env.NODE_ENV !== 'production' && !inviteSent ? { inviteLink: link } : {}),
      },
      { status: 201 }
    );
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }
    console.error(e);
    return NextResponse.json({ error: 'Could not create user' }, { status: 500 });
  }
}
