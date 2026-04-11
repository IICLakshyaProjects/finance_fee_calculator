import { redirect } from 'next/navigation';

/** Fallback; middleware normally sends admins to `/admin/dashboard` and others to login. */
export default function AdminRootPage() {
  redirect('/admin/dashboard');
}
