import { Pause, Play } from 'lucide-react';
import { COVER_PHOTOS } from '@/lib/site';
import { usePhotoRotation } from '@/lib/usePhotoRotation';

type Rotation = ReturnType<typeof usePhotoRotation>;

/**
 * The website photos stacked in one frame; the current one cross-fades in. Decorative ambient layer behind a page or a banner.
 * Every photo is shown whole (object-contain, no zoom or drift), so nothing in a photograph is cut off, stretched or enlarged
 * beyond its frame (23 Nov 2026). `align="right"` keeps a whole photograph on the right of a wide banner, clear of the text.
 */
export function PhotoLayers({ rotation, align = 'center' }: { rotation: Pick<Rotation, 'index' | 'failed' | 'markFailed'> & Partial<Pick<Rotation, 'paused'>>; align?: 'center' | 'right' }) {
  const { index, failed, markFailed } = rotation;
  const position = align === 'right' ? 'object-center md:object-right' : 'object-center';
  return (
    <>
      {COVER_PHOTOS.map((p, i) => !failed.has(i) && (
        <img key={p.src} src={p.src} srcSet={p.srcSet} sizes={p.srcSet ? '100vw' : undefined} alt="" aria-hidden loading={i === 0 ? 'eager' : 'lazy'}
          decoding="async" referrerPolicy="no-referrer"
          onError={() => markFailed(i)}
          className={`absolute inset-0 -z-20 h-full w-full object-contain ${position} transition-opacity duration-[1400ms] motion-reduce:transition-none ${i === index ? 'opacity-100' : 'opacity-0'}`} />
      ))}
    </>
  );
}

export const pauseButtonClass =
  'inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-white/20';

export function PauseButton({ paused, onToggle, className = '' }: { paused: boolean; onToggle: () => void; className?: string }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={paused} className={`${pauseButtonClass} ${className}`}>
      {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}{paused ? 'Play photos' : 'Pause photos'}
    </button>
  );
}

/**
 * Full-page animated photo background for the sign-in and account pages. Put it inside a `relative isolate overflow-hidden` page.
 * The deep purple wash (the website's theme colour #1E0B3D) keeps the text readable; if every photo fails, the deep purple shows.
 */
export function AuthBackdrop({ wash = 'side', rotation: shared }: { wash?: 'side' | 'centre'; rotation?: Rotation }) {
  const own = usePhotoRotation();
  const rotation = shared ?? own;
  return (
    <>
      <PhotoLayers rotation={rotation} />
      <div aria-hidden className={`absolute inset-0 -z-10 ${wash === 'side'
        ? 'bg-[linear-gradient(100deg,#1E0B3DF5_0%,#1E0B3DE0_42%,#1E0B3D99_100%)] max-lg:bg-[#1E0B3DE6]'
        : 'bg-[radial-gradient(ellipse_at_center,#1E0B3DB3_0%,#1E0B3DE6_100%)]'}`} />
      <PauseButton paused={rotation.paused} onToggle={() => rotation.setPaused(!rotation.paused)} className="absolute right-4 top-4 z-10" />
    </>
  );
}
