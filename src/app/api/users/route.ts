import { NextResponse } from 'next/server';

import { requireAdminSession } from '@/lib/auth/require-admin-api';
import { hashPassword } from '@/lib/auth/password';
import type { UserRole } from '@/lib/auth/types';
import { createUser, listUsersPaginated } from '@/lib/server/users';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: UserRole[] = ['USER', 'SUB_ADMIN', 'ADMIN', 'SUPER_ADMIN'];

function parseRole(v: unknown): UserRole | null {
  if (typeof v !== 'string') return null;
  return ROLES.includes(v as UserRole) ? (v as UserRole) : null;
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
  const password = typeof b.password === 'string' ? b.password : '';
  const name = typeof b.name === 'string' ? b.name : null;
  const department = typeof b.department === 'string' ? b.department : null;
  const role = parseRole(b.role);

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }
  if (!role) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  if (role === 'SUPER_ADMIN' && auth.session.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const hash = await hashPassword(password);
    const user = await createUser(email, hash, role, {
      name: name?.trim() || null,
      department: department?.trim() || null,
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }
    console.error(e);
    return NextResponse.json({ error: 'Could not create user' }, { status: 500 });
  }
}
