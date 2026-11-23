// Pure helpers (no Deno APIs) so they can be unit tested. Brand colours are sampled from the official DIRA Foundation logo.
export const BRAND = { purple: '#4C1D95', orange: '#FE7613', lavender: '#F1E9FA', ink: '#21173A' } as const;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Plain text to safe HTML: everything is escaped first, then blank lines become paragraphs and single newlines become <br>. */
export function textToHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n/g, '\n').trim()).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');
}

/** Only http(s) links are ever placed in the layout. */
export function safeUrl(u: string | undefined): string | null {
  if (!u) return null;
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : null; } catch { return null; }
}

export function wrapLayout(subject: string, bodyText: string, appUrl?: string): string {
  const link = safeUrl(appUrl);
  const button = link ? `<p style="margin:22px 0 0"><a href="${escapeHtml(link)}" style="background:${BRAND.purple};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">Open DIRA Learn</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:${BRAND.lavender};font-family:Arial,Helvetica,sans-serif;color:${BRAND.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${BRAND.purple};padding:20px 28px;color:#ffffff;font-size:20px;font-weight:700">DIRA Learn<span style="color:${BRAND.orange}"> &bull; </span><span style="font-weight:400;font-size:14px">DIRA Foundation</span></td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.55"><h1 style="margin:0 0 16px;font-size:20px;color:${BRAND.purple}">${escapeHtml(subject)}</h1>${textToHtml(bodyText)}${button}</td></tr>
<tr><td style="padding:16px 28px;background:#faf7fd;font-size:12px;color:#6b5b82">&copy; 2026 DIRA Foundation. All rights reserved.<br>Your voice, your direction. To stop receiving these emails, contact the programme team.</td></tr>
</table></td></tr></table></body></html>`;
}
