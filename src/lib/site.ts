// Facts taken from the public DIRA Foundation website (https://dirafoundationken.netlify.app), read on 8 Nov 2026.
// Change VITE_PUBLIC_SITE_URL if the website moves. Cover photos: the approved originals in public/photos once
// tools/photos/prepare.py has been run (src/lib/photos.generated.ts); until then they load from the website.
import { coverPhotos, type CoverPhoto } from './photoSources';
import { LOCAL_PHOTOS } from './photos.generated';

const fromEnv = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.trim();
export const SITE_URL = (fromEnv || 'https://dirafoundationken.netlify.app').replace(/\/$/, '');
export const SITE_LINKS = { home: SITE_URL, privacy: `${SITE_URL}/privacy`, terms: `${SITE_URL}/terms`, join: `${SITE_URL}/join`, contact: `${SITE_URL}/contact` } as const;

export const CONTACT = { phones: ['0741 928 641', '0702 514 699'], email: 'dirafoundationke@gmail.com' } as const;
export const TAGLINE = 'Your voice. Your direction.';
export const THEME_COLOR = '#1E0B3D';   // the website's theme colour

export type { CoverPhoto } from './photoSources';
const REMOTE_PHOTOS = [
  { file: 'story-4.jpg', alt: 'A young woman studying with her phone and notebook' },
  { file: 'story-5.jpg', alt: 'A young man smiling and looking ahead' },
  { file: 'intake.jpg', alt: 'A young man smiling as he works on his laptop' },
  { file: 'story-2.jpg', alt: 'Young men sitting together on a bench outside' },
  { file: 'story-3.jpg', alt: 'An older woman washing dishes outside her home' },
  { file: 'story-1.jpg', alt: 'Rooftops of a crowded informal settlement seen from above' },
] as const;
export const COVER_PHOTOS: readonly CoverPhoto[] = coverPhotos(LOCAL_PHOTOS, REMOTE_PHOTOS, SITE_URL);

/** The four values from the website, each tied to a compass point. */
export const VALUES = [
  { point: 'North', title: 'Every voice matters', text: 'We listen first, then shape our training around the people in the room.' },
  { point: 'East', title: 'Future-ready skills', text: 'Digital skills, AI tools, content creation and entrepreneurship: the skills clients and employers ask for today.' },
  { point: 'South', title: 'Led by practitioners', text: 'Our trainers create, market and build with these tools every day.' },
  { point: 'West', title: 'Impact first', text: 'Free for every trainee. We measure success by what changes for young people.' },
] as const;

/** Index of the next photo, skipping any that failed to load. Returns the current index when none other is usable. */
export function nextPhoto(current: number, count: number, failed: ReadonlySet<number>): number {
  for (let step = 1; step <= count; step++) { const i = (current + step) % count; if (!failed.has(i)) return i; }
  return current;
}
