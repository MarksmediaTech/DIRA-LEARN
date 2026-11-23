import { useCallback, useEffect, useState } from 'react';
import { COVER_PHOTOS, nextPhoto } from '@/lib/site';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Which website photo is showing. Starts paused for reduced-motion users; photos that fail to load are skipped. */
export function usePhotoRotation(intervalMs = 7000) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(prefersReducedMotion);
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setIndex((i) => nextPhoto(i, COVER_PHOTOS.length, failed)), intervalMs);
    return () => window.clearInterval(id);
  }, [paused, failed, intervalMs]);

  const markFailed = useCallback((i: number) => setFailed((f) => new Set([...f, i])), []);
  return { index, setIndex, paused, setPaused, failed, markFailed };
}
