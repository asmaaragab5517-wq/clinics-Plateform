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

/**
 * Rasterise the rendered chart (FR-EMR-2): computed colours and fonts are inlined into a clone of the live SVG so the
 * PNG looks like the screen without the stylesheet, then the SVG is drawn onto a canvas and exported as a data URL.
 */
export async function bodyChartPng(svg: SVGSVGElement, scale = 2): Promise<string> {
  const vb = svg.viewBox.baseVal;
  const w = vb?.width || svg.clientWidth || 260;
  const h = vb?.height || svg.clientHeight || 300;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = svg.querySelectorAll('*');
  const dst = clone.querySelectorAll('*');
  src.forEach((el, i) => {
    const d = dst[i];
    if (!d) return;
    const cs = getComputedStyle(el);
    for (const prop of ['fill', 'stroke', 'stroke-width', 'font-size', 'font-weight', 'font-family', 'text-anchor']) {
      const v = cs.getPropertyValue(prop);
      if (v) d.setAttribute(prop, v);
    }
    d.removeAttribute('class');
  });
  clone.removeAttribute('class');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w * scale));
  clone.setAttribute('height', String(h * scale));
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(w));
  bg.setAttribute('height', String(h));
  bg.setAttribute('fill', getComputedStyle(svg).backgroundColor || '#ffffff');
  clone.insertBefore(bg, clone.firstChild);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('svg_render_failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no_canvas');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BodyChart({ markers, onChange, readOnly, svgRef }: { markers: Marker[]; onChange: (m: Marker[]) => void; readOnly?: boolean; svgRef?: React.Ref<SVGSVGElement> }) {
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
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-80 w-auto shrink-0 cursor-crosshair rounded-xl border border-border bg-surface" onClick={add} role="img" aria-label={t('enc.bodyChartLabel')}>
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
