import { redirect } from 'next/navigation';

/** Fallback when proxy does not run; normal flow: proxy sends users to `/home` or `/auth/login`. */
export default function RootPage() {
  redirect('/home');
}
