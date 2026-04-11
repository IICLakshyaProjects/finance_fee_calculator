import { NextResponse } from 'next/server';

import { requireAdminSession } from '@/lib/auth/require-admin-api';
import { hashPassword } from '@/lib/auth/password';
import type { UserRole } from '@/lib/auth/types';
import { softDeleteUserById, updateUserById } from '@/lib/server/users';

const ROLES: UserRole[] = ['USER', 'SUB_ADMIN', 'ADMIN', 'SUPER_ADMIN'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRole(v: unknown): UserRole | null {
  if (typeof v !== 'string') return null;
  return ROLES.includes(v as UserRole) ? (v as UserRole) : null;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const update: Parameters<typeof updateUserById>[1] = {};

  if ('name' in b) {
    update.name = typeof b.name === 'string' ? b.name : null;
  }
  if ('department' in b) {
    update.department = typeof b.department === 'string' ? b.department : null;
  }
  if ('status' in b) {
    const s = b.status;
    if (s !== 'ACTIVE' && s !== 'INACTIVE') {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    update.status = s;
  }
  if ('role' in b && b.role !== undefined) {
    const role = parseRole(b.role);
    if (!role) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    if (role === 'SUPER_ADMIN' && auth.session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    update.role = role;
  }

  if ('email' in b && b.email !== undefined) {
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }
    update.email = email;
  }

  if (typeof b.password === 'string' && b.password.length > 0) {
    if (b.password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    update.passwordHash = await hashPassword(b.password);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    const user = await updateUserById(id, update);
    if (!user) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ user });
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'Email conflict' }, { status: 409 });
    }
    console.error(e);
    return NextResponse.json({ error: 'Could not update user' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (id === auth.session.sub) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
  }

  const ok = await softDeleteUserById(id);
  if (!ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
