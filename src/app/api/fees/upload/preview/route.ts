import { NextResponse } from 'next/server';
import { read, utils } from 'xlsx';

import { FeeInput } from '@/lib/fee';
import { parseFeeInput } from '@/lib/server/fee-utils';

type ColumnDefinition = {
  field: keyof FeeInput;
  keys: string[];
};

const columnDefinitions: ColumnDefinition[] = [
  { field: 'course', keys: ['course'] },
  { field: 'subCourse', keys: ['sub_course', 'subcourse', 'sub course'] },
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

const normalizeColumnKey = (value: string): string =>
  value
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const labelColumnSynonyms = new Set([
  'fees',
  'fee',
  'particular',
  'particulars',
  'description',
  'fee_label',
]);

const findLabelColumnKey = (headers: Array<string | null | undefined>): string | null => {
  for (const header of headers) {
    if (typeof header !== 'string') {
      continue;
    }
    const normalized = normalizeColumnKey(header);
    if (labelColumnSynonyms.has(normalized)) {
      return header;
    }
  }
  return null;
};

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

  return candidate;
};

const hasRowValues = (row: Record<string, unknown>) =>
  Object.values(row).some((value) => value !== null && value !== undefined && `${value}`.trim().length > 0);

const parseTemplateLayout = (
  rows: Record<string, unknown>[],
  headerColumns: Array<string | null | undefined>
): { rows: FeeInput[]; errors: string[] } => {
  const normalizedHeaders = headerColumns.map((value) =>
    typeof value === 'string' ? value.trim() : ''
  );
  const ignoredNames = ['course name'];
  const locationColumns = normalizedHeaders.filter((value) => value);

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
    return { rows: [], errors: ['Excel template has no numeric column for fees.'] };
  }

  const parsePercent = (value: unknown): number | null => {
    if (typeof value !== 'string') {
      return null;
    }
    const match = value.match(/(\d+(\.\d+)?)\s*%/);
    return match ? Number(match[1]) : null;
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
      const otpSubtotal = multiplier > 0 ? currentEntry.otpTotal / multiplier : currentEntry.otpTotal;
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
    const feeRaw = row['Fees'];
    if (!feeRaw) {
      return;
    }
    const feeLabel = typeof feeRaw === 'string' ? feeRaw.trim().toLowerCase() : '';
    const courseRaw = row['Course Name'];
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
      return;
    }
  });

  finalizeEntry();

  return { rows: entries, errors };
};

const parseStandardLayout = (rows: Record<string, unknown>[]): { rows: FeeInput[]; errors: string[] } => {
  const parsedEntries: FeeInput[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    if (!hasRowValues(row)) {
      return;
    }

    const candidate = mapRowToCandidate(row);
    const parsed = parseFeeInput(candidate);
    if (!parsed) {
      errors.push(`Row ${index + 2}: invalid or missing values.`);
      return;
    }

    parsedEntries.push(parsed);
  });

  return { rows: parsedEntries, errors };
};

const isTemplateLayout = (headerRow: Array<string | null | undefined>) => {
  const lowered = headerRow.map((value) =>
    typeof value === 'string' ? value.trim().toLowerCase() : ''
  );
  return lowered.includes('course name') && lowered.includes('fees');
};

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Please upload an Excel file.' }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = read(Buffer.from(arrayBuffer), { type: 'buffer' });
  if (workbook.SheetNames.length === 0) {
    return NextResponse.json({ error: 'Excel file contains no sheets.' }, { status: 400 });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const headerRows = utils.sheet_to_json<string[]>(sheet, { header: 1, range: 1, defval: null });
  const headerRow = headerRows[0] ?? [];
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { range: 1, defval: null });
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Excel file has no rows.' }, { status: 400 });
  }

  const previewResult = isTemplateLayout(headerRow)
    ? parseTemplateLayout(rows, headerRow)
    : parseStandardLayout(rows);

  return NextResponse.json(previewResult, {
    status: previewResult.rows.length === 0 ? 400 : 200,
  });
}

