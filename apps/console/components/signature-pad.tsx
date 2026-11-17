'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@hf/ui';
import { useI18n } from './i18n';

const W = 600;
const H = 200;

/**
 * Tablet signature capture (FR-PRV-2): finger, stylus or mouse on a canvas, exported as a PNG data URL.
 * The canvas is never mirrored in RTL; the ink is dark on a white pad so the stored image prints legibly.
 */
export function SignaturePad({ onChange, label }: { onChange: (dataUrl: string | null) => void; label: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = e.pointerType === 'pen' ? 2 + (e.pressure || 0.5) * 2 : 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (empty) setEmpty(false);
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (!empty && ref.current) onChange(ref.current.toDataURL('image/png'));
  }
  function clear() {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <canvas
        ref={ref}
        width={W}
        height={H}
        dir="ltr"
        className="h-40 w-full max-w-xl touch-none rounded-xl border-2 border-dashed border-border bg-white"
        style={{ touchAction: 'none' }}
        role="img"
        aria-label={empty ? t('sig.empty') : t('sig.captured')}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      />
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>{empty ? t('sig.hint') : t('sig.captured')}</span>
        {!empty && (
          <Button type="button" size="sm" variant="ghost" onClick={clear}>
            {t('sig.clear')}
          </Button>
        )}
      </div>
    </div>
  );
}
