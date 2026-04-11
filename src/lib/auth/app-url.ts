/** Public site URL for links in emails (no trailing slash). */
export function getAppOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/** Public hostname shown in emails (e.g. finsuite.iiclakshya.com). */
export function getSiteHostname(): string {
  return (process.env.NEXT_PUBLIC_SITE_HOSTNAME ?? 'finsuite.iiclakshya.com').trim();
}
