'use client';

import {
  ChangeEvent,
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';

import { UserManagementSection } from './user-management-section';
import {
  calculateTotals,
  clampInstallmentCount,
  DEFAULT_INSTALLMENT_DUE_DAYS,
  FeeInput,
  FeeStructure,
  getInstallmentDueDay,
  getPaymentScheduleRowLabel,
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

const formatPreviewCell = (value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
  }
  return String(value);
};

const feeFields = [
  { key: 'coachingFee', label: 'Coaching Fee' },
  { key: 'admissionFee', label: 'Admission Fee' },
  { key: 'studentExpFee', label: 'Student Experience Fee' },
  { key: 'materialFee', label: 'Material Fee' },
] as const;

const baseScheduleFields = paymentScheduleFields.filter(
  (definition) => !('derived' in definition && definition.derived)
);
const derivedSchedule = paymentScheduleFields.find(
  (definition) => 'derived' in definition && definition.derived === true
);

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
  installmentCount: 3,
  installmentDueDays: undefined,
  installmentAmountCaps: undefined,
};

/** Keep legacy amount fields and per-count caps aligned when saving after edits (no fixed length-5 padding). */
const mergeInstallmentCapsWithLegacyFields = (s: FeeInput): FeeInput => {
  const ic = clampInstallmentCount(s.installmentCount ?? 3);
  const base = [...(s.installmentAmountCaps ?? [])];
  while (base.length < ic) {
    base.push(0);
  }
  if (ic >= 1) {
    base[0] = s.normalInstallmentDay1;
  }
  if (ic >= 2) {
    base[1] = s.normalInstallmentDay30;
  }
  if (ic >= 3) {
    base[2] = s.normalInstallmentDay60;
  }
  return { ...s, installmentAmountCaps: base.slice(0, ic) };
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
  normalInstallmentDay1: entry.installmentAmountCaps?.[0] ?? entry.normalInstallmentDay1,
  normalInstallmentDay30: entry.installmentAmountCaps?.[1] ?? entry.normalInstallmentDay30,
  normalInstallmentDay60: entry.installmentAmountCaps?.[2] ?? entry.normalInstallmentDay60,
  otpJoiningAmount: entry.otpJoiningAmount,
  otpInstallmentDay1: entry.otpInstallmentDay1,
  otpInstallmentDay30: entry.otpInstallmentDay30,
  otpInstallmentDay60: entry.otpInstallmentDay60,
  installmentCount: entry.installmentCount ?? 3,
  installmentDueDays: entry.installmentDueDays,
  installmentAmountCaps: entry.installmentAmountCaps,
});

export default function AdminPage() {
  const router = useRouter();
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
  /** Columns detected from the uploaded file header row (exact titles). */
  const [bulkPreviewHeaders, setBulkPreviewHeaders] = useState<string[]>([]);
  /** Row objects keyed by those headers — same structure as the sheet. */
  const [bulkPreviewRawRows, setBulkPreviewRawRows] = useState<Record<string, unknown>[]>([]);
  /** Rows that can be POSTed to /api/fees/upload when layout is Lakshya or flat. */
  const [bulkSaveableRows, setBulkSaveableRows] = useState<FeeInput[]>([]);
  const [bulkCanSave, setBulkCanSave] = useState(false);
  const [bulkPreviewErrors, setBulkPreviewErrors] = useState<string[]>([]);
  const [bulkPreviewSummary, setBulkPreviewSummary] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);
  const [deleteAllMessage, setDeleteAllMessage] = useState<string | null>(null);
  const [templateDownloading, setTemplateDownloading] = useState(false);
  /** Keeps the last chosen file so changing the worksheet tab can re-run preview without re-uploading. */
  const bulkPendingFileRef = useRef<File | null>(null);
  const [bulkSheetNames, setBulkSheetNames] = useState<string[]>([]);
  const [bulkSelectedSheet, setBulkSelectedSheet] = useState('');
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

  const patchInstallmentDueDay =
    (setter: Dispatch<SetStateAction<FeeInput>>, slotIndex: number) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      const nextDay =
        Number.isFinite(value) && value > 0
          ? Math.min(99999, Math.floor(value))
          : DEFAULT_INSTALLMENT_DUE_DAYS[slotIndex];
      setter((prev) => {
        const ic = clampInstallmentCount(prev.installmentCount ?? 3);
        const base: number[] = [];
        for (let i = 0; i < ic; i++) {
          base[i] = prev.installmentDueDays?.[i] ?? DEFAULT_INSTALLMENT_DUE_DAYS[i];
        }
        base[slotIndex] = nextDay;
        return { ...prev, installmentDueDays: base };
      });
    };

  const handleBulkSave = async () => {
    if (!bulkCanSave || bulkSaveableRows.length === 0) {
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
        body: JSON.stringify({ entries: bulkSaveableRows }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const details = Array.isArray(payload.errors) ? ` (${payload.errors.join('; ')})` : '';
        throw new Error(`${payload.error ?? 'Unable to save previewed rows.'}${details}`);
      }

      setBulkSuccess(`${payload.inserted ?? 0} structures imported.`);
      setBulkPreviewHeaders([]);
      setBulkPreviewRawRows([]);
      setBulkSaveableRows([]);
      setBulkCanSave(false);
      setBulkPreviewErrors([]);
      setBulkPreviewSummary(null);
      setBulkSheetNames([]);
      setBulkSelectedSheet('');
      bulkPendingFileRef.current = null;
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

  const fetchBulkPreview = useCallback(async (file: File, sheetName: string) => {
    setBulkParsing(true);
    setBulkError(null);
    setBulkSuccess(null);
    setBulkPreviewHeaders([]);
    setBulkPreviewRawRows([]);
    setBulkSaveableRows([]);
    setBulkCanSave(false);
    setBulkPreviewErrors([]);
    setBulkPreviewSummary(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (sheetName.trim().length > 0) {
        formData.append('sheetName', sheetName.trim());
      }
      const response = await fetch('/api/fees/upload/preview', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        const base = typeof payload.error === 'string' ? payload.error : 'Unable to parse the file.';
        const extra =
          Array.isArray(payload.errors) && payload.errors.length > 0 ? ` ${payload.errors.join(' ')}` : '';
        setBulkPreviewHeaders(Array.isArray(payload.headers) ? payload.headers : []);
        setBulkPreviewRawRows(Array.isArray(payload.rawRows) ? payload.rawRows : []);
        setBulkSaveableRows(Array.isArray(payload.rows) ? (payload.rows as FeeInput[]) : []);
        setBulkCanSave(Boolean(payload.canSave));
        setBulkPreviewErrors(Array.isArray(payload.errors) ? (payload.errors as string[]) : []);
        throw new Error(`${base}${extra}`);
      }

      const headers = Array.isArray(payload.headers) ? (payload.headers as string[]) : [];
      const rawRows = Array.isArray(payload.rawRows) ? (payload.rawRows as Record<string, unknown>[]) : [];
      const saveRows = Array.isArray(payload.rows) ? (payload.rows as FeeInput[]) : [];
      const errors = Array.isArray(payload.errors) ? (payload.errors as string[]) : [];
      setBulkPreviewHeaders(headers);
      setBulkPreviewRawRows(rawRows);
      setBulkSaveableRows(saveRows);
      setBulkCanSave(Boolean(payload.canSave));
      setBulkPreviewErrors(errors);

      const sheetLabel = typeof payload.sheetName === 'string' ? payload.sheetName : null;
      const layout = typeof payload.layout === 'string' ? payload.layout : null;
      const uploadedName = typeof payload.fileName === 'string' ? payload.fileName : file.name;

      let summary = `File: ${uploadedName} — ${rawRows.length} row${rawRows.length === 1 ? '' : 's'} · ${
        headers.length
      } column${headers.length === 1 ? '' : 's'}`;
      if (sheetLabel) {
        summary += ` · tab: ${sheetLabel}`;
      }
      if (layout) {
        const layoutHuman =
          layout === 'lakshya-narrow'
            ? 'Lakshya narrow (Course / Sub Course / Particulars / amount)'
            : layout;
        summary += ` · ${layoutHuman}`;
      }
      summary += '.';
      if (saveRows.length > 0) {
        summary += ` ${saveRows.length} course structure(s) ready to import.`;
      } else if (layout === 'raw-only') {
        summary +=
          ' Import needs a wide Lakshya grid, a narrow Course/Sub Course/Particulars sheet, or flat columns.';
      }
      if (errors.length > 0) {
        summary += ` Notes: ${errors.slice(0, 2).join(' ')}`;
      }
      setBulkPreviewSummary(summary);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Unable to read that file.');
    } finally {
      setBulkParsing(false);
    }
  }, []);

  const handleDownloadTemplate = async () => {
    setBulkError(null);
    setTemplateDownloading(true);
    try {
      const response = await fetch('/api/fees/upload/template');
      if (!response.ok) {
        throw new Error('Could not generate the template file.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'fee-upload-sample.xlsx';
      anchor.rel = 'noopener';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Template download failed.');
    } finally {
      setTemplateDownloading(false);
    }
  };

  const handleBulkFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const allowed = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!allowed) {
      setBulkError('Invalid file type. Use .xlsx, .xls, or .csv.');
      if (bulkFileInputRef.current) {
        bulkFileInputRef.current.value = '';
      }
      return;
    }

    bulkPendingFileRef.current = file;
    setBulkError(null);
    setBulkSuccess(null);
    setBulkSheetNames([]);
    setBulkSelectedSheet('');

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const names = workbook.SheetNames.slice();
      setBulkSheetNames(names);
      const firstSheet = names[0] ?? '';
      setBulkSelectedSheet(firstSheet);
      await fetchBulkPreview(file, firstSheet);
    } catch {
      setBulkError('Could not read worksheet names from this file. Try re-saving the workbook from Excel.');
      setBulkParsing(false);
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
        body: JSON.stringify(mergeInstallmentCapsWithLegacyFields(formState)),
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
        body: JSON.stringify(mergeInstallmentCapsWithLegacyFields(modalFormState)),
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

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/admin/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-slate-50 py-10">
      <div className="mx-auto max-w-6xl space-y-10 px-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-600">
              Finance Admin
            </p>
            <h1 className="text-4xl font-bold text-slate-900">Fee Structure Builder</h1>
            <p className="text-slate-600">
              Add a new course structure once, and the front-facing fee calculator will pick up
              the breakup instantly.
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="shrink-0 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </header>

        <UserManagementSection />

        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-3 space-y-0.5">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Bulk upload</p>
              <h2 className="text-2xl font-semibold text-slate-900">Import fee structures via Excel or CSV</h2>
              <p className="text-sm text-slate-500">
                The preview shows <span className="font-medium text-slate-700">exactly the cells</span> from the
                worksheet tab you select — nothing is injected from elsewhere. Saving to the database is only
                available when that tab matches an import layout the server understands.
              </p>
            </div>
            <div className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                <input
                  ref={bulkFileInputRef}
                  id="bulk-upload-input"
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  onChange={handleBulkFileChange}
                  className="hidden"
                />
                <label
                  htmlFor="bulk-upload-input"
                  className={`inline-flex items-center justify-center rounded-2xl border border-emerald-500 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 ${
                    bulkParsing ? 'pointer-events-none opacity-70' : 'cursor-pointer'
                  }`}
                >
                  {bulkParsing ? 'Parsing file…' : 'Choose file'}
                </label>
                {bulkSheetNames.length > 0 && (
                  <div className="space-y-1">
                    <label htmlFor="bulk-sheet-select" className="text-xs font-semibold text-slate-600">
                      Worksheet tab (preview uses only this tab)
                    </label>
                    <select
                      id="bulk-sheet-select"
                      value={bulkSelectedSheet}
                      onChange={(e) => {
                        const v = e.target.value;
                        setBulkSelectedSheet(v);
                        const pending = bulkPendingFileRef.current;
                        if (pending) {
                          void fetchBulkPreview(pending, v);
                        }
                      }}
                      disabled={bulkParsing}
                      className="mt-1 w-full max-w-md rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:opacity-60"
                    >
                      {bulkSheetNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500">
                      Values and column titles always come from the file you upload. If you see columns you do not
                      expect, switch to another tab — many workbooks include several regional layouts under different
                      sheets.
                    </p>
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  Accepts .xlsx, .xls, or .csv. After upload, choose the tab that matches your fee table.
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
                  <li>
                    Download pulls a slice from your project sample workbook (Lakshya file or{' '}
                    <code className="rounded bg-slate-100 px-1">public/fee-structure-template.xlsx</code>
                    ), not a hand-written grid.
                  </li>
                  <li>
                    Wide sheets: header row must include a <span className="font-medium">course</span> column and
                    a <span className="font-medium">Fees</span> (or fee-type) column; other columns are shown as-is.
                  </li>
                </ul>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  disabled={templateDownloading}
                  className="mt-4 inline-flex items-center rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {templateDownloading ? 'Preparing…' : 'Download sample (.xlsx)'}
                </button>
              </div>
            </div>
            {(bulkPreviewSummary ||
              bulkPreviewRawRows.length > 0 ||
              bulkPreviewHeaders.length > 0 ||
              bulkPreviewErrors.length > 0) && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white/90 p-4 text-sm text-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-800">
                    {bulkPreviewSummary ?? 'Preview results'}
                  </p>
                  {bulkCanSave && bulkSaveableRows.length > 0 && (
                    <button
                      type="button"
                      onClick={handleBulkSave}
                      disabled={bulkSaving}
                      className="inline-flex items-center justify-center rounded-2xl border border-emerald-500 bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    >
                      {bulkSaving ? 'Saving...' : `Save ${bulkSaveableRows.length} structure(s)`}
                    </button>
                  )}
                </div>
                {!bulkCanSave && bulkPreviewRawRows.length > 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    Preview only — this sheet is not in an importable layout (or no courses were parsed). Adjust
                    columns or use a Lakshya-style or flat fee sheet to enable saving.
                  </p>
                )}
                {bulkPreviewErrors.length > 0 && (
                  <p className="mt-2 text-xs text-rose-600">
                    {bulkPreviewErrors.slice(0, 5).join('; ')}
                    {bulkPreviewErrors.length > 5
                      ? ` … (+${bulkPreviewErrors.length - 5} more)`
                      : ''}
                  </p>
                )}
                {bulkPreviewHeaders.length > 0 && bulkPreviewRawRows.length > 0 && (
                  <div className="mt-3 overflow-x-auto text-xs">
                    <table className="min-w-full border-collapse text-left text-slate-600">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          {bulkPreviewHeaders.map((h) => (
                            <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold text-slate-800">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bulkPreviewRawRows.slice(0, 80).map((row, index) => (
                          <tr key={`raw-${index}`} className="border-t border-slate-100">
                            {bulkPreviewHeaders.map((h) => (
                              <td key={h} className="max-w-[14rem] whitespace-pre-wrap break-words px-3 py-2">
                                {formatPreviewCell(row[h])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {bulkPreviewRawRows.length > 80 && (
                      <p className="mt-2 text-xs text-slate-500">
                        Showing first 80 of {bulkPreviewRawRows.length} rows.
                      </p>
                    )}
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
                  <label className="block space-y-1 text-sm font-medium text-slate-700">
                    Installments on fee calculator (applicable schedule)
                    <select
                      value={formState.installmentCount ?? 3}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setFormState((prev) => ({
                          ...prev,
                          installmentCount: v >= 2 && v <= 5 ? v : 3,
                        }));
                      }}
                      className="w-full max-w-xs rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    >
                      {[2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n} installments
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
                    {Array.from({ length: formState.installmentCount ?? 3 }, (_, slotIndex) => (
                      <label
                        key={`due-create-${slotIndex}`}
                        className="space-y-1 text-xs font-medium text-slate-600"
                      >
                        Due day (installment {slotIndex + 1})
                        <input
                          type="number"
                          min={1}
                          value={getInstallmentDueDay(formState, slotIndex)}
                          onChange={patchInstallmentDueDay(setFormState, slotIndex)}
                          className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                        />
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">
                    These numbers appear in installment labels (fee calculator and payment schedules). Defaults
                    are 1, 30, 60, 90, and 120 when left unchanged.
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {baseScheduleFields.map((def) => (
                      <label
                        key={`normal-${def.normalKey}`}
                        className="space-y-1 text-sm font-medium text-slate-700"
                      >
                        {getPaymentScheduleRowLabel(formState, def)}
                        <input
                          type="number"
                          min={0}
                          value={formState[def.normalKey]}
                          onChange={handleNumericChange(def.normalKey)}
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
                      <span>
                        {derivedSchedule
                          ? getPaymentScheduleRowLabel(formState, derivedSchedule)
                          : ''}
                      </span>
                      <span className="font-semibold text-slate-900">
                        {formatWithSymbol(derivedFormState.normalInstallmentDay60)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      {derivedSchedule
                        ? `${getPaymentScheduleRowLabel(formState, derivedSchedule)} = Total (${formatWithSymbol(liveTotals.normalTotal)}) - (Joining + 1st + 2nd)`
                        : ''}
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
                    {baseScheduleFields.map((def) => (
                      <label
                        key={`otp-${def.otpKey}`}
                        className="space-y-1 text-sm font-medium text-slate-700"
                      >
                        {getPaymentScheduleRowLabel(formState, def)}
                        <input
                          type="number"
                          min={0}
                          value={formState[def.otpKey]}
                          onChange={handleNumericChange(def.otpKey)}
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
                      <span>
                        {derivedSchedule
                          ? getPaymentScheduleRowLabel(formState, derivedSchedule)
                          : ''}
                      </span>
                      <span className="font-semibold text-slate-900">
                        {formatWithSymbol(derivedFormState.otpInstallmentDay60)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      {derivedSchedule
                        ? `${getPaymentScheduleRowLabel(formState, derivedSchedule)} = Total (${formatWithSymbol(liveTotals.otpTotal)}) - (Joining + 1st + 2nd)`
                        : ''}
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
                  </tr>
                </thead>
                {filteredEntries.map((entry) => {
                  const totals = calculateTotals(entry);
                  const detailRows = [
                    { label: 'Coaching Fee', original: entry.coachingFee },
                    { label: 'Admission Fee', original: entry.admissionFee },
                    {
                      label: 'Student Experience Fee',
                      original: entry.studentExpFee,
                    },
                    {
                      label: 'Material Fee (included)',
                      original: entry.materialFee,
                    },
                    {
                      label: `GST (${formatPercentLabel(entry.gstPercent)}%)`,
                      original: totals.normalGst,
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
                      </tr>
                    {detailRows.map((row) => (
                        <tr
                          key={`${entry.id}-${row.label}`}
                          className="border-b border-slate-200 bg-slate-50"
                        >
                          <td className="px-4 py-2 text-slate-600">{row.label}</td>
                          <td className="px-4 py-2 text-right text-slate-600">
                            {formatWithSymbol(row.original)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gradient-to-r from-slate-900 to-slate-800 text-white">
                        <td className="px-4 py-3 text-lg font-semibold">Total Fees</td>
                        <td className="px-4 py-3 text-right text-lg font-semibold">
                          {formatWithSymbol(totals.normalTotal)}
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
                    {modalFormState.course || 'Course'} · {modalFormState.subCourse || 'Sub Course'}
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
                    <label className="block space-y-1 text-sm font-medium text-slate-700">
                      Installments on fee calculator (applicable schedule)
                      <select
                        value={modalFormState.installmentCount ?? 3}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setModalFormState((prev) => ({
                            ...prev,
                            installmentCount: v >= 2 && v <= 5 ? v : 3,
                          }));
                        }}
                        className="w-full max-w-xs rounded-2xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      >
                        {[2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n} installments
                          </option>
                        ))}
                      </select>
                    </label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
                    {Array.from({ length: modalFormState.installmentCount ?? 3 }, (_, slotIndex) => (
                      <label
                        key={`due-modal-${slotIndex}`}
                          className="space-y-1 text-xs font-medium text-slate-600"
                        >
                          Due day (installment {slotIndex + 1})
                          <input
                            type="number"
                            min={1}
                            value={getInstallmentDueDay(modalFormState, slotIndex)}
                            onChange={patchInstallmentDueDay(setModalFormState, slotIndex)}
                            className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                          />
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500">
                      Shown in installment labels. Defaults: 1, 30, 60, 90, 120.
                    </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {baseScheduleFields.map((def) => (
                        <label
                          key={`modal-normal-${def.normalKey}`}
                          className="space-y-1 text-sm font-medium text-slate-700"
                        >
                          {getPaymentScheduleRowLabel(modalFormState, def)}
                          <input
                            type="number"
                            min={0}
                            value={modalFormState[def.normalKey]}
                            onChange={handleModalNumericChange(def.normalKey)}
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
                      {paymentScheduleFields.map((def) => (
                        <label
                          key={`modal-otp-${def.otpKey}`}
                          className="space-y-1 text-sm font-medium text-slate-700"
                        >
                          {getPaymentScheduleRowLabel(modalFormState, def)}
                          <input
                            type="number"
                            min={0}
                            value={modalFormState[def.otpKey]}
                            onChange={handleModalNumericChange(def.otpKey)}
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
