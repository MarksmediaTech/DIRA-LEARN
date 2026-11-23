// Cover photographs: the approved DIRA Foundation originals stored in public/photos (prepared by tools/photos/prepare.py:
// resized for phones, tablets and desktops, never cropped or upscaled), or, until those exist, the photos on the website.
export interface LocalPhoto { id: string; alt: string; focal: string; widths: readonly number[]; width: number; height: number }
export interface CoverPhoto { src: string; alt: string; srcSet?: string; position: string }

/** One photo in all prepared widths. `focal` keeps faces in frame when the browser fills a wide or tall area. */
export function localCover(p: LocalPhoto): CoverPhoto {
  const widths = [...p.widths].sort((a, b) => a - b);
  return { src: `/photos/${p.id}-${widths[widths.length - 1]}.webp`, alt: p.alt, position: p.focal,
           srcSet: widths.map((w) => `/photos/${p.id}-${w}.webp ${w}w`).join(', ') };
}

export function coverPhotos(local: readonly LocalPhoto[], remote: readonly { file: string; alt: string }[], siteUrl: string): CoverPhoto[] {
  if (local.length) return local.map(localCover);
  return remote.map((r) => ({ src: `${siteUrl}/assets/photos/${r.file}`, alt: r.alt, position: '50% 50%' }));
}
