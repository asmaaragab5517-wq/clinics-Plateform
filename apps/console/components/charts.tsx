'use client';

import { useState } from 'react';
import { useI18n } from './i18n';

/**
 * Minimal RTL-aware SVG charts (LOC-2): bars grow from the inline start edge, so in Arabic they are
 * anchored on the right. Single series use one hue; every mark has a hover tooltip (<title>) and
 * each chart can switch to a table view for screen readers and colour-blind readers.
 */
export interface Datum {
  label: string;
  value: number;
  display?: string;
}

function TableView({ data, caption }: { data: Datum[]; caption: string }) {
  const { t } = useI18n();
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th className="text-start font-medium text-muted">{t('chart.item')}</th>
          <th className="text-end font-medium text-muted">{t('chart.value')}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.label} className="border-t border-border">
            <td className="py-1">{d.label}</td>
            <td className="num py-1 text-end">{d.display ?? d.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ChartCard({ title, data, children }: { title: string; data: Datum[]; children: React.ReactNode }) {
  const { t } = useI18n();
  const [table, setTable] = useState(false);
  return (
    <figure className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-sm">
      <figcaption className="flex items-center justify-between gap-2">
        <span className="font-display font-bold">{title}</span>
        <button className="text-xs text-muted underline" onClick={() => setTable((x) => !x)} aria-pressed={table}>
          {table ? t('chart.showChart') : t('chart.showTable')}
        </button>
      </figcaption>
      {data.length === 0 ? <p className="py-6 text-center text-sm text-muted">{t('common.empty')}</p> : table ? <TableView data={data} caption={title} /> : children}
    </figure>
  );
}

export function HBarChart({ title, data }: { title: string; data: Datum[] }) {
  const { dir } = useI18n();
  const rtl = dir === 'rtl';
  const W = 480;
  const rowH = 30;
  const labelW = 150;
  const valueW = 90;
  const plotW = W - labelW - valueW;
  const max = Math.max(1, ...data.map((d) => d.value));
  const H = data.length * rowH + 4;
  return (
    <ChartCard title={title} data={data}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title} direction={dir}>
        {data.map((d, i) => {
          const y = i * rowH + 2;
          const w = Math.max(2, (d.value / max) * plotW);
          const barX = rtl ? W - labelW - w : labelW;
          const labelX = rtl ? W - 4 : 4;
          const valueX = rtl ? W - labelW - w - 6 : labelW + w + 6;
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${d.display ?? d.value}`}</title>
              <rect x={0} y={y} width={W} height={rowH - 2} fill="transparent" />
              <text x={labelX} y={y + rowH / 2} dominantBaseline="middle" textAnchor="start" className="fill-current text-[12px]">
                {d.label.length > 22 ? `${d.label.slice(0, 21)}…` : d.label}
              </text>
              <rect x={barX} y={y + 6} width={w} height={rowH - 14} rx={4} className="fill-primary" />
              <text x={valueX} y={y + rowH / 2} dominantBaseline="middle" textAnchor={rtl ? 'end' : 'start'} className="fill-muted text-[12px]" direction="ltr" unicodeBidi="isolate">
                {d.display ?? d.value}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartCard>
  );
}

/** Part-to-whole for two or three categories: a single stacked bar with a legend (never colour alone). */
export function StackedBar({ title, data }: { title: string; data: Datum[] }) {
  const { dir } = useI18n();
  const rtl = dir === 'rtl';
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const fills = ['fill-primary', 'fill-accent', 'fill-muted'];
  const bg = ['bg-primary', 'bg-accent', 'bg-muted'];
  const W = 480;
  let offset = 0;
  return (
    <ChartCard title={title} data={data}>
      <svg viewBox={`0 0 ${W} 28`} className="w-full" role="img" aria-label={title}>
        {data.map((d, i) => {
          const w = (d.value / total) * W;
          const x = rtl ? W - offset - w : offset;
          offset += w;
          return (
            <rect key={d.label} x={x + 1} y={2} width={Math.max(0, w - 2)} height={24} rx={4} className={fills[i % fills.length]}>
              <title>{`${d.label}: ${d.display ?? d.value}`}</title>
            </rect>
          );
        })}
      </svg>
      <ul className="flex flex-wrap gap-4 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className={`inline-block h-3 w-3 rounded-sm ${bg[i % bg.length]}`} aria-hidden />
            <span>{d.label}</span>
            <span className="num text-muted">{d.display ?? d.value}</span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

/** Thin progress gauge for a single percentage (utilisation, no-show rate). */
export function Gauge({ label, percent }: { label: string; percent: number }) {
  const { dir } = useI18n();
  const p = Math.max(0, Math.min(100, percent));
  const W = 200;
  const w = (p / 100) * W;
  return (
    <svg viewBox={`0 0 ${W} 8`} className="mt-1 w-full" role="img" aria-label={`${label}: ${p}%`}>
      <rect x={0} y={0} width={W} height={8} rx={4} className="fill-border" />
      <rect x={dir === 'rtl' ? W - w : 0} y={0} width={w} height={8} rx={4} className="fill-primary" />
    </svg>
  );
}
