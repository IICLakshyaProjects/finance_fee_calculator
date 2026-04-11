import path from 'path';
import { promises as fs } from 'fs';

import { alignInstallmentArrays, clampInstallmentCount, FeeInput, FeeStructure } from '@/lib/fee';

import { pool } from '@/lib/server/pg';

/**
 * node-pg must receive plain JSON arrays for jsonb. Postgres array text `{1,2,3}` is invalid JSON
 * and causes 22P02. Some payloads may arrive as that string or as odd array-like values.
 */
function coerceJsonbNumberArray(raw: unknown): number[] | null {
  if (raw == null) {
    return null;
  }
  let nums: number[] | null = null;
  if (Array.isArray(raw)) {
    nums = raw.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  } else if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (keys.length > 0) {
      nums = keys.map((k) => Number(o[k])).filter((n) => Number.isFinite(n));
    }
  } else if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('{') && s.endsWith('}')) {
      try {
        const j = JSON.parse(s) as unknown;
        if (Array.isArray(j)) {
          nums = j.map((x) => Number(x)).filter((n) => Number.isFinite(n));
        }
      } catch {
        const inner = s.slice(1, -1).trim();
        nums = inner
          ? inner
              .split(',')
              .map((p) => Number(p.trim()))
              .filter((n) => Number.isFinite(n))
          : [];
      }
    } else if (s.startsWith('[')) {
      try {
        const j = JSON.parse(s) as unknown;
        if (Array.isArray(j)) {
          nums = j.map((x) => Number(x)).filter((n) => Number.isFinite(n));
        }
      } catch {
        return null;
      }
    }
  }
  if (!nums || nums.length === 0) {
    return null;
  }
  return nums.slice(0, 5);
}

/** JSON text for jsonb columns — variable-length paired arrays, no zero padding. */
function jsonbInstallmentParams(entry: FeeStructure): { dueJson: string | null; capsJson: string | null } {
  const aligned = alignInstallmentArrays(entry.installmentDueDays, entry.installmentAmountCaps);
  if (!aligned || aligned.dueDays.length === 0) {
    return { dueJson: null, capsJson: null };
  }
  return {
    dueJson: JSON.stringify(aligned.dueDays),
    capsJson: JSON.stringify(aligned.amountCaps),
  };
}

/** Persists fee rows when DATABASE_URL is unset. Bulk upload preview never reads this file. */
const DATA_FILE = path.join(process.cwd(), 'data', 'fee-structures.json');
let dbReady = false;

const ensureDataFile = async () => {
  const directory = path.dirname(DATA_FILE);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, '[]', 'utf-8');
  }
};

const readJsonStore = async (): Promise<FeeStructure[]> => {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((entry: Partial<FeeStructure>) => ({
        ...entry,
        normalJoiningAmount:
          typeof entry.normalJoiningAmount === 'number' ? entry.normalJoiningAmount : 0,
        normalInstallmentDay1:
          typeof entry.normalInstallmentDay1 === 'number' ? entry.normalInstallmentDay1 : 0,
        normalInstallmentDay30:
          typeof entry.normalInstallmentDay30 === 'number' ? entry.normalInstallmentDay30 : 0,
        normalInstallmentDay60:
          typeof entry.normalInstallmentDay60 === 'number' ? entry.normalInstallmentDay60 : 0,
        otpJoiningAmount:
          typeof entry.otpJoiningAmount === 'number' ? entry.otpJoiningAmount : 0,
        otpInstallmentDay1:
          typeof entry.otpInstallmentDay1 === 'number' ? entry.otpInstallmentDay1 : 0,
        otpInstallmentDay30:
          typeof entry.otpInstallmentDay30 === 'number' ? entry.otpInstallmentDay30 : 0,
        otpInstallmentDay60:
          typeof entry.otpInstallmentDay60 === 'number' ? entry.otpInstallmentDay60 : 0,
        ...(() => {
          const aligned = alignInstallmentArrays(
            Array.isArray(entry.installmentDueDays) ? entry.installmentDueDays : undefined,
            Array.isArray(entry.installmentAmountCaps) ? entry.installmentAmountCaps : undefined
          );
          const ic =
            typeof entry.installmentCount === 'number' &&
            entry.installmentCount >= 2 &&
            entry.installmentCount <= 5
              ? entry.installmentCount
              : 3;
          const installmentCount =
            aligned && aligned.dueDays.length >= 2
              ? clampInstallmentCount(aligned.dueDays.length)
              : ic;
          return {
            installmentCount,
            installmentDueDays: aligned?.dueDays,
            installmentAmountCaps: aligned?.amountCaps,
          };
        })(),
      })) as FeeStructure[];
    }
  } catch {
    // ignore malformed store
  }
  return [];
};

const writeJsonStore = async (entries: FeeStructure[]) => {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(entries, null, 2), 'utf-8');
};

const ensureDb = async () => {
  if (!pool || dbReady) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fee_structures (
      id TEXT PRIMARY KEY,
      course TEXT NOT NULL,
      sub_course TEXT NOT NULL,
      particular TEXT NOT NULL,
      coaching_fee NUMERIC NOT NULL,
      admission_fee NUMERIC NOT NULL,
      student_exp_fee NUMERIC NOT NULL,
      material_fee NUMERIC NOT NULL,
      gst_percent NUMERIC NOT NULL,
      otp_coaching_fee NUMERIC NOT NULL,
      otp_gst_percent NUMERIC NOT NULL,
      normal_joining_amount NUMERIC NOT NULL,
      normal_installment_day1 NUMERIC NOT NULL,
      normal_installment_day30 NUMERIC NOT NULL,
      normal_installment_day60 NUMERIC NOT NULL,
      otp_joining_amount NUMERIC NOT NULL,
      otp_installment_day1 NUMERIC NOT NULL,
      otp_installment_day30 NUMERIC NOT NULL,
      otp_installment_day60 NUMERIC NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);

  const countResult = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text as count FROM fee_structures'
  );
  if (countResult.rows.length > 0 && Number(countResult.rows[0].count) === 0) {
    const seedEntries = await readJsonStore();
    if (seedEntries.length > 0) {
      await bulkInsertToDb(seedEntries);
    }
  }

  await pool.query(`
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS installment_count INTEGER NOT NULL DEFAULT 3
  `);

  await pool.query(`
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS installment_due_days JSONB
  `);

  await pool.query(`
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS installment_amount_caps JSONB
  `);

  dbReady = true;
};

const toNumberValue = (value: unknown) =>
  value === null || value === undefined ? 0 : Number(value) || 0;

const readInstallmentFieldsFromRow = (row: Record<string, unknown>) => {
  const dueRaw = coerceJsonbNumberArray(row.installment_due_days);
  const capRaw = coerceJsonbNumberArray(row.installment_amount_caps);
  const aligned = alignInstallmentArrays(dueRaw ?? undefined, capRaw ?? undefined);
  const dbCount = Math.floor(toNumberValue(row.installment_count));
  let installmentCount = dbCount >= 2 && dbCount <= 5 ? dbCount : 3;
  if (aligned && aligned.dueDays.length >= 2) {
    installmentCount = clampInstallmentCount(aligned.dueDays.length);
  }
  return {
    installmentCount,
    installmentDueDays: aligned?.dueDays,
    installmentAmountCaps: aligned?.amountCaps,
  };
};

const toEntry = (row: Record<string, unknown>): FeeStructure => ({
  id: String(row.id),
  course: String(row.course),
  subCourse: String(row.sub_course),
  particular: String(row.particular),
  coachingFee: toNumberValue(row.coaching_fee),
  admissionFee: toNumberValue(row.admission_fee),
  studentExpFee: toNumberValue(row.student_exp_fee),
  materialFee: toNumberValue(row.material_fee),
  gstPercent: toNumberValue(row.gst_percent),
  otpCoachingFee: toNumberValue(row.otp_coaching_fee),
  otpGstPercent: toNumberValue(row.otp_gst_percent),
  normalJoiningAmount: toNumberValue(row.normal_joining_amount),
  normalInstallmentDay1: toNumberValue(row.normal_installment_day1),
  normalInstallmentDay30: toNumberValue(row.normal_installment_day30),
  normalInstallmentDay60: toNumberValue(row.normal_installment_day60),
  otpJoiningAmount: toNumberValue(row.otp_joining_amount),
  otpInstallmentDay1: toNumberValue(row.otp_installment_day1),
  otpInstallmentDay30: toNumberValue(row.otp_installment_day30),
  otpInstallmentDay60: toNumberValue(row.otp_installment_day60),
  ...readInstallmentFieldsFromRow(row),
  createdAt:
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at ?? new Date().toISOString()),
});

const toParams = (entry: FeeStructure) => {
  const createdAt = entry.createdAt || new Date().toISOString();
  const aligned = alignInstallmentArrays(entry.installmentDueDays, entry.installmentAmountCaps);
  const installmentCount =
    aligned && aligned.dueDays.length >= 2
      ? clampInstallmentCount(aligned.dueDays.length)
      : entry.installmentCount ?? 3;
  const { dueJson, capsJson } = jsonbInstallmentParams(entry);
  return [
    entry.id,
    entry.course,
    entry.subCourse,
    entry.particular,
    entry.coachingFee,
    entry.admissionFee,
    entry.studentExpFee,
    entry.materialFee,
    entry.gstPercent,
    entry.otpCoachingFee,
    entry.otpGstPercent,
    entry.normalJoiningAmount,
    entry.normalInstallmentDay1,
    entry.normalInstallmentDay30,
    entry.normalInstallmentDay60,
    entry.otpJoiningAmount,
    entry.otpInstallmentDay1,
    entry.otpInstallmentDay30,
    entry.otpInstallmentDay60,
    installmentCount,
    dueJson,
    capsJson,
    createdAt,
  ];
};

const insertSql = `
  INSERT INTO fee_structures (
    id, course, sub_course, particular, coaching_fee, admission_fee, student_exp_fee, material_fee,
    gst_percent, otp_coaching_fee, otp_gst_percent, normal_joining_amount, normal_installment_day1,
    normal_installment_day30, normal_installment_day60, otp_joining_amount, otp_installment_day1,
    otp_installment_day30, otp_installment_day60, installment_count, installment_due_days,
    installment_amount_caps, created_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22::jsonb, $23
  )
`;

const bulkInsertToDb = async (entries: FeeStructure[]) => {
  if (!pool) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const entry of entries) {
      await client.query(insertSql, toParams(entry));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const getAllFeeStructures = async (): Promise<FeeStructure[]> => {
  if (pool) {
    await ensureDb();
    const result = await pool.query('SELECT * FROM fee_structures ORDER BY created_at DESC');
    return result.rows.map(toEntry);
  }
  return readJsonStore();
};

export const insertFeeStructure = async (entry: FeeStructure): Promise<FeeStructure> => {
  if (pool) {
    await ensureDb();
    await pool.query(insertSql, toParams(entry));
    return entry;
  }

  const entries = await readJsonStore();
  const updated = [entry, ...entries];
  await writeJsonStore(updated);
  return entry;
};

export const updateFeeStructure = async (
  id: string,
  data: FeeInput
): Promise<FeeStructure | null> => {
  if (pool) {
    await ensureDb();
    const existing = await pool.query('SELECT * FROM fee_structures WHERE id = $1', [id]);
    if ((existing.rowCount ?? 0) === 0) {
      return null;
    }

    const prev = toEntry(existing.rows[0] as Record<string, unknown>);
    const merged: FeeStructure = {
      ...prev,
      ...data,
      id: prev.id,
      createdAt: prev.createdAt,
    };
    const aligned = alignInstallmentArrays(merged.installmentDueDays, merged.installmentAmountCaps);
    const installmentCount =
      aligned && aligned.dueDays.length >= 2
        ? clampInstallmentCount(aligned.dueDays.length)
        : data.installmentCount ?? prev.installmentCount ?? 3;
    const { dueJson, capsJson } = jsonbInstallmentParams(merged);

    const updateSql = `
      UPDATE fee_structures SET
        course = $1,
        sub_course = $2,
        particular = $3,
        coaching_fee = $4,
        admission_fee = $5,
        student_exp_fee = $6,
        material_fee = $7,
        gst_percent = $8,
        otp_coaching_fee = $9,
        otp_gst_percent = $10,
        normal_joining_amount = $11,
        normal_installment_day1 = $12,
        normal_installment_day30 = $13,
        normal_installment_day60 = $14,
        otp_joining_amount = $15,
        otp_installment_day1 = $16,
        otp_installment_day30 = $17,
        otp_installment_day60 = $18,
        installment_count = $19,
        installment_due_days = $20::jsonb,
        installment_amount_caps = $21::jsonb
      WHERE id = $22
      RETURNING *
    `;

    const params = [
      data.course,
      data.subCourse,
      data.particular,
      data.coachingFee,
      data.admissionFee,
      data.studentExpFee,
      data.materialFee,
      data.gstPercent,
      data.otpCoachingFee,
      data.otpGstPercent,
      data.normalJoiningAmount,
      data.normalInstallmentDay1,
      data.normalInstallmentDay30,
      data.normalInstallmentDay60,
      data.otpJoiningAmount,
      data.otpInstallmentDay1,
      data.otpInstallmentDay30,
      data.otpInstallmentDay60,
      installmentCount,
      dueJson,
      capsJson,
      id,
    ];

    const result = await pool.query(updateSql, params);
    return (result.rowCount ?? 0) === 0 ? null : toEntry(result.rows[0]);
  }

  const entries = await readJsonStore();
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return null;
  }

  const updated: FeeStructure = {
    ...entries[index],
    ...data,
  };
  entries[index] = updated;
  await writeJsonStore(entries);
  return updated;
};

export const deleteFeeStructure = async (id: string): Promise<boolean> => {
  if (pool) {
    await ensureDb();
    const result = await pool.query('DELETE FROM fee_structures WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  const entries = await readJsonStore();
  const updated = entries.filter((entry) => entry.id !== id);
  if (updated.length === entries.length) {
    return false;
  }
  await writeJsonStore(updated);
  return true;
};

export const bulkInsertFeeStructures = async (entries: FeeStructure[]): Promise<void> => {
  if (pool) {
    await ensureDb();
    await bulkInsertToDb(entries);
    return;
  }

  if (entries.length === 0) {
    return;
  }

  const existing = await readJsonStore();
  await writeJsonStore([...entries, ...existing]);
};

export const bulkDeleteFeeStructures = async (ids: string[]): Promise<number> => {
  if (ids.length === 0) {
    return 0;
  }

  if (pool) {
    await ensureDb();
    const result = await pool.query('DELETE FROM fee_structures WHERE id = ANY($1::text[])', [ids]);
    return result.rowCount ?? 0;
  }

  const entries = await readJsonStore();
  const filtered = entries.filter((entry) => !ids.includes(entry.id));
  if (filtered.length === entries.length) {
    return 0;
  }
  await writeJsonStore(filtered);
  return entries.length - filtered.length;
};


export const deleteAllFeeStructures = async (): Promise<number> => {
  if (pool) {
    await ensureDb();
    const result = await pool.query('DELETE FROM fee_structures');
    return result.rowCount ?? 0;
  }

  const entries = await readJsonStore();
  if (entries.length === 0) {
    return 0;
  }
  await writeJsonStore([]);
  return entries.length;
};
