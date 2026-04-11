/**
 * Development seed for default users. Refuses to run when NODE_ENV=production.
 *
 * Usage: `npm run seed:users` (loads `.env` from the project root via `dotenv/config`)
 * Requires DATABASE_URL and the same tables as runtime auth.
 */

import { hashPassword } from '../src/lib/auth/password';
import { createUser, ensureAuthTables, findUserByEmail } from '../src/lib/server/users';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed users in production.');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }

  await ensureAuthTables();

  const seeds: { email: string; role: 'ADMIN' | 'USER' }[] = [
    { email: 'admin@example.com', role: 'ADMIN' },
    { email: 'user@example.com', role: 'USER' },
  ];

  for (const { email, role } of seeds) {
    const existing = await findUserByEmail(email);
    if (existing) {
      console.log(`Skip (exists): ${email}`);
      continue;
    }
    const hash = await hashPassword('password');
    await createUser(email, hash, role);
    console.log(`Created: ${email} (${role})`);
  }

  console.log('Done. Default password for both: password');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
