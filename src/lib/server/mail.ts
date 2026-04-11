import nodemailer from 'nodemailer';

import { getAppOrigin, getSiteHostname } from '@/lib/auth/app-url';

export function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  return Boolean(host && from);
}

function createTransport() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT ?? '587');
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS ?? '';

  if (!host) {
    throw new Error('SMTP_HOST is not set');
  }

  const secure = port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });
}

export async function sendInviteSetPasswordEmail(params: {
  to: string;
  setPasswordUrl: string;
}): Promise<void> {
  const from = process.env.SMTP_FROM?.trim();
  if (!from) {
    throw new Error('SMTP_FROM is not set');
  }

  const siteUrl = getAppOrigin();
  const hostname = getSiteHostname();
  const siteLinkLabel = hostname.startsWith('http') ? hostname : `https://${hostname}`;

  const subject = `${hostname} — Welcome: set your password`;

  const text = [
    'Hello,',
    '',
    'An account was created for you on FinSuite.',
    '',
    `Portal: ${siteLinkLabel}`,
    `You can also open: ${siteUrl}`,
    '',
    'To activate your account, set your password using this one-time link:',
    params.setPasswordUrl,
    '',
    'This link expires after you complete the setup or when it reaches its time limit.',
    '',
    'If you did not expect this message, you can ignore it.',
    '',
    '— FinSuite',
    hostname,
  ].join('\n');

  const html = professionalInviteHtml({
    hostname,
    siteUrl,
    siteLinkHref: siteLinkLabel,
    setPasswordUrl: params.setPasswordUrl,
  });

  const transport = createTransport();
  await transport.sendMail({
    from,
    to: params.to,
    subject,
    text,
    html,
  });
}

function professionalInviteHtml(opts: {
  hostname: string;
  siteUrl: string;
  siteLinkHref: string;
  setPasswordUrl: string;
}): string {
  const brand = escapeHtml(opts.hostname);
  const siteUrl = escapeHtml(opts.siteUrl);
  const siteLinkHref = escapeHtml(opts.siteLinkHref);
  const setPw = escapeHtml(opts.setPasswordUrl);

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#0f766e;">FinSuite</p>
              <h1 style="margin:12px 0 0 0;font-size:22px;font-weight:700;color:#0f172a;line-height:1.3;">Welcome — your account is ready</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 24px 32px;">
              <p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">Hello,</p>
              <p style="margin:16px 0 0 0;font-size:15px;line-height:1.6;color:#334155;">
                An account was created for you. Your portal is hosted at <strong style="color:#0f172a;">${brand}</strong>.
              </p>
              <p style="margin:20px 0 0 0;font-size:14px;line-height:1.6;color:#64748b;">
                Visit the site:<br/>
                <a href="${siteLinkHref}" style="color:#0d9488;font-weight:600;text-decoration:none;">${siteLinkHref}</a>
              </p>
            
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#334155;">
                Set your password to get started (one-time link):
              </p>
              <a href="${setPw}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#0d9488,#0f766e);color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">Set your password</a>
              <p style="margin:20px 0 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
                After you set your password, this link will no longer work. If you did not expect this email, you can ignore it.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 28px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;">
              <p style="margin:0;font-size:12px;color:#94a3b8;">FinSuite · ${brand}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
}): Promise<void> {
  const from = process.env.SMTP_FROM?.trim();
  if (!from) {
    throw new Error('SMTP_FROM is not set');
  }

  const hostname = getSiteHostname();
  const subject = `${hostname} — Password reset`;

  const text = [
    'You requested a password reset.',
    '',
    `Open this link to set a new password:`,
    params.resetUrl,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  const html = `
    <p>You requested a password reset for <strong>${escapeHtml(hostname)}</strong>.</p>
    <p><a href="${escapeHtml(params.resetUrl)}">Reset password</a></p>
  `;

  const transport = createTransport();
  await transport.sendMail({
    from,
    to: params.to,
    subject,
    text,
    html,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
