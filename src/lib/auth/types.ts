export type UserRole = 'ADMIN' | 'SUPER_ADMIN' | 'USER' | 'SUB_ADMIN';

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};
