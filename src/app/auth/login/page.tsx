'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return '/home';
  }
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Sign in failed');
        return;
      }
      const next = safeNextPath(searchParams.get('from'));
      router.replace(next);
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit}>
      <div>
        <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export default function UserLoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 px-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-lg">
        <h1 className="text-2xl font-bold text-slate-900">Sign in</h1>
        <p className="mt-1 text-sm text-slate-600">Use your user account to open the fee calculator.</p>
        <Suspense fallback={<p className="mt-6 text-sm text-slate-500">Loading…</p>}>
          <LoginForm />
        </Suspense>
        <p className="mt-4 text-center text-sm text-slate-600">
          <Link href="/auth/forgot-password" className="text-blue-600 hover:underline">
            Forgot password?
          </Link>
        </p>
      </div>
    </div>
  );
}
