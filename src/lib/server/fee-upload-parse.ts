import { read, utils, type WorkBook, type WorkSheet } from 'xlsx';

import { alignInstallmentArrays, clampInstallmentCount, DEFAULT_INSTALLMENT_DUE_DAYS, FeeInput } from '@/lib/fee';
import { parseFeeInput } from '@/lib/server/fee-utils';

export type FeeUploadParseResult = {
  /** Column titles exactly as derived from the sheet header row (unique names). */
  headers: string[];
  /** One object per non-empty data row; keys match `headers`. */
  rawRows: Record<string, unknown>[];
  /** Converted rows for DB import (Lakshya or flat layout only). */
  rows: FeeInput[];
  errors: string[];
  layout: 'lakshya-template' | 'lakshya-narrow' | 'flat-rows' | 'raw-only' | null;
  sheetName: string | null;
  canSave: boolean;
};

type ColumnDefinition = {
  field: keyof FeeInput;
  keys: string[];
};

const columnDefinitions: ColumnDefinition[] = [
  { field: 'course', keys: ['course'] },
  { field: 'subCourse', keys: ['sub_course', 'subcourse', 'sub course', 'specialization'] },
  { field: 'particular', keys: ['particular', 'particulars', 'particular name'] },
  { field: 'coachingFee', keys: ['coaching_fee', 'coachingfee', 'coaching fee'] },
  { field: 'admissionFee', keys: ['admission_fee', 'admissionfee', 'admission fee'] },
  { field: 'studentExpFee', keys: ['student_experience_fee', 'student experience fee', 'studentexperiencefee'] },
  { field: 'materialFee', keys: ['material_fee', 'material fee', 'materialfee'] },
  { field: 'gstPercent', keys: ['gst_percent', 'gst%', 'gst percent'] },
  { field: 'otpCoachingFee', keys: ['otp_coaching_fee', 'otp coaching fee', 'otpcoachingfee'] },
  { field: 'otpGstPercent', keys: ['otp_gst_percent', 'otp gst percent', 'otp gst%'] },
  { field: 'normalJoiningAmount', keys: ['normal_joining_amount', 'joining_amount', 'joining amount'] },
  {
    field: 'normalInstallmentDay1',
    keys: ['1st_installment_day_1', 'first_installment_day_1', 'installment_day_1', 'day_1_installment'],
  },
  {
    field: 'normalInstallmentDay30',
    keys: ['2nd_installment_day_30', 'second_installment_day_30', 'installment_day_30', 'day_30_installment'],
  },
  {
    field: 'normalInstallmentDay60',
    keys: ['3rd_installment_day_60', 'third_installment_day_60', 'installment_day_60', 'day_60_installment'],
  },
  { field: 'otpJoiningAmount', keys: ['otp_joining_amount', 'otp joining amount'] },
  {
    field: 'otpInstallmentDay1',
    keys: ['otp_1st_installment_day_1', 'otp first_installment_day_1', 'otp_installment_day_1'],
  },
  {
    field: 'otpInstallmentDay30',
    keys: ['otp_2nd_installment_day_30', 'otp second_installment_day_30', 'otp_installment_day_30'],
  },
  {
    field: 'otpInstallmentDay60',
    keys: ['otp_3rd_installment_day_60', 'otp third_installment_day_60', 'otp_installment_day_60'],
  },
];

const REQUIRED_FLAT_FIELDS: (keyof FeeInput)[] = [
  'course',
  'subCourse',
  'particular',
  'coachingFee',
  'admissionFee',
  'studentExpFee',
  'materialFee',
  'gstPercent',
  'otpCoachingFee',
  'otpGstPercent',
];

const normalizeColumnKey = (value: string): string =>
  value
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

function parseDueDayCell(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.min(99999, Math.floor(value));
  }
  const cleaned = `${value}`.replace(/[,₹]/g, '').trim();
  const m = cleaned.match(/(\d+)/);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? Math.min(99999, Math.floor(n)) : null;
  }
  return null;
}

/**
 * Column headers for calendar day of each installment (labels only; amounts use normalInstallmentDay*).
 */
const INSTALLMENT_DUE_DAY_SLOT_KEYS: { slot: number; keys: string[] }[] = [
  {
    slot: 0,
    keys: [
      '1st_installment_due_day',
      'first_installment_due_day',
      'installment_1_schedule_day',
      'installment_1_day',
      'due_day_1st',
    ],
  },
  {
    slot: 1,
    keys: [
      '2nd_installment_due_day',
      'second_installment_due_day',
      'installment_2_schedule_day',
      'installment_2_day',
      'due_day_2nd',
    ],
  },
  {
    slot: 2,
    keys: [
      '3rd_installment_due_day',
      'third_installment_due_day',
      'installment_3_schedule_day',
      'installment_3_day',
      'due_day_3rd',
    ],
  },
  {
    slot: 3,
    keys: [
      '4th_installment_due_day',
      'fourth_installment_due_day',
      'installment_4_schedule_day',
      'installment_4_day',
    ],
  },
  {
    slot: 4,
    keys: [
      '5th_installment_due_day',
      'fifth_installment_due_day',
      'installment_5_schedule_day',
      'installment_5_day',
    ],
  },
];

function mergeInstallmentDueDaysFromNormalized(
  normalized: Record<string, unknown>,
  candidate: Record<string, unknown>
) {
  let anySet = false;
  const merged: number[] = [...DEFAULT_INSTALLMENT_DUE_DAYS];
  for (const { slot, keys } of INSTALLMENT_DUE_DAY_SLOT_KEYS) {
    for (const lookup of keys) {
      const nk = normalizeColumnKey(lookup);
      if (Object.prototype.hasOwnProperty.call(normalized, nk)) {
        const p = parseDueDayCell(normalized[nk]);
        if (p != null) {
          merged[slot] = p;
          anySet = true;
        }
        break;
      }
    }
  }
  if (anySet) {
    const caps = [
      Math.max(0, Number(candidate.normalInstallmentDay1) || 0),
      Math.max(0, Number(candidate.normalInstallmentDay30) || 0),
      Math.max(0, Number(candidate.normalInstallmentDay60) || 0),
      0,
      0,
    ];
    const aligned = alignInstallmentArrays(merged, caps);
    if (aligned && aligned.dueDays.length > 0) {
      candidate.installmentDueDays = aligned.dueDays;
      candidate.installmentAmountCaps = aligned.amountCaps;
    }
  }
}

/** Build display headers from a header row; duplicate labels become "Name (2)", etc. */
export function makeUniqueHeaders(cells: unknown[]): string[] {
  const seen = new Map<string, number>();
  return cells.map((c, i) => {
    const base =
      c != null && String(c).trim() !== '' ? String(c).trim() : `Column ${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) {
      return base;
    }
    return `${base} (${count + 1})`;
  });
}

/**
 * Extract a rectangular table: ordered headers from the header row, one object per data row.
 * Values align by column index with the header row.
 */
export function extractTableFromSheet(sheet: WorkSheet, headerRowIndex: number): {
  headers: string[];
  rawRows: Record<string, unknown>[];
} {
  const aoa = utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
  let maxCol = 0;
  for (let r = headerRowIndex; r < aoa.length; r++) {
    maxCol = Math.max(maxCol, aoa[r]?.length ?? 0);
  }
  const headerCells = aoa[headerRowIndex] ?? [];
  const extended = Array.from({ length: Math.max(maxCol, headerCells.length) }, (_, j) => headerCells[j]);
  const headers = makeUniqueHeaders(extended);
  const rawRows: Record<string, unknown>[] = [];

  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const obj: Record<string, unknown> = {};
    let hasAny = false;
    for (let j = 0; j < headers.length; j++) {
      const val = row[j];
      obj[headers[j]] = val ?? null;
      if (val != null && String(val).trim() !== '') {
        hasAny = true;
      }
    }
    if (hasAny) {
      rawRows.push(obj);
    }
  }

  return { headers, rawRows };
}

/** Find course + fee-type columns for Lakshya-style wide sheets (names may vary). */
export function resolveLakshyaColumnKeys(headers: string[]): { courseKey: string; feesKey: string } | null {
  let feesKey: string | undefined;
  for (const h of headers) {
    const n = normalizeColumnKey(h);
    if (n === 'fees' || n === 'fee' || n.endsWith('_fees') || /^fee(s)?_/.test(n)) {
      if (!feesKey) {
        feesKey = h;
      }
    }
  }
  if (!feesKey) {
    for (const h of headers) {
      const n = normalizeColumnKey(h);
      if (n.includes('fee') && !n.includes('course') && !n.includes('gst')) {
        feesKey = h;
        break;
      }
    }
  }

  let courseKey: string | undefined;
  for (const h of headers) {
    const n = normalizeColumnKey(h);
    if ((n.includes('course') && n.includes('name')) || n === 'course_name') {
      courseKey = h;
      break;
    }
  }
  if (!courseKey) {
    const idx = headers.findIndex((h) => normalizeColumnKey(h).includes('course'));
    if (idx >= 0) {
      courseKey = headers[idx];
    }
  }

  if (courseKey && feesKey) {
    return { courseKey, feesKey };
  }
  return null;
}

const mapRowToCandidate = (row: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key) {
      continue;
    }
    const normalizedKey = normalizeColumnKey(key);
    normalized[normalizedKey] = value;
  }

  const candidate: Record<string, unknown> = {};
  for (const definition of columnDefinitions) {
    for (const lookup of definition.keys) {
      const normalizedLookup = normalizeColumnKey(lookup);
      if (
        normalizedLookup &&
        Object.prototype.hasOwnProperty.call(normalized, normalizedLookup)
      ) {
        candidate[definition.field] = normalized[normalizedLookup];
        break;
      }
    }
  }

  mergeInstallmentDueDaysFromNormalized(normalized, candidate);

  return candidate;
};

const hasRowValues = (row: Record<string, unknown>) =>
  Object.values(row).some((value) => value !== null && value !== undefined && `${value}`.trim().length > 0);

export function parseTemplateLayout(
  rows: Record<string, unknown>[],
  headers: string[],
  keys: { courseKey: string; feesKey: string }
): { rows: FeeInput[]; errors: string[] } {
  const locationColumns = headers.filter((h) => h !== keys.courseKey && h !== keys.feesKey);

  const parseNumberValue = (value: unknown): number | null => {
    if (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim().length === 0)
    ) {
      return null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    const cleaned = `${value}`.replace(/[,₹$]/g, '').trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const extractLocationValue = (row: Record<string, unknown>) => {
    for (const column of locationColumns) {
      if (!column) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(row, column)) {
        const parsed = parseNumberValue(row[column]);
        if (parsed !== null) {
          return parsed;
        }
      }
    }
    return null;
  };

  if (locationColumns.length === 0) {
    return {
      rows: [],
      errors: ['No value columns found beside the course and fee-type columns (add at least one branch or amount column).'],
    };
  }

  const parsePercent = (value: unknown): number | null => {
    if (typeof value === 'string') {
      const match = value.match(/(\d+(\.\d+)?)\s*%/);
      if (match) {
        return Number(match[1]);
      }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return null;
  };

  type TemplateEntry = {
    courseName: string;
    course: string;
    subCourse: string;
    particular: string;
    coachingFee?: number;
    admissionFee?: number;
    studentExpFee?: number;
    materialFee?: number;
    gstPercent?: number;
    normalJoiningAmount?: number;
    normalInstallmentDay1?: number;
    normalInstallmentDay30?: number;
    normalInstallmentDay60?: number;
    otpTotal?: number;
  };

  const entries: FeeInput[] = [];
  const errors: string[] = [];
  let currentEntry: TemplateEntry | null = null;

  const finalizeEntry = () => {
    if (!currentEntry) {
      return;
    }

    const admission = currentEntry.admissionFee ?? 0;
    const material = currentEntry.materialFee ?? 0;
    const studentExp = currentEntry.studentExpFee ?? 0;
    const gstPercent = currentEntry.gstPercent ?? 0;
    const baseOthers = admission + material + studentExp;
    let otpCoaching = currentEntry.otpTotal ?? null;
    const otpGstPercent = gstPercent;

    if (currentEntry.otpTotal != null && gstPercent >= 0) {
      const multiplier = 1 + gstPercent / 100;
      const otpSubtotal = multiplier > 0 ? currentEntry.otpTotal! / multiplier : currentEntry.otpTotal!;
      const computed = otpSubtotal - baseOthers;
      otpCoaching = computed > 0 ? computed : 0;
    }

    entries.push({
      course: currentEntry.course,
      subCourse: currentEntry.subCourse,
      particular: currentEntry.particular,
      coachingFee: currentEntry.coachingFee ?? 0,
      admissionFee: admission,
      studentExpFee: studentExp,
      materialFee: material,
      gstPercent,
      otpCoachingFee: otpCoaching ?? currentEntry.coachingFee ?? 0,
      otpGstPercent: otpGstPercent,
      normalJoiningAmount: currentEntry.normalJoiningAmount ?? 0,
      normalInstallmentDay1: currentEntry.normalInstallmentDay1 ?? 0,
      normalInstallmentDay30: currentEntry.normalInstallmentDay30 ?? 0,
      normalInstallmentDay60: currentEntry.normalInstallmentDay60 ?? 0,
      otpJoiningAmount: 0,
      otpInstallmentDay1: 0,
      otpInstallmentDay30: 0,
      otpInstallmentDay60: 0,
    });

    currentEntry = null;
  };

  rows.forEach((row) => {
    const feeRaw = row[keys.feesKey];
    if (!feeRaw && feeRaw !== 0) {
      return;
    }
    const feeLabel = typeof feeRaw === 'string' ? feeRaw.trim().toLowerCase() : '';
    const courseRaw = row[keys.courseKey];
    const courseName = typeof courseRaw === 'string' ? courseRaw.trim() : '';
    const isOtpRow = courseName.toLowerCase().includes('within 7 days');
    const amount = extractLocationValue(row);

    if (courseName && !isOtpRow && feeLabel.includes('coaching fee')) {
      finalizeEntry();
      const courseParts = courseName.split(/\s+/);
      const course = courseParts[0] || courseName;
      currentEntry = {
        courseName,
        course,
        subCourse: courseName,
        particular: courseName,
      };
    }

    if (!currentEntry) {
      return;
    }

    if (feeLabel.includes('coaching fee')) {
      if (amount !== null) {
        currentEntry.coachingFee = amount;
      }
      return;
    }

    if (feeLabel.includes('admission fee')) {
      if (amount !== null) {
        currentEntry.admissionFee = amount;
      }
      return;
    }

    if (feeLabel.includes('material fee')) {
      if (amount !== null) {
        currentEntry.materialFee = amount;
      }
      return;
    }

    if (feeLabel.includes('student') || feeLabel.includes('uniform')) {
      if (amount !== null) {
        currentEntry.studentExpFee = amount;
      }
      return;
    }

    if (feeLabel.includes('gst')) {
      const parsedPercent = parsePercent(feeRaw);
      if (parsedPercent !== null) {
        currentEntry.gstPercent = parsedPercent;
      }
      return;
    }

    if (feeLabel.includes('joi') && amount !== null) {
      currentEntry.normalJoiningAmount = amount;
      return;
    }

    if (feeLabel.includes('1st installment') && amount !== null) {
      currentEntry.normalInstallmentDay1 = amount;
      return;
    }

    if (feeLabel.includes('2nd installment') && amount !== null) {
      currentEntry.normalInstallmentDay30 = amount;
      return;
    }

    if (feeLabel.includes('3rd installment') && amount !== null) {
      currentEntry.normalInstallmentDay60 = amount;
      return;
    }

    if (feeLabel.includes('otp')) {
      if (amount !== null) {
        currentEntry.otpTotal = amount;
      }
    }
  });

  finalizeEntry();

  if (entries.length === 0) {
    errors.push(
      'No courses were parsed from the fee-type column. Expected rows like "Coaching Fee" under the course column, with amounts in your branch columns.'
    );
  }

  return { rows: entries, errors };
}

/** Particulars cell looks like a fee line (Coaching Fee, GST, …), not a course title row. */
function looksLikeKnownFeeLineLabel(particulars: string): boolean {
  const x = particulars.trim().toLowerCase();
  if (!x) {
    return false;
  }
  return (
    x.includes('coaching fee') ||
    x.includes('admission fee') ||
    x.includes('material fee') ||
    x.includes('student experience') ||
    x.includes('uniform') ||
    x.includes('gst') ||
    x.includes('total fee') ||
    x.includes('joining amount') ||
    x.includes('installment') ||
    x.includes('otp') ||
    x === 'check' ||
    x.includes('net fee')
  );
}

export function resolveNarrowColumnKeys(headers: string[]): {
  courseKey: string;
  subCourseKey: string;
  particularsKey: string;
  amountKey: string;
} | null {
  const courseKey =
    headers.find((h) => {
      const n = normalizeColumnKey(h);
      return n === 'course' || n === 'course_name';
    }) ?? null;

  const subCourseKey =
    headers.find((h) => {
      const n = normalizeColumnKey(h);
      return n.includes('sub') && n.includes('course');
    }) ?? null;

  const particularsKey =
    headers.find((h) => {
      const n = normalizeColumnKey(h);
      return n.includes('particular');
    }) ?? null;

  const amountKey =
    headers.find((h) => {
      const n = normalizeColumnKey(h);
      if (n.includes('particular')) {
        return false;
      }
      return (
        (n.includes('original') && (n.includes('fee') || n.includes('fees'))) ||
        n === 'original_fees' ||
        (n.includes('net') && n.includes('fee')) ||
        n === 'amount' ||
        (n.includes('fee') && n.includes('amount'))
      );
    }) ?? null;

  if (courseKey && subCourseKey && particularsKey && amountKey) {
    return { courseKey, subCourseKey, particularsKey, amountKey };
  }
  return null;
}

/**
 * Vertical block layout: Course | Sub Course | Particulars | Original Fees (single amount column).
 * Used by sheets like "All Kerala offline Branches Apr".
 */
export function parseNarrowTemplateLayout(
  rows: Record<string, unknown>[],
  keys: {
    courseKey: string;
    subCourseKey: string;
    particularsKey: string;
    amountKey: string;
  }
): { rows: FeeInput[]; errors: string[] } {
  const parseNumberValue = (value: unknown): number | null => {
    if (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim().length === 0)
    ) {
      return null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    const cleaned = `${value}`.replace(/[,₹$]/g, '').trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const parsePercent = (value: unknown): number | null => {
    if (typeof value === 'string') {
      const match = value.match(/(\d+(\.\d+)?)\s*%/);
      if (match) {
        return Number(match[1]);
      }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return null;
  };

  type TemplateEntry = {
    course: string;
    subCourse: string;
    particular: string;
    coachingFee?: number;
    admissionFee?: number;
    studentExpFee?: number;
    materialFee?: number;
    gstPercent?: number;
    normalJoiningAmount?: number;
    /** Sequential installment rows from the sheet (Particulars like "1st Installment (Day 1)"). */
    installmentAmountCaps: number[];
    installmentDueDaysScratch: number[];
    otpTotal?: number;
  };

  const entries: FeeInput[] = [];
  const errors: string[] = [];
  let currentEntry: TemplateEntry | null = null;

  const finalizeEntry = () => {
    if (!currentEntry) {
      return;
    }

    const admission = currentEntry.admissionFee ?? 0;
    const material = currentEntry.materialFee ?? 0;
    const studentExp = currentEntry.studentExpFee ?? 0;
    const gstPercent = currentEntry.gstPercent ?? 0;
    const baseOthers = admission + material + studentExp;
    let otpCoaching = currentEntry.otpTotal ?? null;
    const otpGstPercent = gstPercent;

    if (currentEntry.otpTotal != null && gstPercent >= 0) {
      const multiplier = 1 + gstPercent / 100;
      const otpSubtotal = multiplier > 0 ? currentEntry.otpTotal! / multiplier : currentEntry.otpTotal!;
      const computed = otpSubtotal - baseOthers;
      otpCoaching = computed > 0 ? computed : 0;
    }

    const caps = currentEntry.installmentAmountCaps;
    const days = currentEntry.installmentDueDaysScratch;
    const aligned = alignInstallmentArrays(days, caps);
    const ic =
      aligned && aligned.dueDays.length >= 2
        ? clampInstallmentCount(aligned.dueDays.length)
        : caps.length > 0
          ? Math.min(5, Math.max(2, caps.length))
          : 3;

    entries.push({
      course: currentEntry.course,
      subCourse: currentEntry.subCourse,
      particular: currentEntry.particular,
      coachingFee: currentEntry.coachingFee ?? 0,
      admissionFee: admission,
      studentExpFee: studentExp,
      materialFee: material,
      gstPercent,
      otpCoachingFee: otpCoaching ?? currentEntry.coachingFee ?? 0,
      otpGstPercent: otpGstPercent,
      normalJoiningAmount: currentEntry.normalJoiningAmount ?? 0,
      normalInstallmentDay1: aligned?.amountCaps[0] ?? caps[0] ?? 0,
      normalInstallmentDay30: aligned?.amountCaps[1] ?? caps[1] ?? 0,
      normalInstallmentDay60: aligned?.amountCaps[2] ?? caps[2] ?? 0,
      installmentAmountCaps: aligned && aligned.dueDays.length > 0 ? [...aligned.amountCaps] : undefined,
      installmentDueDays: aligned && aligned.dueDays.length > 0 ? [...aligned.dueDays] : undefined,
      installmentCount: ic,
      otpJoiningAmount: 0,
      otpInstallmentDay1: 0,
      otpInstallmentDay30: 0,
      otpInstallmentDay60: 0,
    });

    currentEntry = null;
  };

  rows.forEach((row) => {
    const courseRaw = row[keys.courseKey];
    const subRaw = row[keys.subCourseKey];
    const partRaw = row[keys.particularsKey];
    const course = typeof courseRaw === 'string' ? courseRaw.trim() : '';
    const sub = typeof subRaw === 'string' ? subRaw.trim() : '';
    const part = typeof partRaw === 'string' ? partRaw.trim() : '';
    const amount = parseNumberValue(row[keys.amountKey]);

    if (!part && !course && !sub) {
      return;
    }

    const feeLabel = part.toLowerCase();
    const isOtpContext =
      course.toLowerCase().includes('within') ||
      course.toLowerCase().includes('otp') ||
      feeLabel.includes('otp');

    if (course && sub && !looksLikeKnownFeeLineLabel(part)) {
      finalizeEntry();
      const courseParts = course.split(/\s+/);
      const courseCode = courseParts[0] || course;
      currentEntry = {
        course: courseCode,
        subCourse: sub,
        particular: part || sub,
        installmentAmountCaps: [],
        installmentDueDaysScratch: [],
      };
      return;
    }

    if (course && isOtpContext && currentEntry && looksLikeKnownFeeLineLabel(part)) {
      if (feeLabel.includes('otp') && amount !== null) {
        currentEntry.otpTotal = amount;
      }
      return;
    }

    if (!currentEntry) {
      return;
    }

    if (feeLabel.includes('coaching fee')) {
      if (amount !== null) {
        currentEntry.coachingFee = amount;
      }
      return;
    }

    if (feeLabel.includes('admission fee')) {
      if (amount !== null) {
        currentEntry.admissionFee = amount;
      }
      return;
    }

    if (feeLabel.includes('material fee')) {
      if (amount !== null) {
        currentEntry.materialFee = amount;
      }
      return;
    }

    if (feeLabel.includes('student') || feeLabel.includes('uniform')) {
      if (amount !== null) {
        currentEntry.studentExpFee = amount;
      }
      return;
    }

    if (feeLabel.includes('gst')) {
      const parsedPercent = parsePercent(partRaw);
      if (parsedPercent !== null) {
        currentEntry.gstPercent = parsedPercent;
      }
      return;
    }

    if (feeLabel.includes('joi') && amount !== null) {
      currentEntry.normalJoiningAmount = amount;
      return;
    }

    // "1st Installment (Day 1)" … — require positive amount and a "(Day N)" label; no placeholders.
    const instOrdinal = /(\d+)(st|nd|rd|th)\s+Installment/i.exec(part);
    if (instOrdinal && feeLabel.includes('installment') && amount !== null && amount > 0) {
      const dayM = part.match(/\(Day\s*(\d+)\)/i);
      if (!dayM) {
        return;
      }
      const d = Number(dayM[1]);
      if (!Number.isFinite(d) || d <= 0) {
        return;
      }
      if (currentEntry.installmentAmountCaps.length >= 5) {
        return;
      }
      currentEntry.installmentAmountCaps.push(amount);
      currentEntry.installmentDueDaysScratch.push(Math.min(99999, Math.floor(d)));
      return;
    }

    if (feeLabel.includes('otp') && amount !== null) {
      currentEntry.otpTotal = amount;
    }
  });

  finalizeEntry();

  if (entries.length === 0) {
    errors.push(
      'No course blocks were parsed. Expected rows with Course + Sub Course + a title in Particulars, followed by fee lines (Coaching Fee, etc.) in Particulars with amounts.'
    );
  }

  return { rows: entries, errors };
}

function rowLooksLikeNarrowLakshyaHeader(row: unknown[]): boolean {
  const norms = row.map((c) => normalizeColumnKey(String(c ?? '')));
  const hasCourse = norms.some((n) => n === 'course' || n === 'course_name');
  const hasSubCourse = norms.some((n) => n.includes('sub') && n.includes('course'));
  const hasParticulars = norms.some((n) => n.includes('particular'));
  const hasAmount = norms.some((n) => {
    if (n.includes('particular')) {
      return false;
    }
    return (
      (n.includes('original') && (n.includes('fee') || n.includes('fees'))) ||
      n === 'original_fees' ||
      (n.includes('net') && n.includes('fee')) ||
      n === 'amount' ||
      (n.includes('fee') && n.includes('amount'))
    );
  });
  return hasCourse && hasSubCourse && hasParticulars && hasAmount;
}

function findNarrowTemplateHeaderIndex(aoa: unknown[][]): number {
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    if (rowLooksLikeNarrowLakshyaHeader(row)) {
      return r;
    }
  }
  return -1;
}

export const parseStandardLayout = (
  rows: Record<string, unknown>[],
  headerRowIndex: number
): { rows: FeeInput[]; errors: string[] } => {
  const parsedEntries: FeeInput[] = [];
  const errors: string[] = [];
  const excelBase = headerRowIndex + 2;

  rows.forEach((row, index) => {
    if (!hasRowValues(row)) {
      return;
    }

    const candidate = mapRowToCandidate(row);
    const parsed = parseFeeInput(candidate);
    if (!parsed) {
      errors.push(`Row ${excelBase + index}: missing or invalid required columns.`);
      return;
    }

    parsedEntries.push(parsed);
  });

  return { rows: parsedEntries, errors };
};

function rowLooksLikeLakshyaHeader(row: unknown[]): boolean {
  const norms = row.map((c) => normalizeColumnKey(String(c ?? '')));
  const hasFeesCol = norms.some((n) => n === 'fees' || n === 'fee');
  const hasCourseCol = norms.some(
    (n) =>
      (n.includes('course') && (n.includes('name') || n.endsWith('_name'))) ||
      n === 'course_name' ||
      n === 'course'
  );
  return hasFeesCol && hasCourseCol;
}

function findTemplateHeaderIndex(aoa: unknown[][]): number {
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    if (rowLooksLikeLakshyaHeader(row)) {
      return r;
    }
  }
  return -1;
}

function findStandardHeaderIndex(aoa: unknown[][]): number {
  for (let r = 0; r < Math.min(aoa.length, 50); r++) {
    const row = aoa[r] ?? [];
    const headers = row.map((c) => normalizeColumnKey(String(c ?? '')));
    const hits = REQUIRED_FLAT_FIELDS.filter((field) => {
      const def = columnDefinitions.find((d) => d.field === field);
      if (!def) {
        return false;
      }
      return def.keys.some((k) => headers.includes(normalizeColumnKey(k)));
    });
    if (hits.length === REQUIRED_FLAT_FIELDS.length) {
      return r;
    }
  }
  return -1;
}

/** Heuristic: row with the most non-empty cells (for generic spreadsheets). */
function findBestGuessHeaderIndex(aoa: unknown[][]): number {
  let best = -1;
  let bestScore = 1;
  const limit = Math.min(aoa.length, 120);
  for (let r = 0; r < limit; r++) {
    const row = aoa[r] ?? [];
    const score = row.filter((c) => c != null && String(c).trim() !== '').length;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function readWorkbook(buffer: Buffer, fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) {
    const text = buffer.toString('utf-8');
    return read(text, { type: 'string', raw: true });
  }
  return read(buffer, { type: 'buffer', raw: true });
}

export type ParseUploadedFeeOptions = {
  /**
   * When set, only this worksheet tab is parsed (must match a name in the workbook;
   * comparison is exact first, then case-insensitive).
   * When omitted, all sheets are tried in workbook order until one yields a table.
   */
  sheetName?: string | null;
};

/** Tab names in workbook order (for UI). */
export function listWorkbookSheetNames(buffer: Buffer, fileName: string): string[] {
  try {
    const workbook = readWorkbook(buffer, fileName);
    return workbook.SheetNames.slice();
  } catch {
    return [];
  }
}

function resolveWorksheetName(workbook: WorkBook, requested: string): string | null {
  const t = requested.trim();
  if (!t) {
    return null;
  }
  const exact = workbook.SheetNames.find((n) => n === t);
  if (exact) {
    return exact;
  }
  const tl = t.toLowerCase();
  return workbook.SheetNames.find((n) => n.toLowerCase() === tl) ?? null;
}

function tryParseSheet(
  workbook: WorkBook,
  sheetName: string,
  sheetErrors: string[],
  singleSheetMode: boolean
): FeeUploadParseResult | null {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet?.['!ref']) {
    return null;
  }

  const aoa = utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];

  const templateIdx = findTemplateHeaderIndex(aoa);
  if (templateIdx >= 0) {
    const { headers, rawRows } = extractTableFromSheet(sheet, templateIdx);
    const jsonRows = utils.sheet_to_json<Record<string, unknown>>(sheet, { range: templateIdx, defval: null });
    const lakshyaKeys = resolveLakshyaColumnKeys(headers);
    let feeRows: FeeInput[] = [];
    let tmplErrors: string[] = [];

    if (lakshyaKeys) {
      const result = parseTemplateLayout(jsonRows, headers, lakshyaKeys);
      feeRows = result.rows;
      tmplErrors = result.errors;
    } else {
      tmplErrors = ['Could not match a course column and a fee-type column in the header row.'];
    }

    return {
      headers,
      rawRows,
      rows: feeRows,
      errors: tmplErrors,
      layout: 'lakshya-template',
      sheetName,
      canSave: feeRows.length > 0,
    };
  }

  const narrowIdx = findNarrowTemplateHeaderIndex(aoa);
  if (narrowIdx >= 0) {
    const { headers, rawRows } = extractTableFromSheet(sheet, narrowIdx);
    const jsonRows = utils.sheet_to_json<Record<string, unknown>>(sheet, { range: narrowIdx, defval: null });
    const narrowKeys = resolveNarrowColumnKeys(headers);
    let feeRows: FeeInput[] = [];
    let narrowErrors: string[] = [];

    if (narrowKeys) {
      const result = parseNarrowTemplateLayout(jsonRows, narrowKeys);
      feeRows = result.rows;
      narrowErrors = result.errors;
    } else {
      narrowErrors = ['Could not map Course, Sub Course, Particulars, and an amount column (e.g. Original Fees).'];
    }

    return {
      headers,
      rawRows,
      rows: feeRows,
      errors: narrowErrors,
      layout: 'lakshya-narrow',
      sheetName,
      canSave: feeRows.length > 0,
    };
  }

  const flatIdx = findStandardHeaderIndex(aoa);
  if (flatIdx >= 0) {
    const { headers, rawRows } = extractTableFromSheet(sheet, flatIdx);
    const jsonRows = utils.sheet_to_json<Record<string, unknown>>(sheet, { range: flatIdx, defval: null });
    const result = parseStandardLayout(jsonRows, flatIdx);
    return {
      headers,
      rawRows,
      rows: result.rows,
      errors: result.errors,
      layout: 'flat-rows',
      sheetName,
      canSave: result.rows.length > 0,
    };
  }

  const guessIdx = findBestGuessHeaderIndex(aoa);
  if (guessIdx >= 0) {
    const { headers, rawRows } = extractTableFromSheet(sheet, guessIdx);
    if (headers.length > 0 && rawRows.length > 0) {
      if (!singleSheetMode) {
        sheetErrors.push(
          `Sheet "${sheetName}": no Lakshya header (course + fee columns) or flat import layout detected; showing raw grid only.`
        );
      }
      return {
        headers,
        rawRows,
        rows: [],
        errors: singleSheetMode
          ? [
              'This tab has no recognizable import header (course + fee columns, or flat fee columns). Showing raw cells only.',
            ]
          : sheetErrors,
        layout: 'raw-only',
        sheetName,
        canSave: false,
      };
    }
  }

  return null;
}

const emptyResult = (errors: string[]): FeeUploadParseResult => ({
  headers: [],
  rawRows: [],
  rows: [],
  errors,
  layout: null,
  sheetName: null,
  canSave: false,
});

export function parseUploadedFeeFile(
  buffer: Buffer,
  fileName: string,
  options?: ParseUploadedFeeOptions
): FeeUploadParseResult {
  let workbook: WorkBook;
  try {
    workbook = readWorkbook(buffer, fileName);
  } catch {
    return emptyResult(['Could not read the file. Use a valid .xlsx, .xls, or .csv export.']);
  }

  if (workbook.SheetNames.length === 0) {
    return emptyResult(['The file contains no sheets.']);
  }

  const requested = options?.sheetName != null ? String(options.sheetName).trim() : '';
  if (requested) {
    const resolved = resolveWorksheetName(workbook, requested);
    if (!resolved) {
      return emptyResult([
        `Worksheet "${requested}" was not found. Available tabs: ${workbook.SheetNames.join(', ')}`,
      ]);
    }
    const one = tryParseSheet(workbook, resolved, [], true);
    if (one) {
      return one;
    }
    return emptyResult([
      `Could not read a table from worksheet "${resolved}". Check that the tab has a header row and data rows.`,
    ]);
  }

  const sheetErrors: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const result = tryParseSheet(workbook, sheetName, sheetErrors, false);
    if (result) {
      return result;
    }
  }

  return {
    headers: [],
    rawRows: [],
    rows: [],
    errors:
      sheetErrors.length > 0
        ? sheetErrors
        : [
            'No sheet with a detectable header row was found.',
          ],
    layout: null,
    sheetName: null,
    canSave: false,
  };
}

export function validateFlatFileHeaders(fileName: string, buffer: Buffer): { ok: true } | { ok: false; message: string } {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls') && !lower.endsWith('.csv')) {
    return { ok: false, message: 'Please choose a file with extension .xlsx, .xls, or .csv.' };
  }
  if (buffer.length === 0) {
    return { ok: false, message: 'The file is empty.' };
  }
  return { ok: true };
}
