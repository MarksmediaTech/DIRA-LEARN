import { coverPhotos, localCover } from './photoSources';

describe('cover photos', () => {
  const local = [{ id: 'story-4', alt: 'A young woman studying', focal: '50% 30%', widths: [1280, 640, 1920], width: 2400, height: 1600 }];
  it('uses the stored originals in every prepared width, with the focal point', () => {
    const c = localCover(local[0]!);
    expect(c.src).toBe('/photos/story-4-1920.webp');
    expect(c.srcSet).toBe('/photos/story-4-640.webp 640w, /photos/story-4-1280.webp 1280w, /photos/story-4-1920.webp 1920w');
    expect(c.position).toBe('50% 30%');
  });
  it('falls back to the website photos only while no originals are stored', () => {
    expect(coverPhotos([], [{ file: 'a.jpg', alt: 'x' }], 'https://site.example')[0]!.src).toBe('https://site.example/assets/photos/a.jpg');
    expect(coverPhotos(local, [{ file: 'a.jpg', alt: 'x' }], 'https://site.example')[0]!.src.startsWith('/photos/')).toBe(true);
  });
});
