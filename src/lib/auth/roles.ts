import type { UserRole } from '@/lib/auth/types';

/** Roles allowed to use the admin panel and fee mutation APIs. */
export function isAdminRole(role: UserRole | undefined | null): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

/** Roles allowed to use the public fee calculator (`/`). */
export function isUserAppRole(role: UserRole | undefined | null): boolean {
  return role === 'USER' || role === 'SUB_ADMIN';
}
