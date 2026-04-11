'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';

import {
  calculateApplicablePaymentSchedule,
  calculateApplicableTotals,
  calculateTotals,
  FeeStructure,
  paymentScheduleFields,
} from '@/lib/fee';

const rupeeSymbol = '\u20B9';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount);

const formatWithSymbol = (amount: number) => `${rupeeSymbol}${formatCurrency(amount)}`;

const formatGstPercentLabel = (percent: number) =>
  Number.isInteger(percent) ? `${percent}` : percent.toFixed(1);

export default function HomePage() {
  const [entries, setEntries] = useState<FeeStructure[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading');
  const [applicableInput, setApplicableInput] = useState('');
  const [courseComboQuery, setCourseComboQuery] = useState('');
  const [courseComboOpen, setCourseComboOpen] = useState(false);

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

  useEffect(() => {
    const entry = entries.find((e) => e.id === selectedId);
    if (entry) {
      setCourseComboQuery(entry.subCourse);
    } else {
      setCourseComboQuery('');
    }
  }, [selectedId, entries]);

  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null;

  const filteredCourseEntries = useMemo(() => {
    const q = courseComboQuery.trim().toLowerCase();
    if (!q) {
      return entries;
    }
    return entries.filter(
      (e) =>
        e.course.toLowerCase().includes(q) ||
        e.subCourse.toLowerCase().includes(q) ||
        e.particular.toLowerCase().includes(q)
    );
  }, [entries, courseComboQuery]);
  const totals = useMemo(
    () => (selectedEntry ? calculateTotals(selectedEntry) : null),
    [selectedEntry]
  );
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

  const applicablePaymentSchedule = useMemo(() => {
    if (!selectedEntry || !applicableTotals) {
      return null;
    }
    return calculateApplicablePaymentSchedule(selectedEntry, applicableTotals.total);
  }, [selectedEntry, applicableTotals]);

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
  const displayOtpTotal =
    otpTotals?.total ??
    applicableTotals?.total ??
    totals?.otpTotal ??
    0;

  const discountNormalToApplicable =
    totals && applicableTotals
      ? Math.max(0, totals.normalTotal - applicableTotals.total)
      : 0;
  const discountApplicableToOtp = otpTotals
    ? otpTotals.savings
    : Math.max(0, displayApplicableTotal - displayOtpTotal);
  const discountTotalCourse =
    totals != null ? Math.max(0, totals.normalTotal - displayOtpTotal) : 0;

  const otpPaymentSchedule = useMemo(() => {
    if (!selectedEntry) {
      return null;
    }
    const otpTotal = displayOtpTotal;
    // Match applicable payment schedule joining (normal joining), not otpJoiningAmount (often unset in data).
    const joining =
      applicablePaymentSchedule?.joining ??
      Math.round(Math.max(0, selectedEntry.normalJoiningAmount));
    const feeWithin7Days = Math.max(0, otpTotal - joining);
    return { otpTotal, joining, feeWithin7Days };
  }, [selectedEntry, displayOtpTotal, applicablePaymentSchedule]);

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
          label: `GST (${formatGstPercentLabel(selectedEntry.gstPercent)}%)`,
          normal: totals.normalGst,
          applicable: applicableTotals?.gst ?? totals.otpGst,
          otp: otpTotals?.gst ?? totals.otpGst,
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
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="relative w-full min-w-0 lg:max-w-md">
              <label
                htmlFor="course-search"
                className="text-xs uppercase tracking-[0.4em] text-slate-400"
              >
                Sub course
              </label>
              <input
                id="course-search"
                type="text"
                role="combobox"
                aria-expanded={courseComboOpen}
                aria-controls="course-options"
                aria-autocomplete="list"
                autoComplete="off"
                placeholder={entries.length === 0 ? 'No courses yet' : 'Search sub course…'}
                disabled={status === 'loading' || entries.length === 0}
                value={courseComboQuery}
                onChange={(event) => {
                  setCourseComboQuery(event.target.value);
                  setCourseComboOpen(true);
                }}
                onFocus={() => setCourseComboOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setCourseComboOpen(false), 180);
                }}
                className="mt-2 w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-base font-medium text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
              />
              {courseComboOpen && entries.length > 0 && filteredCourseEntries.length > 0 && (
                <ul
                  id="course-options"
                  role="listbox"
                  className="absolute left-0 right-0 z-20 mt-2 max-h-60 overflow-auto rounded-2xl border border-slate-200 bg-white py-1 shadow-lg"
                >
                  {filteredCourseEntries.map((entry) => (
                    <li key={entry.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={entry.id === selectedId}
                        className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0 px-4 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setSelectedId(entry.id);
                          setCourseComboQuery(entry.subCourse);
                          setCourseComboOpen(false);
                        }}
                      >
                        <span className="font-medium">{entry.subCourse}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {courseComboOpen && entries.length > 0 && filteredCourseEntries.length === 0 && (
                <p className="absolute left-0 right-0 z-20 mt-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-lg">
                  No courses match your search.
                </p>
              )}
            </div>

            {selectedEntry && totals && (
              <div className="flex w-full flex-col gap-2 lg:max-w-xs lg:items-end lg:text-right">
                <label
                  htmlFor="applicable-fee-input"
                  className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400"
                >
                  Current Total Fee
                </label>
                <input
                  id="applicable-fee-input"
                  type="number"
                  min={0}
                  value={applicableInput}
                  onChange={handleApplicableChange}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 lg:text-right"
                />
                <p className="text-xs text-slate-500 lg:max-w-sm lg:text-right">
                  Admission, Student Experience, and Material fees stay unchanged; the remaining amount
                  is split between tuition and GST.
                </p>
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
                      <th className="px-4 py-3 text-right font-semibold">Current Total Fee</th>
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
                          {formatWithSymbol(row.applicable)}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-900">
                          {formatWithSymbol(row.otp)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gradient-to-r from-slate-900 to-slate-800 text-white">
                      <td className="px-4 py-3 text-lg font-semibold">Total Normal Fee</td>
                      <td className="px-4 py-3 text-right text-lg font-semibold">
                        {formatWithSymbol(totals.normalTotal)}
                      </td>
                      <td className="px-4 py-3 text-right text-lg font-semibold">
                        {formatWithSymbol(displayApplicableTotal)}
                      </td>
                      <td className="px-4 py-3 text-right text-lg font-semibold">
                        {formatWithSymbol(displayOtpTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {(['applicable', 'otp'] as const).map((section) => {
                    const isOtp = section === 'otp';
                    const sectionLabel = isOtp
                      ? 'One-time payment schedule'
                      : 'Applicable payment schedule';
                    const sectionTotal = isOtp
                      ? displayOtpTotal
                      : (applicableTotals?.total ?? totals.normalTotal);

                    const getApplicableAmount = (
                      normalKey: (typeof paymentScheduleFields)[number]['normalKey']
                    ) => {
                      if (!applicablePaymentSchedule) {
                        return 0;
                      }
                      switch (normalKey) {
                        case 'normalJoiningAmount':
                          return applicablePaymentSchedule.joining;
                        case 'normalInstallmentDay1':
                          return applicablePaymentSchedule.installmentDay1;
                        case 'normalInstallmentDay30':
                          return applicablePaymentSchedule.installmentDay2;
                        case 'normalInstallmentDay60':
                          return applicablePaymentSchedule.installmentDay3;
                        default:
                          return 0;
                      }
                    };

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
                          {isOtp && otpPaymentSchedule ? (
                            <>
                              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                <span>Joining Amount</span>
                                <span className="text-slate-900 font-semibold">
                                  {formatWithSymbol(otpPaymentSchedule.joining)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between pb-2">
                                <span>Fee within 7 days from batch start</span>
                                <span className="text-slate-900 font-semibold">
                                  {formatWithSymbol(otpPaymentSchedule.feeWithin7Days)}
                                </span>
                              </div>
                            </>
                          ) : (
                            paymentScheduleFields.map((definition) => (
                              <div
                                key={`${section}-${definition.label}`}
                                className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 last:pb-0"
                              >
                                <span>{definition.label}</span>
                                <span className="text-slate-900 font-semibold">
                                  {formatWithSymbol(getApplicableAmount(definition.normalKey))}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/90 p-5 shadow-sm">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                    Discount
                  </h3>
                  <div className="mt-4 space-y-3 text-sm">
                    <div className="flex flex-col gap-1 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-slate-600">
                        Discount (normal fee → applicable fee)
                      </span>
                      <span className="font-semibold text-slate-900 tabular-nums">
                        {formatWithSymbol(discountNormalToApplicable)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-slate-600">
                        Discount (applicable fee → OTP fee)
                      </span>
                      <span className="font-semibold text-slate-900 tabular-nums">
                        {formatWithSymbol(discountApplicableToOtp)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <span className="font-semibold text-slate-800">
                        Total discount (normal fee → OTP fee)
                      </span>
                      <span className="text-base font-bold text-emerald-700 tabular-nums">
                        {formatWithSymbol(discountTotalCourse)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
