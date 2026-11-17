'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from '@hf/ui';
import { initialOf } from '@/lib/format';

/**
 * Doctor photo served same-origin by the site (the browser never calls the API host), with the initial as a fallback
 * when there is no photo or it fails to load. Decorative: the doctor's name is always next to it.
 */
export function DoctorPhoto({ name, src, size = 'md' }: { name: string; src: string | null; size?: 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // An image that failed before hydration never fires onError: check its state once mounted.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);
  const box = size === 'lg' ? 'h-20 w-20 text-2xl' : 'h-14 w-14 text-xl';
  if (!src || failed)
    return (
      <span aria-hidden className={cx('flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-display font-bold text-primary', box)}>
        {initialOf(name)}
      </span>
    );
  return (
    <img ref={ref} src={src} alt="" width={size === 'lg' ? 80 : 56} height={size === 'lg' ? 80 : 56} loading="lazy" decoding="async" onError={() => setFailed(true)} className={cx('shrink-0 rounded-full bg-primary/10 object-cover', box)} />
  );
}
