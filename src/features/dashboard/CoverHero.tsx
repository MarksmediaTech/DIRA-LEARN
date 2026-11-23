import { COVER_PHOTOS } from '@/lib/site';
import { usePhotoRotation } from '@/lib/usePhotoRotation';
import { PauseButton, PhotoLayers } from '@/components/ui/PhotoStage';

/**
 * Welcome panel: the website's photos cross-fade behind the greeting, as before. Each photograph is shown whole (object-contain,
 * original proportions, never zoomed, stretched or cropped) and sits to the right of the greeting on wider screens; a deep purple
 * wash keeps the text readable and fades out before the photograph starts. People can pause it; it starts paused for
 * reduced-motion users. Glowing multicolour border: `dira-welcome`.
 */
export function CoverHero({ name, roleLabel }: { name: string; roleLabel: string }) {
  const rotation = usePhotoRotation();
  const { index, setIndex, paused, setPaused, failed } = rotation;
  return (
    <header className="dira-welcome relative isolate overflow-hidden rounded-3xl bg-dira-deep text-white shadow-lg">
      {/* photographs are decorative here: the greeting carries the meaning */}
      <PhotoLayers rotation={rotation} align="right" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[#1E0B3DB3] md:bg-transparent md:bg-[linear-gradient(100deg,#1E0B3D_0%,#1E0B3DF2_40%,#1E0B3D00_56%)]" />
      <div className="px-6 py-10 sm:px-10 sm:py-14 md:max-w-[52%] lg:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-dira-orange">{roleLabel}</p>
        <h1 className="mt-3 max-w-2xl font-display text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">Welcome back{name ? `, ${name}` : ''}</h1>
        <p className="mt-3 text-lg font-medium text-dira-lavender">Your voice. <span className="text-dira-orange">Your direction.</span></p>
      </div>
      <div className="flex items-center gap-3 px-6 pb-5 sm:px-10">
        <PauseButton paused={paused} onToggle={() => setPaused(!paused)} />
        <ul className="flex gap-1.5" aria-label="Choose a photo">
          {COVER_PHOTOS.map((p, i) => !failed.has(i) && (
            <li key={p.src}><button type="button" onClick={() => setIndex(i)} aria-label={`Show photo ${i + 1}: ${p.alt}`} aria-current={i === index}
              className={`h-2.5 rounded-full transition-all ${i === index ? 'w-6 bg-dira-orange' : 'w-2.5 bg-white/40 hover:bg-white/70'}`} /></li>
          ))}
        </ul>
      </div>
    </header>
  );
}
