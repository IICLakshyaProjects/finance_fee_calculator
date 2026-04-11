/** Derive cookie `maxAge` from `JWT_EXPIRES_IN` (e.g. `1d`, `12h`). Defaults to 1 day. */
export function sessionMaxAgeSeconds(): number {
  const raw = process.env.JWT_EXPIRES_IN?.trim() || '1d';
  const m = /^(\d+)\s*([dhms])$/i.exec(raw);
  if (!m) {
    return 86400;
  }
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u === 'd') {
    return n * 86400;
  }
  if (u === 'h') {
    return n * 3600;
  }
  if (u === 'm') {
    return n * 60;
  }
  return n;
}
