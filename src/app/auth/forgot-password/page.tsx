'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setDevLink(null);
    setPending(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { resetLink?: string };
      setMessage('If an account exists for that email, you will receive reset instructions.');
      if (data.resetLink) {
        setDevLink(data.resetLink);
      }
    } catch {
      setError('Request failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 px-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-lg">
        <h1 className="text-2xl font-bold text-slate-900">Forgot password</h1>
        <p className="mt-1 text-sm text-slate-600">Enter your email address and we will send a reset link.</p>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label htmlFor="fp-email" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Email
            </label>
            <input
              id="fp-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-slate-700">{message}</p>}
          {devLink && (
            <p className="break-all rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              <span className="font-semibold">Development:</span> {devLink}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-2xl bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {pending ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link href="/auth/login" className="text-blue-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
