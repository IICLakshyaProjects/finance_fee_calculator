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
    label: '1st Installment (Day 1)',
    normalKey: 'normalInstallmentDay1',
    otpKey: 'otpInstallmentDay1',
  },
  {
    label: '2nd Installment (Day 30)',
    normalKey: 'normalInstallmentDay30',
    otpKey: 'otpInstallmentDay30',
  },
  {
    label: '3rd Installment (Day 60)',
    normalKey: 'normalInstallmentDay60',
    otpKey: 'otpInstallmentDay60',
    derived: true,
  },
] as const;

type PaymentScheduleDefinition = (typeof paymentScheduleFields)[number];
export type PaymentScheduleSection = 'normal' | 'otp';

type PaymentScheduleFieldKey = PaymentScheduleDefinition['normalKey'] | PaymentScheduleDefinition['otpKey'];

const isDerivedDefinition = (definition: PaymentScheduleDefinition) => Boolean(definition.derived);

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

export const preparePaymentState = (
  entry: FeeInput,
  totals: FeeTotals
): FeeInput => ({
  ...entry,
  normalInstallmentDay60: calculateDerivedInstallment(totals.normalTotal, entry, 'normal'),
  otpInstallmentDay60: calculateDerivedInstallment(totals.otpTotal, entry, 'otp'),
});

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
