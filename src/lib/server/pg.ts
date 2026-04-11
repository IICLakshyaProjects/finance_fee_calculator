import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL?.trim();

/** Shared pool for fee storage and auth. Null when `DATABASE_URL` is unset. */
export const pool = connectionString ? new Pool({ connectionString }) : null;
