'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  calculateTotals,
  FeeInput,
  FeeStructure,
  paymentScheduleFields,
  preparePaymentState,
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

const feeFields = [
  { key: 'coachingFee', label: 'Coaching Fee' },
  { key: 'admissionFee', label: 'Admission Fee' },
  { key: 'studentExpFee', label: 'Student Experience Fee' },
  { key: 'materialFee', label: 'Material Fee' },
] as const;

const baseScheduleFields = paymentScheduleFields.filter((definition) => !definition.derived);
const derivedSchedule = paymentScheduleFields.find((definition) => definition.derived);

const emptyFormState: FeeInput = {
  course: '',
  subCourse: '',
  particular: '',
  coachingFee: 0,
  admissionFee: 0,
  studentExpFee: 0,
  materialFee: 0,
  gstPercent: 0,
  otpCoachingFee: 0,
  otpGstPercent: 0,
  normalJoiningAmount: 0,
  normalInstallmentDay1: 0,
  normalInstallmentDay30: 0,
  normalInstallmentDay60: 0,
  otpJoiningAmount: 0,
  otpInstallmentDay1: 0,
  otpInstallmentDay30: 0,
  otpInstallmentDay60: 0,
};

const entryToFormState = (entry: FeeStructure): FeeInput => ({
  course: entry.course,
  subCourse: entry.subCourse,
  particular: entry.particular,
  coachingFee: entry.coachingFee,
  admissionFee: entry.admissionFee,
  studentExpFee: entry.studentExpFee,
  materialFee: entry.materialFee,
  gstPercent: entry.gstPercent,
  otpCoachingFee: entry.otpCoachingFee,
  otpGstPercent: entry.otpGstPercent,
  normalJoiningAmount: entry.normalJoiningAmount,
  normalInstallmentDay1: entry.normalInstallmentDay1,
  normalInstallmentDay30: entry.normalInstallmentDay30,
  normalInstallmentDay60: entry.normalInstallmentDay60,
  otpJoiningAmount: entry.otpJoiningAmount,
  otpInstallmentDay1: entry.otpInstallmentDay1,
  otpInstallmentDay30: entry.otpInstallmentDay30,
  otpInstallmentDay60: entry.otpInstallmentDay60,
});

export default function AdminPage() {
  const [formState, setFormState] = useState<FeeInput>(emptyFormState);
  const [entries, setEntries] = useState<FeeStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalFormState, setModalFormState] = useState<FeeInput>(emptyFormState);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [filterCourse, setFilterCourse] = useState<string>('all');
  const [filterSubCourse, setFilterSubCourse] = useState<string>('all');
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkPreviewEntries, setBulkPreviewEntries] = useState<FeeInput[]>([]);
  const [bulkPreviewErrors, setBulkPreviewErrors] = useState<string[]>([]);
  const [bulkPreviewSummary, setBulkPreviewSummary] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);
  const [deleteAllMessage, setDeleteAllMessage] = useState<string | null>(null);
  const bulkFileInputRef = useRef<HTMLInputElement | null>(null);
  const isMountedRef = useRef(true);

  const liveTotals = useMemo(() => calculateTotals(formState), [formState]);
  const modalTotals = useMemo(() => calculateTotals(modalFormState), [modalFormState]);
  const derivedFormState = useMemo(() => preparePaymentState(formState, liveTotals), [
    formState,
    liveTotals,
  ]);
  const normalScheduleSum = useMemo(() => sumPaymentSchedule(formState, 'normal'), [formState]);
  const normalScheduleCheck = liveTotals.normalTotal - normalScheduleSum;
  const otpScheduleSum = useMemo(() => sumPaymentSchedule(formState, 'otp'), [formState]);
  const otpScheduleCheck = liveTotals.otpTotal - otpScheduleSum;
  const modalNormalScheduleSum = useMemo(
    () => sumPaymentSchedule(modalFormState, 'normal'),
    [modalFormState]
  );
  const modalNormalScheduleCheck = modalTotals.normalTotal - modalNormalScheduleSum;
  const modalOtpScheduleSum = useMemo(() => sumPaymentSchedule(modalFormState, 'otp'), [
    modalFormState,
  ]);
  const modalOtpScheduleCheck = modalTotals.otpTotal - modalOtpScheduleSum;
  const courseOptions = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.course))).sort(),
    [entries]
  );

  const subCourseOptions = useMemo(() => {
    const relevant = filterCourse === 'all' ? entries : entries.filter((entry) => entry.course === filterCourse);
    return Array.from(new Set(relevant.map((entry) => entry.subCourse))).sort();
  }, [entries, filterCourse]);

  useEffect(() => {
    if (filterSubCourse !== 'all' && !subCourseOptions.includes(filterSubCourse)) {
      setFilterSubCourse('all');
    }
  }, [filterSubCourse, subCourseOptions]);

  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) => {
        const matchesCourse = filterCourse === 'all' || entry.course === filterCourse;
        const matchesSubCourse = filterSubCourse === 'all' || entry.subCourse === filterSubCourse;
        return matchesCourse && matchesSubCourse;
      }),
    [entries, filterCourse, filterSubCourse]
  );

  const displayedEntriesCount = filteredEntries.length;
  const totalEntriesCount = entries.length;

  const fetchEntriesFromServer = useCallback(async () => {
    const response = await fetch('/api/fees');
    if (!response.ok) {
      throw new Error('Unable to load fee structures.');
    }
    return (await response.json()) as FeeStructure[];
  }, []);

  const refreshEntries = useCallback(async () => {
    if (!isMountedRef.current) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEntriesFromServer();
      if (!isMountedRef.current) {
        return;
      }
      setEntries(data);
    } catch {
      if (!isMountedRef.current) {
        return;
      }
      setError('We could not load the saved fee structures right now.');
    } finally {
      if (!isMountedRef.current) {
        return;
      }
      setLoading(false);
    }
  }, [fetchEntriesFromServer]);

  useEffect(() => {
    isMountedRef.current = true;
    refreshEntries();
    return () => {
      isMountedRef.current = false;
    };
  }, [refreshEntries]);

  const handleNumericChange = (field: keyof Omit<FeeInput, 'course' | 'subCourse' | 'particular'>) => (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const value = Number(event.target.value);
    setFormState((prev) => ({
      ...prev,
      [field]: Number.isFinite(value) ? value : 0,
    }));
  };

  const handleTextChange = (field: 'course' | 'subCourse' | 'particular') => (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    setFormState((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleModalNumericChange = (field: keyof Omit<FeeInput, 'course' | 'subCourse' | 'particular'>) => (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const value = Number(event.target.value);
    setModalFormState((prev) => ({
      ...prev,
      [field]: Number.isFinite(value) ? value : 0,
    }));
  };

  const handleModalTextChange = (field: 'course' | 'subCourse' | 'particular') => (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    setModalFormState((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleBulkSave = async () => {
    if (bulkPreviewEntries.length === 0) {
      return;
    }

    setBulkSaving(true);
    setBulkError(null);
    setBulkSuccess(null);

    try {
      const response = await fetch('/api/fees/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entries: bulkPreviewEntries }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const details = Array.isArray(payload.errors) ? ` (${payload.errors.join('; ')})` : '';
        throw new Error(`${payload.error ?? 'Unable to save previewed rows.'}${details}`);
      }

      setBulkSuccess(`${payload.inserted ?? 0} structures imported.`);
      setBulkPreviewEntries([]);
      setBulkPreviewErrors([]);
      setBulkPreviewSummary(null);
      await refreshEntries();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleDeleteAll = async () => {
    if (deleteAllLoading) {
      return;
    }

    if (
      !window.confirm(
        'Delete absolutely every saved fee structure? This cannot be undone, and the calculator will show no options.'
      )
    ) {
      return;
    }

    setDeleteAllLoading(true);
    setDeleteAllMessage(null);
    setBulkDeleteError(null);

    try {
      const response = await fetch('/api/fees/delete-all', { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to delete all structures.');
      }
      setDeleteAllMessage(`Deleted ${payload.deleted ?? 0} structure(s).`);
      await refreshEntries();
    } catch (err) {
      setBulkDeleteError(err instanceof Error ? err.message : 'Delete all failed.');
    } finally {
      setDeleteAllLoading(false);
    }
  };

  const handleBulkUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setBulkError(null);
    setBulkSuccess(null);
    setBulkPreviewEntries([]);
    setBulkPreviewErrors([]);
    setBulkPreviewSummary(null);
    setBulkParsing(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/fees/upload/preview', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        const details = Array.isArray(payload.errors) ? ` (${payload.errors.join('; ')})` : '';
        throw new Error(`${payload.error ?? 'Unable to parse the file.'}${details}`);
      }

      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      const errors = Array.isArray(payload.errors) ? payload.errors : [];
      setBulkPreviewEntries(rows);
      setBulkPreviewErrors(errors);

      const validCount = rows.length;
      const invalidCount = errors.length;
      let summary = `${validCount} valid row${validCount === 1 ? '' : 's'}`;
      if (invalidCount > 0) {
        summary += `, ${invalidCount} row${invalidCount === 1 ? '' : 's'} had issues`;
      }
      summary += '.';
      setBulkPreviewSummary(summary);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Unable to read that file.');
    } finally {
      setBulkParsing(false);
      if (bulkFileInputRef.current) {
        bulkFileInputRef.current.value = '';
      }
    }
  };

  const isFormValid =
    formState.course.trim().length > 0 &&
    formState.subCourse.trim().length > 0 &&
    formState.particular.trim().length > 0 &&
    liveTotals.normalTotal > 0 &&
    liveTotals.otpTotal > 0;

  const isModalValid =
    modalFormState.course.trim().length > 0 &&
    modalFormState.subCourse.trim().length > 0 &&
    modalFormState.particular.trim().length > 0 &&
    modalTotals.normalTotal > 0 &&
    modalTotals.otpTotal > 0;

  const handleCreateSubmit = async () => {
    if (!isFormValid) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/fees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formState),
      });

      if (!response.ok) {
        throw new Error('Unable to save the structure right now.');
      }

      const saved = (await response.json()) as FeeStructure;
      setEntries((prev) => [saved, ...prev]);
      setFormState(emptyFormState);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while saving the fee structure.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setModalFormState(emptyFormState);
    setModalError(null);
    setModalSaving(false);
  };

  const handleModalSave = async () => {
    if (!isModalValid || !editingId) {
      return;
    }

    setModalSaving(true);
    setModalError(null);

    try {
      const response = await fetch(`/api/fees?id=${encodeURIComponent(editingId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(modalFormState),
      });

      if (!response.ok) {
        throw new Error('Unable to update the structure right now.');
      }

      const updated = (await response.json()) as FeeStructure;
      setEntries((prev) => {
        const others = prev.filter((entry) => entry.id !== updated.id);
        return [updated, ...others];
      });
      handleModalClose();
    } catch (err) {
      setModalError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while updating the fee structure.'
      );
    } finally {
      setModalSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeleteError(null);
    setDeletingId(id);
    try {
      const response = await fetch(`/api/fees?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Unable to delete fee entry.');
      }

      setEntries((prev) => prev.filter((entry) => entry.id !== id));
      if (editingId === id) {
        handleModalClose();
      }
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Unable to delete the fee structure.'
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartEdit = (entry: FeeStructure) => {
    setModalFormState(entryToFormState(entry));
    setEditingId(entry.id);
    setModalError(null);
    setDeleteError(null);
    setIsModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 py-10">
      <div className="mx-auto max-w-6xl space-y-10 px-4 sm:px-6 lg:px-8">
        <header className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-600">
            Finance Admin
          </p>
          <h1 className="text-4xl font-bold text-slate-900">Fee Structure Builder</h1>
          <p className="text-slate-600">
            Add a new course structure once, and the front-facing fee calculator will pick up
            the breakup instantly.
          </p>
        </header>

        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-3 space-y-0.5">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Bulk upload</p>
              <h2 className="text-2xl font-semibold text-slate-900">Import fee structures via Excel</h2>
              <p className="text-sm text-slate-500">
                Upload an .xlsx or .xls sheet with the columns shown below and the admin portal will
                ingest the records in one go.
              </p>
            </div>
            <div className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                <input
                  ref={bulkFileInputRef}
                  id="bulk-upload-input"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleBulkUpload}
                  className="hidden"
                />
                <label
                  htmlFor="bulk-upload-input"
                  className="inline-flex items-center justify-center rounded-2xl border border-emerald-500 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                >
                  {bulkParsing ? 'Parsing file...' : 'Choose Excel file'}
                </label>
                <p className="text-xs text-slate-500">
                  Accepts Excel workbooks only. Each sheet row must include the required columns.
                </p>
                {bulkSuccess && (
                  <p className="text-sm text-emerald-600" aria-live="polite">
                    {bulkSuccess}
                  </p>
                )}
                {bulkError && (
                  <p className="text-sm text-rose-600" aria-live="assertive">
                    {bulkError}
                  </p>
                )}
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4 text-sm text-slate-600">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  Sheet guidance
                </p>
                <ul className="mt-3 space-y-1 text-xs leading-relaxed text-slate-600">
                  <li>Course / Sub Course / Particular are mandatory text fields.</li>
                  <li>Fees: Coaching, Admission, Student Experience, Material, GST %.</li>
                  <li>OTP overrides: OTP Coaching Fee and OTP GST % (rest copied from normal).</li>
                  <li>Payment schedule: Joining, 1st (Day 1), 2nd (Day 30) for both normal and OTP.</li>
                  <li>3rd installment is derived automatically, so leave that column empty.</li>
                </ul>
                <a
                  href="/fee-structure-template.xlsx"
                  download
                  className="mt-4 inline-flex items-center text-xs font-semibold text-emerald-600 underline-offset-2 transition hover:text-emerald-500"
                >
                  Download template
                </a>
              </div>
            </div>
            {(bulkPreviewSummary || bulkPreviewEntries.length > 0 || bulkPreviewErrors.length > 0) && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white/90 p-4 text-sm text-slate-600">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-800">
                    {bulkPreviewSummary ?? 'Preview results'}
                  </p>
                  {bulkPreviewEntries.length > 0 && (
                    <button
                      type="button"
                      onClick={handleBulkSave}
                      disabled={bulkSaving}
                      className="inline-flex items-center justify-center rounded-2xl border border-emerald-500 bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    >
                      {bulkSaving ? 'Saving...' : 'Save previewed structures'}
                    </button>
                  )}
                </div>
                {bulkPreviewErrors.length > 0 && (
                  <p className="text-xs text-rose-600">
                    {bulkPreviewErrors.slice(0, 3).join('; ')}
                    {bulkPreviewErrors.length > 3
                      ? ` and ${bulkPreviewErrors.length - 3} more row${
                          bulkPreviewErrors.length - 3 === 1 ? '' : 's'
                        }`
                      : ''}
                  </p>
                )}
                {bulkPreviewEntries.length > 0 && (
                  <div className="mt-3 overflow-x-auto text-xs">
                    <table className="min-w-full text-left text-slate-600">
                      <thead>
                        <tr>
                          <th className="px-3 py-2 font-semibold">Course</th>
                          <th className="px-3 py-2 font-semibold">Sub Course</th>
                          <th className="px-3 py-2 font-semibold">Particular</th>
                          <th className="px-3 py-2 font-semibold">Coaching</th>
                          <th className="px-3 py-2 font-semibold">GST</th>
                          <th className="px-3 py-2 font-semibold">OTP Coaching</th>
                          <th className="px-3 py-2 font-semibold">OTP GST</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkPreviewEntries.slice(0, 5).map((row, index) => (
                          <tr
                            key={`${row.course}-${row.subCourse}-${index}`}
                            className="border-t border-slate-100"
                          >
                            <td className="px-3 py-2">{row.course}</td>
                            <td className="px-3 py-2">{row.subCourse}</td>
                            <td className="px-3 py-2">{row.particular}</td>
                            <td className="px-3 py-2">{formatWithSymbol(row.coachingFee)}</td>
                            <td className="px-3 py-2">{row.gstPercent}</td>
                            <td className="px-3 py-2">{formatWithSymbol(row.otpCoachingFee)}</td>
                            <td className="px-3 py-2">{row.otpGstPercent}</td>
                          </tr>
                        ))}
                        {bulkPreviewEntries.length > 5 && (
                          <tr>
                            <td colSpan={7} className="px-3 py-2 text-xs text-slate-500">
                              Showing first 5 rows.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-6 space-y-1">
              <h2 className="text-2xl font-semibold text-slate-900">Admin form</h2>
              <p className="text-sm text-slate-500">
                Create or update a course fee structure and the calculator on the public site will pick
                up the breakdown instantly.
              </p>
            </div>

            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  Course
                  <input
                    value={formState.course}
                    onChange={handleTextChange('course')}
                    className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    placeholder="e.g., ACCA"
                    autoComplete="off"
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  Sub Course
                  <input
                    value={formState.subCourse}
                    onChange={handleTextChange('subCourse')}
                    className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    placeholder="e.g., ACCA F1 - P"
                    autoComplete="off"
                  />
                </label>
                <label className="md:col-span-2 space-y-1 text-sm font-medium text-slate-700">
                  Particular
                  <input
                    value={formState.particular}
                    onChange={handleTextChange('particular')}
                    className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    placeholder="Name shown in the fee table"
                    autoComplete="off"
                  />
                </label>
              </div>

              <div className="space-y-4 rounded-3xl border border-slate-100 bg-slate-50/80 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                      Normal fee structure
                    </p>
                    <p className="text-xs text-slate-500">
                      Coaching, admission, student experience, material, and GST make up the total.
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-slate-700">
                    Total: {formatWithSymbol(liveTotals.normalTotal)}
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {feeFields.map(({ key, label }) => (
                    <label key={key} className="space-y-1 text-sm font-medium text-slate-700">
                      {label}
                      <input
                        type="number"
                        min={0}
                        value={formState[key]}
                        onChange={handleNumericChange(key)}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                    </label>
                  ))}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    GST (%)
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={formState.gstPercent}
                      onChange={handleNumericChange('gstPercent')}
                      className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    />
                  </label>
                </div>
                <div className="space-y-4 rounded-2xl border border-slate-200 bg-white/90 p-4 text-sm text-slate-600">
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Normal payment schedule
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {baseScheduleFields.map(({ normalKey, label }) => (
                      <label
                        key={`normal-${normalKey}`}
                        className="space-y-1 text-sm font-medium text-slate-700"
                      >
                        {label}
                        <input
                          type="number"
                          min={0}
                          value={formState[normalKey]}
                          onChange={handleNumericChange(normalKey)}
                          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
                    <span>Check</span>
                    <span className={normalScheduleCheck === 0 ? 'text-slate-900' : 'text-rose-600'}>
                      {formatWithSymbol(normalScheduleCheck)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {normalScheduleCheck === 0
                      ? 'Installments add up to the normal total.'
                      : 'Difference between the normal total and installment plan.'}
                  </p>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-600">
                    <div className="flex items-center justify-between text-slate-700">
                      <span>{derivedSchedule?.label}</span>
                      <span className="font-semibold text-slate-900">
                        {formatWithSymbol(derivedFormState.normalInstallmentDay60)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      {derivedSchedule?.label} = Total ({formatWithSymbol(liveTotals.normalTotal)}) - (Joining + 1st + 2nd)
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-3xl border border-dashed border-slate-200 bg-white/80 p-5 text-sm text-slate-600">
                <div className="space-y-1">
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                    OTP configuration
                  </p>
                  <p className="text-xs">
                    Coaching and GST are updated for the one-time payment version while other fees stay the same.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    OTP Coaching Fee
                    <input
                      type="number"
                      min={0}
                      value={formState.otpCoachingFee}
                      onChange={handleNumericChange('otpCoachingFee')}
                      className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    OTP GST (%)
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={formState.otpGstPercent}
                      onChange={handleNumericChange('otpGstPercent')}
                      className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    />
                  </label>
                </div>
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
                  <div className="flex items-center justify-between">
                    <span>Total Fees (auto)</span>
                    <span className="font-semibold text-slate-900">{formatWithSymbol(liveTotals.normalTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>GST ({formatPercentLabel(formState.gstPercent)}%)</span>
                    <span>{formatWithSymbol(liveTotals.normalGst)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>OTP Total</span>
                    <span className="font-semibold text-slate-900">
                      {formatWithSymbol(liveTotals.otpTotal)}
                    </span>
                  </div>
                </div>
                <div className="space-y-4 rounded-2xl border border-slate-200 bg-white/90 p-4 text-sm text-slate-600">
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                    OTP payment schedule
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {baseScheduleFields.map(({ otpKey, label }) => (
                      <label
                        key={`otp-${otpKey}`}
                        className="space-y-1 text-sm font-medium text-slate-700"
                      >
                        {label}
                        <input
                          type="number"
                          min={0}
                          value={formState[otpKey]}
                          onChange={handleNumericChange(otpKey)}
                          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
                    <span>Check</span>
                    <span className={otpScheduleCheck === 0 ? 'text-slate-900' : 'text-rose-600'}>
                      {formatWithSymbol(otpScheduleCheck)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {otpScheduleCheck === 0
                      ? 'Installments add up to the OTP total.'
                      : 'Difference between the OTP total and installment plan.'}
                  </p>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-600">
                    <div className="flex items-center justify-between text-slate-700">
                      <span>{derivedSchedule?.label}</span>
                      <span className="font-semibold text-slate-900">
                        {formatWithSymbol(derivedFormState.otpInstallmentDay60)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      {derivedSchedule?.label} = Total ({formatWithSymbol(liveTotals.otpTotal)}) - (Joining + 1st + 2nd)
                    </p>
                  </div>
                </div>
              </div>

              {error && (
                <p className="rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-900">
                  {error}
                </p>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleCreateSubmit}
                  disabled={!isFormValid || saving}
                  className="rounded-2xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {saving ? 'Saving...' : 'Save Fee Structure'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                Saved Structures
              </p>
              <h2 className="text-2xl font-semibold text-slate-900">
                Showing {displayedEntriesCount} of {totalEntriesCount} stored structure
                {totalEntriesCount === 1 ? '' : 's'}
              </h2>
            </div>
            <span className="rounded-full border border-slate-300 px-4 py-1 text-sm">
              Sorted by newest
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            <label className="space-y-1 text-xs uppercase tracking-[0.4em] text-slate-400">
              Course filter
              <select
                value={filterCourse}
                onChange={(event) => setFilterCourse(event.target.value)}
                className="block rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
              >
                <option value="all">All courses</option>
                {courseOptions.map((course) => (
                  <option key={course} value={course}>
                    {course}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs uppercase tracking-[0.4em] text-slate-400">
              Sub course filter
              <select
                value={filterSubCourse}
                onChange={(event) => setFilterSubCourse(event.target.value)}
                className="block rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
              >
                <option value="all">All sub courses</option>
                {subCourseOptions.map((subCourse) => (
                  <option key={subCourse} value={subCourse}>
                    {subCourse}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleDeleteAll}
              disabled={deleteAllLoading}
              className="rounded-2xl border border-rose-500 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-rose-200 disabled:text-rose-300"
            >
              {deleteAllLoading ? 'Deleting all…' : 'Delete all saved structures'}
            </button>
            {deleteAllMessage && <p className="text-xs text-rose-600">{deleteAllMessage}</p>}
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Course</th>
                    <th className="px-4 py-3 text-left font-semibold">Sub Course</th>
                    <th className="px-4 py-3 text-left font-semibold">Particulars</th>
                    <th className="px-4 py-3 text-right font-semibold">Original Fees</th>
                    <th className="px-4 py-3 text-right font-semibold">One Time Payment</th>
                  </tr>
                </thead>
                {filteredEntries.map((entry) => {
                  const totals = calculateTotals(entry);
                  const detailRows = [
                    { label: 'Coaching Fee', original: entry.coachingFee, otp: entry.otpCoachingFee },
                    { label: 'Admission Fee', original: entry.admissionFee, otp: entry.admissionFee },
                    {
                      label: 'Student Experience Fee',
                      original: entry.studentExpFee,
                      otp: entry.studentExpFee,
                    },
                    {
                      label: 'Material Fee (included)',
                      original: entry.materialFee,
                      otp: entry.materialFee,
                    },
                    {
                      label: `GST (${formatPercentLabel(entry.gstPercent)}%)`,
                      original: totals.normalGst,
                      otp: totals.otpGst,
                      otpLabel: `${formatPercentLabel(entry.otpGstPercent)}%`,
                    },
                  ];

                  return (
                    <tbody key={entry.id}>
                      <tr className="border-b border-slate-200 bg-white">
                        <td
                          rowSpan={detailRows.length + 2}
                          className="px-4 py-3 font-semibold text-slate-700"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span>{entry.course}</span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleStartEdit(entry)}
                                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(entry.id)}
                                disabled={deletingId === entry.id}
                                className="rounded-full border border-rose-400 px-3 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-rose-200 disabled:text-rose-300"
                              >
                                {deletingId === entry.id ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>
                          </div>
                        </td>
                        <td
                          rowSpan={detailRows.length + 2}
                          className="px-4 py-3 font-semibold text-slate-700"
                        >
                          {entry.subCourse}
                        </td>
                        <td className="px-4 py-3 text-lg font-semibold text-slate-900">
                          {entry.particular}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-900">
                          {formatWithSymbol(totals.normalTotal)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-900">
                          <span className="block text-base font-semibold">
                            {formatWithSymbol(totals.otpTotal)}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatPercentLabel(totals.discountPercent)}% off
                          </span>
                        </td>
                      </tr>
                    {detailRows.map((row) => {
                      const otpValue = row.otp ?? row.original;
                      return (
                        <tr
                          key={`${entry.id}-${row.label}`}
                          className="border-b border-slate-200 bg-slate-50"
                        >
                          <td className="px-4 py-2 text-slate-600">{row.label}</td>
                          <td className="px-4 py-2 text-right text-slate-600">
                            {formatWithSymbol(row.original)}
                          </td>
                          <td className="px-4 py-2 text-right text-slate-600">
                            <span>{formatWithSymbol(otpValue)}</span>
                            {row.otpLabel && (
                              <span className="block text-xs text-slate-500">{row.otpLabel}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                      <tr className="bg-gradient-to-r from-slate-900 to-slate-800 text-white">
                        <td className="px-4 py-3 text-lg font-semibold">Total Fees</td>
                        <td className="px-4 py-3 text-right text-lg font-semibold">
                          {formatWithSymbol(totals.normalTotal)}
                        </td>
                        <td className="px-4 py-3 text-right text-lg font-semibold">
                          {formatWithSymbol(totals.otpTotal)}
                        </td>
                      </tr>
                    </tbody>
                  );
                })}
              </table>
            </div>
            {loading && (
              <p className="px-6 py-4 text-sm text-slate-500">Loading saved fee structures...</p>
            )}
            {!loading && totalEntriesCount === 0 && (
              <p className="px-6 py-4 text-sm text-slate-500">
                There are no fee structures yet. Save one using the form above.
              </p>
            )}
            {!loading && totalEntriesCount > 0 && filteredEntries.length === 0 && (
              <p className="px-6 py-4 text-sm text-slate-500">
                No fee structures match the selected filters.
              </p>
            )}
            {deleteError && (
              <p className="px-6 py-4 text-sm text-rose-600">{deleteError}</p>
            )}
          </div>
        </section>

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
            <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl shadow-black/30">
              <header className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Edit structure</p>
                  <p className="text-xl font-semibold text-slate-900">
                    {modalFormState.course || 'Course'} Â· {modalFormState.subCourse || 'Sub Course'}
                  </p>
                  <p className="text-sm text-slate-500">{modalFormState.particular || 'Particular'}</p>
                </div>
                <button
                  type="button"
                  onClick={handleModalClose}
                  className="rounded-2xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                >
                  Close
                </button>
              </header>

              <div className="mt-5 space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    Course
                    <input
                      value={modalFormState.course}
                      onChange={handleModalTextChange('course')}
                      className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      placeholder="e.g., ACCA"
                      autoComplete="off"
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    Sub Course
                    <input
                      value={modalFormState.subCourse}
                      onChange={handleModalTextChange('subCourse')}
                      className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      placeholder="e.g., ACCA F1 - P"
                      autoComplete="off"
                    />
                  </label>
                  <label className="md:col-span-2 space-y-1 text-sm font-medium text-slate-700">
                    Particular
                    <input
                      value={modalFormState.particular}
                      onChange={handleModalTextChange('particular')}
                      className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      placeholder="Name shown in the fee table"
                      autoComplete="off"
                    />
                  </label>
                </div>

                <div className="space-y-4 rounded-3xl border border-slate-100 bg-slate-50/80 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                        Normal fee structure
                      </p>
                      <p className="text-xs text-slate-500">
                        Coaching, admission, student experience, material, and GST combine for the total.
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-slate-700">
                      {formatWithSymbol(modalTotals.normalTotal)}
                    </span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {feeFields.map(({ key, label }) => (
                      <label key={`modal-${key}`} className="space-y-1 text-sm font-medium text-slate-700">
                        {label}
                        <input
                          type="number"
                          min={0}
                          value={modalFormState[key]}
                          onChange={handleModalNumericChange(key)}
                          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1 text-sm font-medium text-slate-700">
                      GST (%)
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={modalFormState.gstPercent}
                        onChange={handleModalNumericChange('gstPercent')}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                    </label>
                  </div>
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white/90 p-4 text-sm text-slate-600">
                    <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                      Normal payment schedule
                    </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {baseScheduleFields.map(({ normalKey, label }) => (
                        <label
                          key={`modal-normal-${normalKey}`}
                          className="space-y-1 text-sm font-medium text-slate-700"
                        >
                          {label}
                          <input
                            type="number"
                            min={0}
                            value={modalFormState[normalKey]}
                            onChange={handleModalNumericChange(normalKey)}
                            className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
                      <span>Check</span>
                      <span className={modalNormalScheduleCheck === 0 ? 'text-slate-900' : 'text-rose-600'}>
                        {formatWithSymbol(modalNormalScheduleCheck)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {modalNormalScheduleCheck === 0
                        ? 'Installments add up to the normal total.'
                        : 'Difference between the normal total and installment plan.'}
                    </p>
                  </div>
                </div>

                <div className="space-y-4 rounded-3xl border border-dashed border-slate-200 bg-white/80 p-5 text-sm text-slate-600">
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                    OTP configuration
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1 text-sm font-medium text-slate-700">
                      OTP Coaching Fee
                      <input
                        type="number"
                        min={0}
                        value={modalFormState.otpCoachingFee}
                        onChange={handleModalNumericChange('otpCoachingFee')}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                    </label>
                    <label className="space-y-1 text-sm font-medium text-slate-700">
                      OTP GST (%)
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={modalFormState.otpGstPercent}
                        onChange={handleModalNumericChange('otpGstPercent')}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                    </label>
                  </div>
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
                    <div className="flex items-center justify-between">
                      <span>Total Fees (auto)</span>
                      <span className="font-semibold text-slate-900">{formatWithSymbol(modalTotals.normalTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>GST ({formatPercentLabel(modalFormState.gstPercent)}%)</span>
                      <span>{formatWithSymbol(modalTotals.normalGst)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>OTP Total</span>
                      <span className="font-semibold text-slate-900">
                        {formatWithSymbol(modalTotals.otpTotal)}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white/90 p-4 text-sm text-slate-600">
                    <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                      OTP payment schedule
                    </p>
                    <div className="grid gap-4 md:grid-cols-2">
                      {paymentScheduleFields.map(({ otpKey, label }) => (
                        <label
                          key={`modal-otp-${otpKey}`}
                          className="space-y-1 text-sm font-medium text-slate-700"
                        >
                          {label}
                          <input
                            type="number"
                            min={0}
                            value={modalFormState[otpKey]}
                            onChange={handleModalNumericChange(otpKey)}
                            className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
                      <span>Check</span>
                      <span className={modalOtpScheduleCheck === 0 ? 'text-slate-900' : 'text-rose-600'}>
                        {formatWithSymbol(modalOtpScheduleCheck)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {modalOtpScheduleCheck === 0
                        ? 'Installments add up to the OTP total.'
                        : 'Difference between the OTP total and installment plan.'}
                    </p>
                  </div>
                </div>

                {modalError && (
                  <p className="rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-900">
                    {modalError}
                  </p>
                )}

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleModalSave}
                    disabled={!isModalValid || modalSaving}
                    className="rounded-2xl bg-slate-900 px-5 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {modalSaving ? 'Saving...' : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    onClick={handleModalClose}
                    className="rounded-2xl border border-slate-300 px-5 py-3 text-base font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
