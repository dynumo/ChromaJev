import { escapeHtml } from '../util/html.js';
import type { MailMessage } from './mailer.js';

const BRAND = { ink: '#1d1b2e', muted: '#5b5870', accent: '#6d3ae0', bg: '#f6f4fb', card: '#ffffff', border: '#e3dff0' };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }) + ' UTC';
}

function layout(title: string, bodyHtml: string, action: { label: string; url: string }, footer: string): string {
  const swatches = ['#e3242b', '#f57c1f', '#f5c518', '#0f9d58', '#0f8b8d', '#1e88e5', '#7c3aed', '#ff2d87']
    .map((c) => `<td style="width:12.5%;height:6px;background:${c}"></td>`)
    .join('');
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden">
<tr>${swatches}</tr>
<tr><td style="padding:28px 32px 8px"><p style="margin:0;font-size:20px;font-weight:700;letter-spacing:-0.01em">ChromaJev</p></td></tr>
<tr><td style="padding:8px 32px 0;font-size:16px;line-height:1.55">${bodyHtml}</td></tr>
<tr><td style="padding:20px 32px 8px"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${escapeHtml(action.label)}</a></td></tr>
<tr><td style="padding:8px 32px 0;font-size:13px;line-height:1.5;color:${BRAND.muted}">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(action.url)}" style="color:${BRAND.accent};word-break:break-all">${escapeHtml(action.url)}</a></td></tr>
<tr><td style="padding:20px 32px 28px;font-size:13px;line-height:1.5;color:${BRAND.muted}">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const ABOUT =
  'ChromaJev turns a word or phrase into a coordinated, accessible light and dark colour scheme, using TypeSafe’s Jev model for the semantic judgement.';

export function invitationEmail(p: { to: string; url: string; expiresAt: string; invitedBy?: string | null; siteUrl: string }): MailMessage {
  const who = p.invitedBy ? `${p.invitedBy} has invited you` : 'You have been invited';
  const expiry = formatDate(p.expiresAt);
  const html = layout(
    'You are invited to ChromaJev',
    `<p style="margin:0 0 12px">${escapeHtml(who)} to join ChromaJev at <a href="${escapeHtml(p.siteUrl)}" style="color:${BRAND.accent}">${escapeHtml(p.siteUrl)}</a>.</p>
     <p style="margin:0 0 12px;color:${BRAND.muted}">${escapeHtml(ABOUT)}</p>
     <p style="margin:0">Choose a password to finish creating your account. This invitation expires on <strong>${escapeHtml(expiry)}</strong> and can be used once.</p>`,
    { label: 'Accept invitation', url: p.url },
    'If you were not expecting this invitation you can ignore this email; no account will be created.',
  );
  const text = `${who} to join ChromaJev (${p.siteUrl}).

${ABOUT}

Choose a password to finish creating your account:
${p.url}

This invitation expires on ${expiry} and can be used once.
If you were not expecting it, ignore this email; no account will be created.
`;
  return { to: p.to, subject: 'You have been invited to ChromaJev', html, text, kind: 'invitation' };
}

export function verificationEmail(p: { to: string; url: string; expiresAt: string }): MailMessage {
  const expiry = formatDate(p.expiresAt);
  const html = layout(
    'Confirm your email address',
    `<p style="margin:0 0 12px">Thanks for signing up to ChromaJev. Please confirm this is your email address to activate your account.</p>
     <p style="margin:0">The link expires on <strong>${escapeHtml(expiry)}</strong>.</p>`,
    { label: 'Confirm email address', url: p.url },
    'If you did not create a ChromaJev account you can ignore this email.',
  );
  const text = `Thanks for signing up to ChromaJev. Confirm your email address to activate your account:
${p.url}

The link expires on ${expiry}. If you did not sign up, ignore this email.
`;
  return { to: p.to, subject: 'Confirm your ChromaJev email address', html, text, kind: 'verify_email' };
}

export function passwordResetEmail(p: { to: string; url: string; expiresAt: string }): MailMessage {
  const expiry = formatDate(p.expiresAt);
  const html = layout(
    'Reset your password',
    `<p style="margin:0 0 12px">Someone (hopefully you) asked to reset the password for your ChromaJev account.</p>
     <p style="margin:0">The link works once and expires on <strong>${escapeHtml(expiry)}</strong>. Resetting signs you out everywhere.</p>`,
    { label: 'Choose a new password', url: p.url },
    'If you did not ask for this, ignore this email — your password will not change.',
  );
  const text = `Someone asked to reset the password for your ChromaJev account. Choose a new password here:
${p.url}

The link works once and expires on ${expiry}. If you did not ask for this, ignore this email.
`;
  return { to: p.to, subject: 'Reset your ChromaJev password', html, text, kind: 'reset_password' };
}
