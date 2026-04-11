'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

import type { UserRole } from '@/lib/auth/types';

type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  department: string | null;
  role: UserRole;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
};

const PAGE_SIZE = 10;
const CREATE_USER_ROLES: UserRole[] = ['USER', 'ADMIN'];

function PencilIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function formatCreated(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export function UserManagementSection() {
  const [myRole, setMyRole] = useState<UserRole | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingUser, setEditingUser] = useState<PublicUser | null>(null);
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('USER');
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { user?: { role?: UserRole } };
      if (data.user?.role) {
        setMyRole(data.user.role);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadUsers = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setListLoading(true);
    }
    setListError(null);
    try {
      const res = await fetch(
        `/api/users?page=${page}&limit=${PAGE_SIZE}`,
        { credentials: 'include' }
      );
      const data = (await res.json().catch(() => ({}))) as {
        users?: PublicUser[];
        total?: number;
        error?: string;
      };
      if (!res.ok) {
        setListError(data.error ?? 'Could not load users');
        setUsers([]);
        setTotal(0);
        return;
      }
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setListError('Network error');
      setUsers([]);
      setTotal(0);
    } finally {
      if (!silent) {
        setListLoading(false);
      }
    }
  }, [page]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const openCreate = () => {
    setModalMode('create');
    setEditingUser(null);
    setFormEmail('');
    setFormPassword('');
    setFormRole('USER');
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (u: PublicUser) => {
    setModalMode('edit');
    setEditingUser(u);
    setFormEmail(u.email);
    setFormPassword('');
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (formSaving) return;
    setModalOpen(false);
  };

  const onSubmitForm = async (e: FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    setFormError(null);

    try {
      if (modalMode === 'create') {
        const res = await fetch('/api/users', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formEmail.trim(),
            role: formRole,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          inviteSent?: boolean;
          inviteLink?: string;
        };
        if (!res.ok) {
          if (res.status === 502 && data.inviteLink) {
            setFormError(
              `${data.error ?? 'Email failed'}\n\nCopy link for the user:\n${data.inviteLink}`
            );
          } else {
            setFormError(data.error ?? 'Could not create user');
          }
          return;
        }
        const okMsg =
          data.inviteSent === true
            ? 'User created. They will receive an email with a link to set their password.'
            : data.inviteLink
              ? `User created (SMTP not configured). Share this link: ${data.inviteLink}`
              : 'User created.';
        setBanner({ type: 'ok', text: okMsg });
        setModalOpen(false);
        if (page === 1) {
          await loadUsers({ silent: true });
        } else {
          setPage(1);
        }
        return;
      }

      if (!editingUser) return;

      const nextEmail = formEmail.trim().toLowerCase();
      const pwd = formPassword.trim();
      if (!nextEmail) {
        setFormError('Email is required');
        return;
      }
      if (pwd.length > 0 && pwd.length < 8) {
        setFormError('Password must be at least 8 characters, or leave empty to keep the current one');
        return;
      }

      const body: Record<string, unknown> = { email: nextEmail };
      if (pwd.length > 0) {
        body.password = pwd;
      }

      const res = await fetch(`/api/users/${encodeURIComponent(editingUser.id)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        user?: PublicUser;
        error?: string;
      };
      if (!res.ok) {
        setFormError(data.error ?? 'Could not update user');
        return;
      }
      if (data.user) {
        setUsers((prev) => prev.map((u) => (u.id === data.user!.id ? data.user! : u)));
      }
      setBanner({ type: 'ok', text: 'User updated.' });
      setModalOpen(false);
    } catch {
      setFormError('Network error');
    } finally {
      setFormSaving(false);
    }
  };

  const onDelete = async (u: PublicUser) => {
    if (
      !window.confirm(
        `Permanently delete ${u.email}? This cannot be undone.`
      )
    ) {
      return;
    }
    setDeletingId(u.id);
    setBanner(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(u.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setBanner({ type: 'err', text: data.error ?? 'Could not remove user' });
        return;
      }
      setBanner({ type: 'ok', text: 'User removed.' });
      await loadUsers({ silent: true });
    } catch {
      setBanner({ type: 'err', text: 'Network error' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Administration</p>
            <h2 className="text-2xl font-semibold text-slate-900">User management</h2>
            <p className="mt-1 text-sm text-slate-500">
              New users get an email with a one-time link to set their password. Edit users to change email or
              optional password here.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            Create user
          </button>
        </div>

        {banner && (
          <p
            className={`mt-4 text-sm ${banner.type === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}
            role="status"
          >
            {banner.text}
          </p>
        )}

        {listError && (
          <p className="mt-4 text-sm text-rose-600" role="alert">
            {listError}
          </p>
        )}

        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-100">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
              {listLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Loading users…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No users yet.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-medium text-slate-900">{u.email}</td>
                    <td className="px-4 py-3">{u.role}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          u.status === 'ACTIVE'
                            ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800'
                            : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600'
                        }
                      >
                        {u.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatCreated(u.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          disabled={u.role === 'SUPER_ADMIN' && myRole !== 'SUPER_ADMIN'}
                          title={
                            u.role === 'SUPER_ADMIN' && myRole !== 'SUPER_ADMIN'
                              ? 'Only a super admin can edit this account'
                              : undefined
                          }
                          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-700 transition hover:border-emerald-300 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Edit ${u.email}`}
                        >
                          <PencilIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(u)}
                          disabled={deletingId === u.id}
                          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-700 transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-50"
                          aria-label={`Remove ${u.email}`}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!listLoading && total > 0 && (
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-slate-600">
              Page {page} of {totalPages} · {total} user{total === 1 ? '' : 's'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 id="user-modal-title" className="text-lg font-semibold text-slate-900">
              {modalMode === 'create' ? 'Create user' : 'Edit user'}
            </h3>
            <form className="mt-4 space-y-4" onSubmit={onSubmitForm}>
              {modalMode === 'create' && (
                <>
                  <div>
                    <label
                      htmlFor="um-email"
                      className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      Email
                    </label>
                    <input
                      id="um-email"
                      type="email"
                      required
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      autoComplete="email"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="um-role"
                      className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      Role
                    </label>
                    <select
                      id="um-role"
                      value={formRole}
                      onChange={(e) => setFormRole(e.target.value as UserRole)}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    >
                      {CREATE_USER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r === 'USER' ? 'User' : 'Admin'}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              {modalMode === 'edit' && (
                <>
                  <div>
                    <label
                      htmlFor="um-email-edit"
                      className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      Email
                    </label>
                    <input
                      id="um-email-edit"
                      type="email"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      autoComplete="email"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="um-password-edit"
                      className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      Password <span className="font-normal normal-case text-slate-400">(optional)</span>
                    </label>
                    <input
                      id="um-password-edit"
                      type="password"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="Leave empty to keep current password"
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      autoComplete="new-password"
                    />
                  </div>
                </>
              )}
              {formError && <p className="text-sm text-rose-600">{formError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={formSaving}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {formSaving ? 'Saving…' : modalMode === 'create' ? 'Create' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
