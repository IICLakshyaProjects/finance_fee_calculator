import { FeeInput } from '@/lib/fee';

const sanitizeNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

export const parseFeeInput = (payload: unknown): FeeInput | null => {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const candidate = payload as Record<string, unknown>;

  const course = typeof candidate.course === 'string' ? candidate.course.trim() : '';
  const subCourse = typeof candidate.subCourse === 'string' ? candidate.subCourse.trim() : '';
  const particular = typeof candidate.particular === 'string' ? candidate.particular.trim() : '';

  if (!course || !subCourse || !particular) {
    return null;
  }

  const coachingFee = sanitizeNumber(candidate.coachingFee);
  const admissionFee = sanitizeNumber(candidate.admissionFee);
  const studentExpFee = sanitizeNumber(candidate.studentExpFee);
  const materialFee = sanitizeNumber(candidate.materialFee);
  const gstPercentRaw = sanitizeNumber(candidate.gstPercent);
  const otpCoachingFee = sanitizeNumber(candidate.otpCoachingFee);
  const otpGstPercentRaw = sanitizeNumber(candidate.otpGstPercent);
  const normalJoiningAmount = sanitizeNumber(candidate.normalJoiningAmount);
  const normalInstallmentDay1 = sanitizeNumber(candidate.normalInstallmentDay1);
  const normalInstallmentDay30 = sanitizeNumber(candidate.normalInstallmentDay30);
  const normalInstallmentDay60 = sanitizeNumber(candidate.normalInstallmentDay60);
  const otpJoiningAmount = sanitizeNumber(candidate.otpJoiningAmount);
  const otpInstallmentDay1 = sanitizeNumber(candidate.otpInstallmentDay1);
  const otpInstallmentDay30 = sanitizeNumber(candidate.otpInstallmentDay30);
  const otpInstallmentDay60 = sanitizeNumber(candidate.otpInstallmentDay60);

  if (
    coachingFee === null ||
    admissionFee === null ||
    studentExpFee === null ||
    materialFee === null ||
    gstPercentRaw === null ||
    otpCoachingFee === null ||
    otpGstPercentRaw === null
  ) {
    return null;
  }

  const gstPercent = Math.max(0, gstPercentRaw);
  return {
    course,
    subCourse,
    particular,
    coachingFee,
    admissionFee,
    studentExpFee,
    materialFee,
    gstPercent,
    otpCoachingFee,
    otpGstPercent: Math.max(0, otpGstPercentRaw),
    normalJoiningAmount: Math.max(0, normalJoiningAmount ?? 0),
    normalInstallmentDay1: Math.max(0, normalInstallmentDay1 ?? 0),
    normalInstallmentDay30: Math.max(0, normalInstallmentDay30 ?? 0),
    normalInstallmentDay60: Math.max(0, normalInstallmentDay60 ?? 0),
    otpJoiningAmount: Math.max(0, otpJoiningAmount ?? 0),
    otpInstallmentDay1: Math.max(0, otpInstallmentDay1 ?? 0),
    otpInstallmentDay30: Math.max(0, otpInstallmentDay30 ?? 0),
    otpInstallmentDay60: Math.max(0, otpInstallmentDay60 ?? 0),
  };
};

export const generateId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `fee-${Date.now()}`;
};
