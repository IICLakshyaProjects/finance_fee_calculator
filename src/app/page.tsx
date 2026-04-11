'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';

import {
  calculateApplicableTotals,
  calculateTotals,
  FeeStructure,
  getScheduleValue,
  paymentScheduleFields,
  sumPaymentSchedule,
} from '@/lib/fee';

const rupeeSymbol = '\u20B9';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount);

const formatWithSymbol = (amount: number) => `${rupeeSymbol}${formatCurrency(amount)}`;

const formatPercentLabel = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0';
  }
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
};

export default function HomePage() {
  const [entries, setEntries] = useState<FeeStructure[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading');
  const [applicableInput, setApplicableInput] = useState('');

  useEffect(() => {
    let aborted = false;

    const fetchData = async () => {
      try {
        const response = await fetch('/api/fees');
        if (!response.ok) {
          throw new Error('Failed to load');
        }
        const data = (await response.json()) as FeeStructure[];
        if (!aborted) {
          setEntries(data);
          setStatus('idle');
          if (data.length > 0) {
            setSelectedId(data[0].id);
          }
        }
      } catch {
        if (!aborted) {
          setStatus('error');
        }
      }
    };

    fetchData();
    return () => {
      aborted = true;
    };
  }, []);

  useEffect(() => {
    if (entries.length > 0 && selectedId === null) {
      setSelectedId(entries[0].id);
    }
  }, [entries, selectedId]);

  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null;
  const totals = useMemo(
    () => (selectedEntry ? calculateTotals(selectedEntry) : null),
    [selectedEntry]
  );
  const scheduleSums = useMemo(
    () => ({
      normal: selectedEntry ? sumPaymentSchedule(selectedEntry, 'normal') : 0,
      otp: selectedEntry ? sumPaymentSchedule(selectedEntry, 'otp') : 0,
    }),
    [selectedEntry]
  );
  const scheduleChecks = totals
    ? {
        normal: totals.normalTotal - scheduleSums.normal,
        otp: totals.otpTotal - scheduleSums.otp,
      }
    : { normal: 0, otp: 0 };

  const fixedFees = selectedEntry
    ? selectedEntry.admissionFee + selectedEntry.studentExpFee + selectedEntry.materialFee
    : 0;

  useEffect(() => {
    if (selectedEntry && totals) {
      setApplicableInput(String(Math.round(totals.normalTotal)));
      return;
    }
    setApplicableInput('');
  }, [selectedEntry?.id, totals?.normalTotal]);

  const targetApplicableValue = useMemo(() => {
    if (!totals) {
      return 0;
    }
    const trimmed = applicableInput.trim();
    if (trimmed.length === 0) {
      return totals.normalTotal;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return totals.normalTotal;
    }
    return Math.max(0, parsed);
  }, [applicableInput, totals]);

  const applicableTotals = useMemo(() => {
    if (!selectedEntry || !totals) {
      return null;
    }
    return calculateApplicableTotals(selectedEntry, totals, targetApplicableValue);
  }, [selectedEntry, totals, targetApplicableValue]);

  const handleApplicableChange = (event: ChangeEvent<HTMLInputElement>) => {
    setApplicableInput(event.target.value);
  };

  const otpDiscountRate = 7.5;
  const otpTotals = useMemo(() => {
    if (!applicableTotals) {
      return null;
    }
    const tuition = Math.max(0, applicableTotals.coachingFee * (1 - otpDiscountRate / 100));
    const base = tuition + fixedFees;
    const gst = base * (applicableTotals.gstPercent / 100);
    const total = base + gst;
    const savings = Math.max(0, applicableTotals.total - total);
    const discountPercent = applicableTotals.total > 0 ? (savings / applicableTotals.total) * 100 : 0;
    return {
      coachingFee: tuition,
      gst,
      gstPercent: applicableTotals.gstPercent,
      total,
      savings,
      discountPercent,
      base,
    };
  }, [applicableTotals, fixedFees]);

  const displayApplicableTotal = applicableTotals?.total ?? totals?.normalTotal ?? 0;
  const displayApplicableSavings = applicableTotals?.savings ?? totals?.savings ?? 0;
  const displayApplicableDiscount = applicableTotals?.discountPercent ?? totals?.discountPercent ?? 0;
  const displayOtpTotal =
    otpTotals?.total ??
    applicableTotals?.total ??
    totals?.otpTotal ??
    0;

  const breakdownRows = selectedEntry && totals
    ? [
        {
          label: 'Coaching Fee',
          normal: selectedEntry.coachingFee,
          applicable: applicableTotals?.coachingFee ?? selectedEntry.otpCoachingFee,
          otp: otpTotals?.coachingFee ?? selectedEntry.otpCoachingFee,
        },
        {
          label: 'Admission Fee',
          normal: selectedEntry.admissionFee,
          applicable: selectedEntry.admissionFee,
          otp: selectedEntry.admissionFee,
        },
        {
          label: 'Student Experience Fee',
          normal: selectedEntry.studentExpFee,
          applicable: selectedEntry.studentExpFee,
          otp: selectedEntry.studentExpFee,
        },
        {
          label: 'Material Fee (included)',
          normal: selectedEntry.materialFee,
          applicable: selectedEntry.materialFee,
          otp: selectedEntry.materialFee,
        },
        {
          label: `GST (${formatPercentLabel(selectedEntry.gstPercent)}%)`,
          normal: totals.normalGst,
          applicable: applicableTotals?.gst ?? totals.otpGst,
          applicableLabel: applicableTotals
            ? `${formatPercentLabel(applicableTotals.gstPercent)}%`
            : `${formatPercentLabel(selectedEntry.otpGstPercent)}%`,
          otp: otpTotals?.gst ?? totals.otpGst,
          otpLabel: otpTotals
            ? `${formatPercentLabel(otpTotals.gstPercent)}%`
            : `${formatPercentLabel(selectedEntry.otpGstPercent)}%`,
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 py-10">
      <div className="mx-auto max-w-5xl space-y-6 px-4 sm:px-6 lg:px-8">
        <header className="space-y-2 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-500">
            Finance Fees
          </p>
          <h1 className="text-4xl font-bold text-slate-900">Fee segregation that matches your rate card</h1>
          <p className="text-slate-600">
            Select a course, and we automatically show the Coaching, Admission, Student Experience,
            Material, and GST breakdown along with the one-time payment total.
          </p>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-lg shadow-slate-200/60 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Course selector</p>
              <select
                className="mt-2 w-full max-w-xs rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-base font-medium text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                value={selectedId ?? ''}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                  {entries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.course} · {entry.subCourse}
                    </option>
                  ))}
                  {entries.length === 0 && (
                    <option value="" disabled>
                      None available yet
                    </option>
                  )}
                </select>
              </div>
              {selectedEntry && totals && (
                <div className="space-y-2 text-sm text-slate-500">
                  <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Applicable fee
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={applicableInput}
                    onChange={handleApplicableChange}
                    className="w-full max-w-sm rounded-2xl border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  <p className="text-xs text-slate-500">
                    Admission, Student Experience, and Material fees stay unchanged; the remaining
                    amount is split between tuition and GST.
                  </p>
                </div>
              )}
            </div>
            {selectedEntry && totals && (
              <div className="flex flex-col gap-3">
                <div className="rounded-2xl bg-blue-50 px-4 py-3 text-slate-700">
                  <p className="text-sm font-semibold text-slate-900">{selectedEntry.course}</p>
                  <p className="text-sm">{selectedEntry.subCourse}</p>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 text-slate-700 shadow-sm">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.4em] text-slate-400">
                    <span>Applicable fee</span>
                    <span className="font-semibold text-slate-900">
                      {formatWithSymbol(displayApplicableTotal)}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    {[
                      {
                        label: 'Coaching Fee',
                        value: applicableTotals?.coachingFee ?? selectedEntry.otpCoachingFee,
                      },
                      {
                        label: 'Admission Fee',
                        value: selectedEntry.admissionFee,
                      },
                      {
                        label: 'Student Experience Fee',
                        value: selectedEntry.studentExpFee,
                      },
                      {
                        label: 'Material Fee',
                        value: selectedEntry.materialFee,
                      },
                      {
                        label: `GST (${formatPercentLabel(selectedEntry.otpGstPercent)}%)`,
                        value: applicableTotals?.gst ?? totals.otpGst,
                        detail: applicableTotals
                          ? `${formatPercentLabel(applicableTotals.gstPercent)}%`
                          : undefined,
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between text-slate-600"
                      >
                        <span>{item.label}</span>
                        <span className="text-slate-900">
                          {formatWithSymbol(item.value)}
                          {item.detail && (
                            <span className="block text-xs text-slate-500">
                              {item.detail}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mt-2">
                    Savings: {formatWithSymbol(displayApplicableSavings)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatPercentLabel(displayApplicableDiscount)}% off vs normal total
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-6">
            {status === 'loading' && (
              <p className="text-sm text-slate-500">Loading fee segregation...</p>
            )}
            {status === 'error' && (
              <p className="text-sm text-red-500">Unable to load fees right now.</p>
            )}
            {!selectedEntry && status === 'idle' && (
              <p className="text-sm text-slate-500">
                No course is available yet. Add one from the admin portal (/admin).
              </p>
            )}

            {selectedEntry && totals && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 text-white">
                      <th className="px-4 py-3 text-left font-semibold">Particulars</th>
                      <th className="px-4 py-3 text-right font-semibold">Normal Fee</th>
                      <th className="px-4 py-3 text-right font-semibold">Applicable Fee</th>
                      <th className="px-4 py-3 text-right font-semibold">OTP Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdownRows.map((row) => (
                      <tr key={row.label} className="border-b border-slate-200 bg-white">
                        <td className="px-4 py-2 text-slate-600">{row.label}</td>
                        <td className="px-4 py-2 text-right font-medium text-slate-900">
                          {formatWithSymbol(row.normal)}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-900">
                          <span>{formatWithSymbol(row.applicable)}</span>
                          {row.applicableLabel && (
                            <span className="block text-xs text-slate-500">
                              {row.applicableLabel}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-900">
                          <span>{formatWithSymbol(row.otp)}</span>
                          {row.otpLabel && (
                            <span className="block text-xs text-slate-500">
                              {row.otpLabel}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gradient-to-r from-slate-900 to-slate-800 text-white">
                      <td className="px-4 py-3 text-lg font-semibold">Total Normal Fee</td>
                      <td className="px-4 py-3 text-right text-lg font-semibold">
                        {formatWithSymbol(totals.normalTotal)}
                      </td>
                      <td className="px-4 py-3 text-right text-lg font-semibold">
                        <span className="flex flex-col items-end">
                          <span>{formatWithSymbol(displayApplicableTotal)}</span>
                          <span className="text-xs text-slate-200">
                            {formatPercentLabel(displayApplicableDiscount)}% off
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-lg font-semibold">
                        {formatWithSymbol(displayOtpTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {(['normal', 'otp'] as const).map((section) => {
                    const isOtp = section === 'otp';
                    const sectionLabel = isOtp
                      ? 'One-time payment schedule'
                      : 'Original payment schedule';
                    const sectionTotal = isOtp ? totals.otpTotal : totals.normalTotal;
                    const sectionCheck = scheduleChecks[section];

                    return (
                      <div
                        key={section}
                        className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm"
                      >
                        <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
                          <span>{sectionLabel}</span>
                          <span className="text-slate-900">{formatWithSymbol(sectionTotal)}</span>
                        </div>
                        <div className="mt-4 space-y-2 text-sm text-slate-600">
                          {paymentScheduleFields.map((definition) => (
                            <div
                              key={`${section}-${definition.label}`}
                              className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 last:pb-0"
                            >
                              <span>{definition.label}</span>
                              <span className="text-slate-900 font-semibold">
                                {formatWithSymbol(
                                  getScheduleValue(selectedEntry, definition, section) ?? 0
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm font-semibold">
                          <span>Check</span>
                          <span
                            className={sectionCheck === 0 ? 'text-slate-900' : 'text-rose-600'}
                          >
                            {formatWithSymbol(sectionCheck)}
                          </span>
                        </div>
                        {sectionCheck !== 0 && (
                          <p className="text-xs text-rose-600">
                            Difference between the {isOtp ? 'OTP' : 'original'} total and installment plan.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
