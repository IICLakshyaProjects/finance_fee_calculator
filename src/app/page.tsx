import { redirect } from 'next/navigation';

/** Fallback when middleware does not run; normal flow: middleware sends users to `/home` or `/auth/login`. */
export default function RootPage() {
  redirect('/home');
}
