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

  authTablesReady = true;
}

export type DbUser = {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
};

const mapUser = (row: Record<string, unknown>): DbUser => ({
  id: String(row.id),
  email: String(row.email),
  password_hash: String(row.password_hash),
  role: row.role as UserRole,
});

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  if (!pool) {
    return null;
  }
  await ensureAuthTables();
  const normalized = email.trim().toLowerCase();
  const result = await pool.query<Record<string, unknown>>(
    'SELECT * FROM users WHERE lower(email) = $1 LIMIT 1',
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
    'SELECT * FROM users WHERE id = $1 LIMIT 1',
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
  role: UserRole
): Promise<DbUser> {
  if (!pool) {
    throw new Error('DATABASE_URL is required to manage users');
  }
  await ensureAuthTables();
  const id = randomUUID();
  const normalized = email.trim().toLowerCase();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)`,
    [id, normalized, passwordHash, role]
  );
  return { id, email: normalized, password_hash: passwordHash, role };
}

export async function updateUserPassword(userId: string, passwordHash: string): Promise<boolean> {
  if (!pool) {
    return false;
  }
  await ensureAuthTables();
  const result = await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
    passwordHash,
    userId,
  ]);
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
