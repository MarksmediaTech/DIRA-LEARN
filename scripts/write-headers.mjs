// Runs after `vite build` (see package.json "build"). Writes the Content-Security-Policy into dist/_headers, using the
// Supabase address the site was built with, so the policy allows exactly that project and nothing else.
// The build FAILS if the address is missing, not https, or the placeholder is missing - a site without its policy is not shipped.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

export function buildCsp({ supabaseUrl, photoOrigin, allowInsecureForTests = false }) {
  let u;
  try { u = new URL(supabaseUrl); } catch { throw new Error('VITE_SUPABASE_URL is missing or not a web address'); }
  if (u.protocol !== 'https:' && !(allowInsecureForTests && u.protocol === 'http:')) throw new Error('VITE_SUPABASE_URL must start with https://');
  const api = u.origin; const ws = (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host;
  const img = ["'self'", 'data:', 'blob:', api, ...(photoOrigin ? [photoOrigin] : [])];
  return [
    "default-src 'self'",
    "script-src 'self'",                                        // no inline scripts, no eval
    "style-src 'self' https://fonts.googleapis.com",            // the site's own CSS and the Google Fonts stylesheet
    "font-src 'self' https://fonts.gstatic.com",
    `img-src ${img.join(' ')}`,                                 // own images, DIRA photos, files from Supabase Storage
    `media-src 'self' blob: ${api}`,
    `connect-src 'self' ${api} ${ws}`,                          // Supabase Auth, Data API, Storage, Edge Functions, Realtime
    "frame-src 'none'", "object-src 'none'", "worker-src 'self' blob:", "manifest-src 'self'",
    "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ...(allowInsecureForTests ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/** External photo host, only while the DIRA photos are not yet stored in public/photos (see tools/photos). */
export function photoOriginFor(localPhotoCount, siteUrl) {
  if (localPhotoCount > 0) return null;
  try { return new URL(siteUrl || 'https://dirafoundationken.netlify.app').origin; } catch { return null; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.join(root, 'dist', '_headers');
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('__CONTENT_SECURITY_POLICY__')) { console.error('dist/_headers has no Content-Security-Policy placeholder'); process.exit(1); }
  const photoDir = path.join(root, 'dist', 'photos');
  const localPhotos = fs.existsSync(photoDir) ? fs.readdirSync(photoDir).filter((f) => f.endsWith('.webp')).length : 0;
  try {
    const csp = buildCsp({ supabaseUrl: process.env.VITE_SUPABASE_URL, photoOrigin: photoOriginFor(localPhotos, process.env.VITE_PUBLIC_SITE_URL) });
    fs.writeFileSync(file, text.replace('__CONTENT_SECURITY_POLICY__', csp));
    console.log('Content-Security-Policy written to dist/_headers');
  } catch (e) { console.error('Build stopped: ' + e.message); process.exit(1); }
}
