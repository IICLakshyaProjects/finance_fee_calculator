export type FeeStructure = {
  id: string;
  course: string;
  subCourse: string;
  particular: string;
  coachingFee: number;
  admissionFee: number;
  studentExpFee: number;
  materialFee: number;
  gstPercent: number;
  otpCoachingFee: number;
  otpGstPercent: number;
  normalJoiningAmount: number;
  normalInstallmentDay1: number;
  normalInstallmentDay30: number;
  normalInstallmentDay60: number;
  otpJoiningAmount: number;
  otpInstallmentDay1: number;
  otpInstallmentDay30: number;
  otpInstallmentDay60: number;
  /**
   * Calendar day numbers per installment (1st, 2nd, …), parallel to `installmentAmountCaps`.
   * Stored without padding — only real installments (paired with positive caps).
   */
  installmentDueDays?: number[];
  /**
   * Rupee caps per installment for applicable schedule allocation, parallel to `installmentDueDays`.
   */
  installmentAmountCaps?: number[];
  /** How many installments (2–5). Should match paired due-day / cap arrays when those are set. */
  installmentCount?: number;
  createdAt: string;
};

export type FeeInput = Omit<FeeStructure, 'id' | 'createdAt'>;

export type FeeTotals = {
  normalSubtotal: number;
  normalGst: number;
  normalTotal: number;
  otpSubtotal: number;
  otpGst: number;
  otpTotal: number;
  savings: number;
  discountPercent: number;
  discountMultiplier: number;
};

export const paymentScheduleFields = [
  {
    label: 'Joining Amount',
    normalKey: 'normalJoiningAmount',
    otpKey: 'otpJoiningAmount',
  },
  {
    installmentSlot: 0,
    normalKey: 'normalInstallmentDay1',
    otpKey: 'otpInstallmentDay1',
  },
  {
    installmentSlot: 1,
    normalKey: 'normalInstallmentDay30',
    otpKey: 'otpInstallmentDay30',
  },
  {
    installmentSlot: 2,
    normalKey: 'normalInstallmentDay60',
    otpKey: 'otpInstallmentDay60',
    derived: true,
  },
] as const;

type PaymentScheduleDefinition = (typeof paymentScheduleFields)[number];
export type PaymentScheduleSection = 'normal' | 'otp';

type PaymentScheduleFieldKey = PaymentScheduleDefinition['normalKey'] | PaymentScheduleDefinition['otpKey'];

/** Default due-day labels when `installmentDueDays` is missing or incomplete (by installment index 0…4). */
export const DEFAULT_INSTALLMENT_DUE_DAYS = [1, 30, 60, 90, 120] as const;

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/** Max installments in the applicable payment schedule. */
export const MAX_APPLICABLE_INSTALLMENTS = 5;

/**
 * Keep only parallel slots where due day &gt; 0 and amount cap &gt; 0 (no placeholders).
 */
export function alignInstallmentArrays(
  dueDays?: number[] | null | undefined,
  amountCaps?: number[] | null | undefined
): { dueDays: number[]; amountCaps: number[] } | undefined {
  const maxLen = Math.min(
    MAX_APPLICABLE_INSTALLMENTS,
    Math.max(dueDays?.length ?? 0, amountCaps?.length ?? 0)
  );
  if (maxLen === 0) {
    return undefined;
  }
  const outDue: number[] = [];
  const outCap: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    const d = dueDays?.[i];
    const c = amountCaps?.[i];
    const dayNum = typeof d === 'number' && Number.isFinite(d) ? Math.floor(d) : 0;
    const capNum = typeof c === 'number' && Number.isFinite(c) ? c : 0;
    if (dayNum > 0 && capNum > 0) {
      outDue.push(Math.min(99999, dayNum));
      outCap.push(Math.min(1e12, Math.round(Math.max(0, capNum))));
    }
  }
  return outDue.length > 0 ? { dueDays: outDue, amountCaps: outCap } : undefined;
}

/**
 * Resolved count, per-slot caps, and calendar days for applicable schedule allocation and labels.
 */
export function computeInstallmentScheduleMetadata(entry: FeeInput): {
  count: number;
  caps: number[];
  days: number[];
} {
  const explicit = clampInstallmentCount(entry.installmentCount);
  const aligned = alignInstallmentArrays(entry.installmentDueDays, entry.installmentAmountCaps);

  if (aligned && aligned.dueDays.length >= 2) {
    const count = Math.min(MAX_APPLICABLE_INSTALLMENTS, aligned.dueDays.length);
    return {
      count,
      caps: aligned.amountCaps.slice(0, count),
      days: aligned.dueDays.slice(0, count),
    };
  }

  if (aligned && aligned.dueDays.length === 1) {
    const count = clampInstallmentCount(Math.max(2, explicit));
    const caps: number[] = [aligned.amountCaps[0]];
    const days: number[] = [aligned.dueDays[0]];
    const legacy = [
      entry.normalInstallmentDay1,
      entry.normalInstallmentDay30,
      entry.normalInstallmentDay60,
    ];
    for (let k = 1; k < count; k++) {
      caps.push(Math.round(Math.max(0, legacy[k] ?? 0)));
      days.push(DEFAULT_INSTALLMENT_DUE_DAYS[k] ?? 30 * (k + 1));
    }
    return { count, caps, days };
  }

  const legacyCaps = [
    Math.max(0, entry.normalInstallmentDay1),
    Math.max(0, entry.normalInstallmentDay30),
    Math.max(0, entry.normalInstallmentDay60),
    0,
    0,
  ];
  let lastNonZero = 0;
  for (let i = 0; i < Math.min(MAX_APPLICABLE_INSTALLMENTS, legacyCaps.length); i++) {
    if (legacyCaps[i] > 0) {
      lastNonZero = i + 1;
    }
  }

  const merged = Math.max(explicit, lastNonZero);
  const count = clampInstallmentCount(merged >= 2 ? merged : explicit);

  const caps: number[] = [];
  const days: number[] = [];
  for (let i = 0; i < count; i++) {
    caps.push(Math.round(legacyCaps[i] ?? 0));
    days.push(DEFAULT_INSTALLMENT_DUE_DAYS[i] ?? 30 * (i + 1));
  }
  return { count, caps, days };
}

export function getInstallmentDueDay(entry: FeeInput, index: number): number {
  const raw = entry.installmentDueDays?.[index];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  const meta = computeInstallmentScheduleMetadata(entry);
  if (index >= 0 && index < meta.days.length) {
    return meta.days[index];
  }
  return DEFAULT_INSTALLMENT_DUE_DAYS[index] ?? 30 * (index + 1);
}

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th'] as const;

export function scheduleInstallmentLabel(entry: FeeInput, slotIndex: number): string {
  const day = getInstallmentDueDay(entry, slotIndex);
  const ord =
    ORDINAL[slotIndex] ?? `${slotIndex + 1}${ordinalSuffix(slotIndex + 1)}`;
  return `${ord} Installment (Day ${day})`;
}

export function getPaymentScheduleRowLabel(
  entry: FeeInput,
  definition: PaymentScheduleDefinition
): string {
  if ('installmentSlot' in definition && definition.installmentSlot !== undefined) {
    return scheduleInstallmentLabel(entry, definition.installmentSlot);
  }
  if ('label' in definition && definition.label) {
    return definition.label;
  }
  return '';
}

const isDerivedDefinition = (definition: PaymentScheduleDefinition) =>
  'derived' in definition && Boolean(definition.derived);

const getBaseDefinitions = paymentScheduleFields.filter((definition) => !isDerivedDefinition(definition));

export const sumPaymentSchedule = (entry: FeeInput, section: PaymentScheduleSection) =>
  getBaseDefinitions.reduce((sum, definition) => {
    const key = (section === 'normal' ? definition.normalKey : definition.otpKey) as PaymentScheduleFieldKey;
    return sum + entry[key];
  }, 0);

const calculateDerivedInstallment = (
  total: number,
  entry: FeeInput,
  section: PaymentScheduleSection
): number => {
  const sum = getBaseDefinitions.reduce((acc, definition) => {
    const key = (section === 'normal' ? definition.normalKey : definition.otpKey) as PaymentScheduleFieldKey;
    return acc + entry[key];
  }, 0);
  return Math.max(0, total - sum);
};

export const getScheduleValue = (
  entry: FeeInput,
  totals: FeeTotals,
  definition: PaymentScheduleDefinition,
  section: PaymentScheduleSection
) => {
  if (!isDerivedDefinition(definition)) {
    const key = (section === 'normal' ? definition.normalKey : definition.otpKey) as PaymentScheduleFieldKey;
    return entry[key];
  }

  const total = section === 'normal' ? totals.normalTotal : totals.otpTotal;
  return calculateDerivedInstallment(total, entry, section);
};

export const preparePaymentState = (entry: FeeInput, totals: FeeTotals): FeeInput => {
  if (Array.isArray(entry.installmentAmountCaps) && entry.installmentAmountCaps.length > 0) {
    return { ...entry };
  }
  return {
    ...entry,
    normalInstallmentDay60: calculateDerivedInstallment(totals.normalTotal, entry, 'normal'),
    otpInstallmentDay60: calculateDerivedInstallment(totals.otpTotal, entry, 'otp'),
  };
};

export const calculateTotals = (entry: FeeInput): FeeTotals => {
  const normalSubtotal =
    entry.coachingFee + entry.admissionFee + entry.studentExpFee + entry.materialFee;
  const normalGst = normalSubtotal * (Math.max(0, entry.gstPercent) / 100);
  const normalTotal = normalSubtotal + normalGst;

  const otpSubtotal =
    entry.otpCoachingFee + entry.admissionFee + entry.studentExpFee + entry.materialFee;
  const otpGst = otpSubtotal * (Math.max(0, entry.otpGstPercent) / 100);
  const otpTotal = otpSubtotal + otpGst;

  const savings = Math.max(0, normalTotal - otpTotal);
  const discountPercent = normalTotal > 0 ? (savings / normalTotal) * 100 : 0;
  const discountMultiplier = normalTotal > 0 ? otpTotal / normalTotal : 1;

  return {
    normalSubtotal,
    normalGst,
    normalTotal,
    otpSubtotal,
    otpGst,
    otpTotal,
    savings,
    discountPercent,
    discountMultiplier,
  };
};

export type ApplicableTotals = {
  coachingFee: number;
  gst: number;
  gstPercent: number;
  total: number;
  savings: number;
  discountPercent: number;
  base: number;
  targetTotal: number;
};

export const calculateApplicableTotals = (
  entry: FeeInput,
  totals: FeeTotals,
  targetTotal: number
): ApplicableTotals => {
  const baseOthers = entry.admissionFee + entry.studentExpFee + entry.materialFee;
  const gstPercent = Math.max(0, entry.gstPercent);
  const multiplier = 1 + gstPercent / 100;
  const safeTarget = Number.isFinite(targetTotal) ? Math.max(0, targetTotal) : totals.normalTotal;
  let base = multiplier > 0 ? safeTarget / multiplier : safeTarget;
  base = Math.max(base, baseOthers);
  const coachingFee = Math.max(0, base - baseOthers);
  const gst = base * (gstPercent / 100);
  const total = base + gst;
  const savings = Math.max(0, totals.normalTotal - total);
  const discountPercent = totals.normalTotal > 0 ? (savings / totals.normalTotal) * 100 : 0;
  return {
    coachingFee,
    gst,
    gstPercent,
    total,
    savings,
    discountPercent,
    base,
    targetTotal: safeTarget,
  };
};

/** Installment amounts aligned to the applicable fee total (rounded rupees). */
export type ApplicablePaymentSchedule = {
  joining: number;
  /** One entry per installment row (length = configured installment count, 2–5). */
  installments: number[];
};

export function clampInstallmentCount(raw: number | string | undefined | null): number {
  let n = 3;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    n = Math.floor(raw);
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    const p = Number(raw);
    if (Number.isFinite(p)) {
      n = Math.floor(p);
    }
  }
  return Math.min(5, Math.max(2, n));
}

/** How many installment rows to use in the applicable schedule (derived from metadata). */
export function resolveApplicableInstallmentCount(entry: FeeInput): number {
  return computeInstallmentScheduleMetadata(entry).count;
}

/** Per-slot rupee caps for applicable allocation; length equals `resolveApplicableInstallmentCount`. */
export function getNormalInstallmentCaps(entry: FeeInput): number[] {
  return computeInstallmentScheduleMetadata(entry).caps;
}

/**
 * Rows for the "Applicable payment schedule" UI: joining + N dynamic installments.
 */
export function getApplicablePaymentScheduleRows(
  schedule: ApplicablePaymentSchedule,
  entry: FeeInput
): { label: string; amount: number }[] {
  const rows: { label: string; amount: number }[] = [
    { label: 'Joining Amount', amount: schedule.joining },
  ];
  schedule.installments.forEach((amount, i) => {
    rows.push({ label: scheduleInstallmentLabel(entry, i), amount });
  });
  return rows;
}

/**
 * Build an "applicable" payment schedule: joining plus N installments (2–5).
 * For each of the first N−1 installments, allocate up to the matching template cap; the last gets the remainder.
 * Sum(joining, …installments) equals `applicableTotal` (rounded).
 */
export const calculateApplicablePaymentSchedule = (
  entry: FeeInput,
  applicableTotal: number
): ApplicablePaymentSchedule => {
  const meta = computeInstallmentScheduleMetadata(entry);
  const n = meta.count;
  const T = Math.round(Math.max(0, applicableTotal));
  const J = Math.round(Math.max(0, entry.normalJoiningAmount));
  let pool = Math.max(0, T - J);
  const caps = meta.caps;
  const installments: number[] = [];

  for (let i = 0; i < n; i++) {
    if (i < n - 1) {
      const cap = caps[i] ?? 0;
      const take = Math.min(cap, pool);
      installments.push(take);
      pool -= take;
    } else {
      installments.push(pool);
    }
  }

  return {
    joining: J,
    installments,
  };
};

function parseMaybeJsonArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return fallback;
}

/**
 * Coerce a fee object from GET /api/fees (or similar) into a full `FeeStructure`.
 * Handles snake_case keys, string numbers, and JSONB arrays that arrived as strings.
 */
export function normalizeFeeStructureFromApi(raw: unknown): FeeStructure | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const id = r.id != null ? String(r.id) : '';
  if (!id) {
    return null;
  }

  const pick = (camel: string, snake: string): unknown =>
    r[camel] !== undefined && r[camel] !== null ? r[camel] : r[snake];

  const toNumArray = (value: unknown): number[] | undefined => {
    const arr = parseMaybeJsonArray(value);
    if (!arr) {
      return undefined;
    }
    return arr.slice(0, MAX_APPLICABLE_INSTALLMENTS).map((x) => toFiniteNumber(x, 0));
  };

  const dueNums = toNumArray(pick('installmentDueDays', 'installment_due_days'));
  const capNums = toNumArray(pick('installmentAmountCaps', 'installment_amount_caps'));
  const aligned = alignInstallmentArrays(dueNums, capNums);

  const createdRaw = pick('createdAt', 'created_at');
  const createdAt =
    createdRaw instanceof Date
      ? createdRaw.toISOString()
      : typeof createdRaw === 'string' && createdRaw.length > 0
        ? createdRaw
        : new Date().toISOString();

  return {
    id,
    course: String(pick('course', 'course') ?? ''),
    subCourse: String(pick('subCourse', 'sub_course') ?? ''),
    particular: String(pick('particular', 'particular') ?? ''),
    coachingFee: toFiniteNumber(pick('coachingFee', 'coaching_fee')),
    admissionFee: toFiniteNumber(pick('admissionFee', 'admission_fee')),
    studentExpFee: toFiniteNumber(pick('studentExpFee', 'student_exp_fee')),
    materialFee: toFiniteNumber(pick('materialFee', 'material_fee')),
    gstPercent: toFiniteNumber(pick('gstPercent', 'gst_percent')),
    otpCoachingFee: toFiniteNumber(pick('otpCoachingFee', 'otp_coaching_fee')),
    otpGstPercent: toFiniteNumber(pick('otpGstPercent', 'otp_gst_percent')),
    normalJoiningAmount: toFiniteNumber(pick('normalJoiningAmount', 'normal_joining_amount')),
    normalInstallmentDay1: toFiniteNumber(pick('normalInstallmentDay1', 'normal_installment_day1')),
    normalInstallmentDay30: toFiniteNumber(pick('normalInstallmentDay30', 'normal_installment_day30')),
    normalInstallmentDay60: toFiniteNumber(pick('normalInstallmentDay60', 'normal_installment_day60')),
    otpJoiningAmount: toFiniteNumber(pick('otpJoiningAmount', 'otp_joining_amount')),
    otpInstallmentDay1: toFiniteNumber(pick('otpInstallmentDay1', 'otp_installment_day1')),
    otpInstallmentDay30: toFiniteNumber(pick('otpInstallmentDay30', 'otp_installment_day30')),
    otpInstallmentDay60: toFiniteNumber(pick('otpInstallmentDay60', 'otp_installment_day60')),
    installmentCount:
      aligned && aligned.dueDays.length >= 2
        ? clampInstallmentCount(aligned.dueDays.length)
        : clampInstallmentCount(
            pick('installmentCount', 'installment_count') as number | string | null | undefined
          ),
    installmentDueDays: aligned?.dueDays,
    installmentAmountCaps: aligned?.amountCaps,
    createdAt,
  };
}
