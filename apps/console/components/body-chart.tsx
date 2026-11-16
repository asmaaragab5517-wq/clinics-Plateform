'use client';

import { Button, Input } from '@hf/ui';
import { useI18n } from './i18n';

/**
 * Body chart (FR-EMR-2): a simple front/back figure; each click drops a numbered marker. Stored as vector JSON
 * shapes `{ type: 'marker', n, view, x, y, note }` in the encounter's `bodyChart`. Anatomical positions are
 * absolute, so the figure is never mirrored in RTL.
 */
export interface Marker {
  type: 'marker';
  n: number;
  view: 'front' | 'back';
  x: number;
  y: number;
  note: string;
}

export const BODY_IMAGE = 'body-v1';

function Figure({ ox }: { ox: number }) {
  return (
    <g transform={`translate(${ox},0)`} className="fill-bg stroke-muted" strokeWidth={1.5}>
      <circle cx={60} cy={28} r={18} />
      <rect x={52} y={46} width={16} height={10} rx={3} />
      <path d="M34 58 h52 a8 8 0 0 1 8 8 l-2 92 h-64 l-2 -92 a8 8 0 0 1 8 -8 z" />
      <path d="M26 64 l-14 82 a5 5 0 0 0 9 3 l17 -74 z" />
      <path d="M94 64 l14 82 a5 5 0 0 1 -9 3 l-17 -74 z" />
      <path d="M30 158 h28 l-2 132 a6 6 0 0 1 -12 0 z" />
      <path d="M62 158 h28 l-12 132 a6 6 0 0 1 -12 0 z" />
    </g>
  );
}

export function BodyChart({ markers, onChange, readOnly }: { markers: Marker[]; onChange: (m: Marker[]) => void; readOnly?: boolean }) {
  const { t } = useI18n();
  const W = 260;
  const H = 300;
  function add(e: React.MouseEvent<SVGSVGElement>) {
    if (readOnly) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    const view: Marker['view'] = p.x < W / 2 ? 'front' : 'back';
    const n = markers.reduce((a, m) => Math.max(a, m.n), 0) + 1;
    onChange([...markers, { type: 'marker', n, view, x: Math.round(p.x), y: Math.round(p.y), note: '' }]);
  }
  return (
    <div className="flex flex-col gap-3 md:flex-row" dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-80 w-auto shrink-0 cursor-crosshair rounded-xl border border-border bg-surface" onClick={add} role="img" aria-label={t('enc.bodyChartLabel')}>
        <Figure ox={5} />
        <Figure ox={135} />
        <text x={65} y={298} textAnchor="middle" className="fill-muted text-[10px]">
          {t('enc.front')}
        </text>
        <text x={195} y={298} textAnchor="middle" className="fill-muted text-[10px]">
          {t('enc.back')}
        </text>
        {markers.map((m) => (
          <g key={m.n}>
            <circle cx={m.x} cy={m.y} r={8} className="fill-danger stroke-surface" strokeWidth={2} />
            <text x={m.x} y={m.y + 3.5} textAnchor="middle" className="fill-white text-[10px] font-bold">
              {m.n}
            </text>
          </g>
        ))}
      </svg>
      <ol className="flex flex-1 flex-col gap-2" dir="auto">
        {markers.length === 0 && <li className="text-sm text-muted">{readOnly ? t('common.empty') : t('enc.bodyChartHint')}</li>}
        {markers.map((m, i) => (
          <li key={m.n} className="flex items-center gap-2">
            <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger text-xs text-white">{m.n}</span>
            <span className="w-12 text-xs text-muted">{t(`enc.${m.view}`)}</span>
            <Input
              value={m.note}
              readOnly={readOnly}
              aria-label={t('enc.markerNote', { n: m.n })}
              onChange={(e) => onChange(markers.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
              dir="auto"
            />
            {!readOnly && (
              <Button size="sm" variant="ghost" onClick={() => onChange(markers.filter((_, j) => j !== i))}>
                {t('common.remove')}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
