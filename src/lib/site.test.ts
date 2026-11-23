import { COVER_PHOTOS, SITE_LINKS, VALUES, nextPhoto } from './site';

describe('site facts', () => {
  it('points policy links at the public website', () => {
    expect(SITE_LINKS.privacy.endsWith('/privacy')).toBe(true);
    expect(SITE_LINKS.terms.endsWith('/terms')).toBe(true);
    expect(SITE_LINKS.privacy.startsWith('https://')).toBe(true);
  });
  it('has the six website photos with descriptions, and the four compass values', () => {
    expect(COVER_PHOTOS).toHaveLength(6);
    expect(COVER_PHOTOS.every((p) => p.alt.length > 10 && /\.(jpg|webp)$/.test(p.src))).toBe(true);
    expect(VALUES.map((v) => v.point)).toEqual(['North', 'East', 'South', 'West']);
  });
});

describe('nextPhoto', () => {
  it('advances and wraps around', () => { expect(nextPhoto(0, 3, new Set())).toBe(1); expect(nextPhoto(2, 3, new Set())).toBe(0); });
  it('skips photos that failed to load', () => expect(nextPhoto(0, 4, new Set([1, 2]))).toBe(3));
  it('stays put when nothing else can be shown', () => expect(nextPhoto(1, 3, new Set([0, 2]))).toBe(1));
});
