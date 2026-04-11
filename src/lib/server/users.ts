import { randomBytes, createHash, randomUUID } from 'crypto';

import { pool } from '@/lib/server/pg';
import type { UserRole } from '@/lib/auth/types';

let authTablesReady = false;

export async function ensureAuthTables(): Promise<void> {
  if (!pool || authTablesReady) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN', 'SUPER_ADMIN', 'USER', 'SUB_ADMIN')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await pool.query(`
    ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('ADMIN', 'SUPER_ADMIN', 'USER', 'SUB_ADMIN'))
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_tokens(expires_at);
  `);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT`);
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE'`
  );
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);

  authTablesReady = true;
}

export type DbUser = {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  name: string | null;
  department: string | null;
  status: 'ACTIVE' | 'INACTIVE';
};

export type PublicUserRow = {
  id: string;
  email: string;
  name: string | null;
  department: string | null;
  role: UserRole;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
};

const mapUser = (row: Record<string, unknown>): DbUser => ({
  id: String(row.id),
  email: String(row.email),
  password_hash: String(row.password_hash),
  role: row.role as UserRole,
  name: row.name != null ? String(row.name) : null,
  department: row.department != null ? String(row.department) : null,
  status: row.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
});

const mapPublicUser = (row: Record<string, unknown>): PublicUserRow => ({
  id: String(row.id),
  email: String(row.email),
  name: row.name != null ? String(row.name) : null,
  department: row.department != null ? String(row.department) : null,
  role: row.role as UserRole,
  status: row.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
  createdAt:
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at ?? ''),
});

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  if (!pool) {
    return null;
  }
  await ensureAuthTables();
  const normalized = email.trim().toLowerCase();
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM users
     WHERE lower(email) = $1 AND deleted_at IS NULL
       AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
     LIMIT 1`,
    [normalized]
  );
  if (result.rowCount === 0 || !result.rows[0]) {
    return null;
  }
  return mapUser(result.rows[0]);
}

export async function findUserById(id: string): Promise<DbUser | null> {
  if (!pool) {
    return null;
  }
  await ensureAuthTables();
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM users
     WHERE id = $1 AND deleted_at IS NULL
       AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
     LIMIT 1`,
    [id]
  );
  if (result.rowCount === 0 || !result.rows[0]) {
    return null;
  }
  return mapUser(result.rows[0]);
}

export async function createUser(
  email: string,
  passwordHash: string,
  role: UserRole,
  options?: { name?: string | null; department?: string | null }
): Promise<PublicUserRow> {
  if (!pool) {
    throw new Error('DATABASE_URL is required to manage users');
  }
  await ensureAuthTables();
  const id = randomUUID();
  const normalized = email.trim().toLowerCase();
  const name = options?.name?.trim() || null;
  const department = options?.department?.trim() || null;
  const result = await pool.query<Record<string, unknown>>(
    `INSERT INTO users (id, email, password_hash, role, name, department, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
     RETURNING id, email, name, department, role, status, created_at`,
    [id, normalized, passwordHash, role, name, department]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to create user');
  }
  return mapPublicUser(row);
}

export type ListUsersResult = {
  users: PublicUserRow[];
  total: number;
  page: number;
  limit: number;
};

export async function listUsersPaginated(page: number, limit: number): Promise<ListUsersResult> {
  if (!pool) {
    throw new Error('DATABASE_URL is required');
  }
  await ensureAuthTables();
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const safePage = Math.max(1, Math.floor(page));
  const offset = (safePage - 1) * safeLimit;

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM users WHERE deleted_at IS NULL`
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const rowsResult = await pool.query<Record<string, unknown>>(
    `SELECT id, email, name, department, role, status, created_at
     FROM users WHERE deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [safeLimit, offset]
  );

  return {
    users: rowsResult.rows.map(mapPublicUser),
    total,
    page: safePage,
    limit: safeLimit,
  };
}

export type UpdateUserInput = {
  name?: string | null;
  email?: string;
  role?: UserRole;
  status?: 'ACTIVE' | 'INACTIVE';
  department?: string | null;
  passwordHash?: string;
};

export async function updateUserById(id: string, data: UpdateUserInput): Promise<PublicUserRow | null> {
  if (!pool) {
    return null;
  }
  await ensureAuthTables();
  const existing = await pool.query<Record<string, unknown>>(
    'SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  if ((existing.rowCount ?? 0) === 0) {
    return null;
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (data.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(data.name?.trim() || null);
  }
  if (data.email !== undefined) {
    sets.push(`email = $${i++}`);
    values.push(data.email.trim().toLowerCase());
  }
  if (data.role !== undefined) {
    sets.push(`role = $${i++}`);
    values.push(data.role);
  }
  if (data.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(data.status);
  }
  if (data.department !== undefined) {
    sets.push(`department = $${i++}`);
    values.push(data.department?.trim() || null);
  }
  if (data.passwordHash !== undefined) {
    sets.push(`password_hash = $${i++}`);
    values.push(data.passwordHash);
  }

  if (sets.length === 0) {
    const r = await pool.query<Record<string, unknown>>(
      `SELECT id, email, name, department, role, status, created_at FROM users WHERE id = $1`,
      [id]
    );
    return r.rows[0] ? mapPublicUser(r.rows[0]) : null;
  }

  values.push(id);
  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i} AND deleted_at IS NULL`, values);

  const r = await pool.query<Record<string, unknown>>(
    `SELECT id, email, name, department, role, status, created_at FROM users WHERE id = $1`,
    [id]
  );
  return r.rows[0] ? mapPublicUser(r.rows[0]) : null;
}

export async function softDeleteUserById(id: string): Promise<boolean> {
  if (!pool) {
    return false;
  }
  await ensureAuthTables();
  const result = await pool.query(
    `UPDATE users SET deleted_at = NOW(), status = 'INACTIVE' WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateUserPassword(userId: string, passwordHash: string): Promise<boolean> {
  if (!pool) {
    return false;
  }
  await ensureAuthTables();
  const result = await pool.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2 AND deleted_at IS NULL',
    [passwordHash, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export async function savePasswordResetToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  if (!pool) {
    throw new Error('DATABASE_URL is required for password reset');
  }
  await ensureAuthTables();
  const id = randomUUID();
  await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
  await pool.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [id, userId, tokenHash, expiresAt]
  );
}

export async function consumePasswordResetToken(
  rawToken: string
): Promise<{ userId: string } | null> {
  if (!pool) {
    return null;
  }
  await ensureAuthTables();
  const tokenHash = hashResetToken(rawToken);
  const result = await pool.query<{ user_id: string }>(
    `DELETE FROM password_reset_tokens
     WHERE token_hash = $1 AND expires_at > NOW()
     RETURNING user_id`,
    [tokenHash]
  );
  if (result.rowCount === 0 || !result.rows[0]) {
    return null;
  }
  return { userId: result.rows[0].user_id };
}

export function generateRawResetToken(): string {
  return randomBytes(32).toString('base64url');
}
