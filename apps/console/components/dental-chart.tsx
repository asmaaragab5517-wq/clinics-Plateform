'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DENTAL_PROCEDURES, type DentalChart, isAnterior, TOOTH_CONDITIONS, TOOTH_STATUSES, toothSchema, treatmentPlan } from '@hf/shared/dental';
import { Alert, Badge, Button, DateText, Select, Table, cx } from '@hf/ui';
import { Check, DataState, ErrorAlert, Section, TextAreaField, TextField } from './common';
import { Dialog } from './dialog';
import { useI18n } from './i18n';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';

/**
 * FR-EMR-3 dentistry: FDI odontogram. The chart is drawn as the dentist sees the patient (patient's right on the
 * viewer's left) and is never mirrored, whatever the page direction.
 */

export type Tooth = DentalChart['teeth'][number];
export type Dentition = DentalChart['dentition'];
type Surface = 'M' | 'O' | 'D' | 'B' | 'L' | 'I';
type Condition = (typeof TOOTH_CONDITIONS)[number];
type Procedure = (typeof DENTAL_PROCEDURES)[number];

export interface PatientDentalChart {
  chart: DentalChart | null;
  treatmentPlan: ({ tooth: number; procedure: Procedure; surfaces?: Surface[]; note?: string; done: boolean })[];
  visits: { encounterId: string; at: string; status: string }[];
}

export const EMPTY_CHART: DentalChart = { dentition: 'permanent', teeth: [] };

export const CONDITION_COLOURS: Record<Condition, string> = {
  caries: '#dc2626',
  filling: '#2563eb',
  crown: '#d97706',
  root_canal: '#7c3aed',
  fracture: '#ea580c',
  bridge_abutment: '#0d9488',
  bridge_pontic: '#0891b2',
  sealant: '#16a34a',
  veneer: '#db2777',
  mobility: '#ca8a04',
  periapical_lesion: '#be123c',
  wear: '#64748b',
};

// Rows in viewer order: patient's right (quadrants 1/4, 5/8) on the viewer's left.
const UPPER_PERM = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_PERM = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const UPPER_PRIM = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
const LOWER_PRIM = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];

export function surfacesFor(tooth: number): Surface[] {
  return isAnterior(tooth) ? ['M', 'I', 'D', 'B', 'L'] : ['M', 'O', 'D', 'B', 'L'];
}

export function blankTooth(tooth: number): Tooth {
  return { tooth, status: 'present', conditions: [], planned: [] };
}

/** A tooth with nothing recorded is left out of the saved chart. */
export function isCharted(t: Tooth): boolean {
  return t.status !== 'present' || t.conditions.length > 0 || t.planned.length > 0 || !!t.note?.trim();
}

const SIZE = 36;
const GAP = 6;
const MID_GAP = 18;

function rowsFor(dentition: Dentition): { teeth: number[]; upper: boolean }[] {
  if (dentition === 'primary') return [{ teeth: UPPER_PRIM, upper: true }, { teeth: LOWER_PRIM, upper: false }];
  if (dentition === 'mixed')
    return [
      { teeth: UPPER_PERM, upper: true },
      { teeth: UPPER_PRIM, upper: true },
      { teeth: LOWER_PRIM, upper: false },
      { teeth: LOWER_PERM, upper: false },
    ];
  return [{ teeth: UPPER_PERM, upper: true }, { teeth: LOWER_PERM, upper: false }];
}

/** Viewer's left half holds quadrants 1, 4, 5, 8; their mesial surface faces the midline (viewer's right). */
const onViewerLeft = (tooth: number) => [1, 4, 5, 8].includes(Math.floor(tooth / 10));

function ToothGlyph({ tooth, data, x, y, upper, selected, onPick, label }: { tooth: number; data: Tooth | undefined; x: number; y: number; upper: boolean; selected: boolean; onPick?: (n: number) => void; label: string }) {
  const s = SIZE;
  const i = s * 0.3; // inner square inset
  const fill = (surface: Surface): string => {
    const c = data?.conditions.find((k) => k.surfaces?.includes(surface));
    return c ? CONDITION_COLOURS[c.type] : 'rgb(var(--hf-surface))';
  };
  const centre: Surface = isAnterior(tooth) ? 'I' : 'O';
  // Outer surface (buccal) faces away from the chart centre: top for the upper arch, bottom for the lower arch.
  const top: Surface = upper ? 'B' : 'L';
  const bottom: Surface = upper ? 'L' : 'B';
  const left: Surface = onViewerLeft(tooth) ? 'D' : 'M';
  const right: Surface = onViewerLeft(tooth) ? 'M' : 'D';
  const whole = data?.conditions.filter((c) => !c.surfaces?.length) ?? [];
  const missing = data && ['missing', 'extracted'].includes(data.status);
  const openPlan = data?.planned.some((p) => !p.done);
  const stroke = 'rgb(var(--hf-border))';
  const poly = (pts: number[][], surface: Surface) => <polygon points={pts.map(([a, b]) => `${x + a!},${y + b!}`).join(' ')} fill={fill(surface)} stroke={stroke} strokeWidth={1} />;
  const labelY = upper ? y - 6 : y + s + 14;
  const interactive = !!onPick;
  return (
    <g
      role={interactive ? 'button' : 'img'}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      aria-pressed={interactive ? selected : undefined}
      className={cx(interactive && 'cursor-pointer focus:outline-none')}
      onClick={interactive ? () => onPick!(tooth) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick!(tooth);
              }
            }
          : undefined
      }
    >
      <title>{label}</title>
      <text x={x + s / 2} y={labelY} textAnchor="middle" fontSize={11} fill="rgb(var(--hf-muted))" className="num">
        {tooth}
      </text>
      {poly([[0, 0], [s, 0], [s - i, i], [i, i]], top)}
      {poly([[0, s], [s, s], [s - i, s - i], [i, s - i]], bottom)}
      {poly([[0, 0], [i, i], [i, s - i], [0, s]], left)}
      {poly([[s, 0], [s - i, i], [s - i, s - i], [s, s]], right)}
      <rect x={x + i} y={y + i} width={s - 2 * i} height={s - 2 * i} fill={fill(centre)} stroke={stroke} strokeWidth={1} />
      {whole.map((c, k) => (
        <rect key={k} x={x - 2 - k * 3} y={y - 2 - k * 3} width={s + 4 + k * 6} height={s + 4 + k * 6} fill="none" stroke={CONDITION_COLOURS[c.type]} strokeWidth={2} rx={3} />
      ))}
      {data?.status === 'implant' && <circle cx={x + s / 2} cy={y + s / 2} r={4} fill="rgb(var(--hf-fg))" />}
      {(data?.status === 'unerupted' || data?.status === 'impacted') && <rect x={x} y={y} width={s} height={s} fill="rgb(var(--hf-muted))" opacity={0.35} />}
      {missing && (
        <g stroke="rgb(var(--hf-danger))" strokeWidth={2.5}>
          <line x1={x + 3} y1={y + 3} x2={x + s - 3} y2={y + s - 3} />
          <line x1={x + s - 3} y1={y + 3} x2={x + 3} y2={y + s - 3} />
        </g>
      )}
      {openPlan && <circle cx={x + s - 2} cy={upper ? y + s + 6 : y - 6} r={3.5} fill="rgb(var(--hf-accent))" />}
      {selected && <rect x={x - 4} y={y - 4} width={s + 8} height={s + 8} fill="none" stroke="rgb(var(--hf-primary))" strokeWidth={2} strokeDasharray="4 2" rx={4} />}
    </g>
  );
}

export function Odontogram({ chart, selected, onPick }: { chart: DentalChart; selected?: number | null; onPick?: (tooth: number) => void }) {
  const { t } = useI18n();
  const byTooth = useMemo(() => new Map(chart.teeth.map((x) => [x.tooth, x])), [chart.teeth]);
  const rows = rowsFor(chart.dentition);
  const fullWidth = 16 * SIZE + 15 * GAP + (MID_GAP - GAP);
  const pad = 26;
  const rowH = SIZE + 34;
  const height = rows.length * rowH + 30;
  const width = fullWidth + pad * 2;
  const describe = (n: number) => {
    const d = byTooth.get(n);
    const parts = [t('dental.tooth', { n })];
    if (d && d.status !== 'present') parts.push(t(`dental.status.${d.status}`));
    for (const c of d?.conditions ?? []) parts.push(`${t(`dental.cond.${c.type}`)}${c.surfaces?.length ? ` (${c.surfaces.join('')})` : ''}`);
    const open = d?.planned.filter((p) => !p.done).length ?? 0;
    if (open) parts.push(t('dental.plannedN', { n: open }));
    return parts.join(' · ');
  };
  let y = 22;
  const upperCount = rows.filter((r) => r.upper).length;
  return (
    // The odontogram keeps anatomical orientation in both directions: dir="ltr" stops any mirroring.
    <div dir="ltr" className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[640px] max-w-4xl" role="group" aria-label={t('dental.chartLabel')}>
        <text x={pad} y={12} fontSize={11} fill="rgb(var(--hf-muted))">
          {t('dental.patientRight')}
        </text>
        <text x={width - pad} y={12} fontSize={11} fill="rgb(var(--hf-muted))" textAnchor="end">
          {t('dental.patientLeft')}
        </text>
        {rows.map((r, ri) => {
          const count = r.teeth.length;
          const rowWidth = count * SIZE + (count - 1) * GAP + (MID_GAP - GAP);
          const x0 = pad + (fullWidth - rowWidth) / 2;
          const rowY = y + (r.upper ? 14 : 4);
          y += rowH;
          if (ri === upperCount - 1) y += 4;
          return (
            <g key={ri}>
              {r.teeth.map((n, k) => {
                const x = x0 + k * (SIZE + GAP) + (k >= count / 2 ? MID_GAP - GAP : 0);
                return <ToothGlyph key={n} tooth={n} data={byTooth.get(n)} x={x} y={rowY} upper={r.upper} selected={selected === n} onPick={onPick} label={describe(n)} />;
              })}
            </g>
          );
        })}
        <line x1={width / 2} y1={18} x2={width / 2} y2={height - 6} stroke="rgb(var(--hf-border))" strokeDasharray="3 3" />
        <line x1={pad} y1={22 + upperCount * rowH + 2} x2={width - pad} y2={22 + upperCount * rowH + 2} stroke="rgb(var(--hf-border))" strokeDasharray="3 3" />
      </svg>
    </div>
  );
}

export function DentalLegend() {
  const { t } = useI18n();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={t('dental.legend')}>
      {TOOTH_CONDITIONS.map((c) => (
        <li key={c} className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-border" style={{ background: CONDITION_COLOURS[c] }} aria-hidden />
          {t(`dental.cond.${c}`)}
        </li>
      ))}
      <li className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full bg-accent" aria-hidden />
        {t('dental.legendPlanned')}
      </li>
      <li className="flex items-center gap-1">
        <span className="font-bold text-danger" aria-hidden>
          ×
        </span>
        {t('dental.legendMissing')}
      </li>
    </ul>
  );
}

function SurfacePicker({ tooth, value, onChange, disabled, label }: { tooth: number; value: Surface[] | undefined; onChange: (v: Surface[]) => void; disabled?: boolean; label: string }) {
  const { t } = useI18n();
  const v = value ?? [];
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {surfacesFor(tooth).map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          aria-pressed={v.includes(s)}
          title={t(`dental.surface.${s}`)}
          onClick={() => onChange(v.includes(s) ? v.filter((x) => x !== s) : [...v, s])}
          className={cx('h-7 min-w-7 rounded-md border px-1.5 text-xs font-medium', v.includes(s) ? 'border-primary bg-primary text-primary-fg' : 'border-border hover:bg-bg')}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function issueText(t: (k: string, v?: Record<string, string | number>) => string, message: string): string {
  const key = `dental.err.${message.replace(/_\d+$/, '')}`;
  const s = t(key);
  return s === key ? t('err.validation_failed') : s;
}

/** Edit one tooth: status, conditions with surfaces, planned procedures (done or not) and a note. */
export function ToothDialog({ tooth, value, readOnly, onClose, onApply }: { tooth: number | null; value: Tooth | undefined; readOnly?: boolean; onClose: () => void; onApply: (t: Tooth) => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={tooth !== null} onClose={onClose} title={tooth !== null ? t('dental.toothTitle', { n: tooth }) : ''} wide>
      {tooth !== null && <ToothForm key={tooth} tooth={tooth} initial={value ?? blankTooth(tooth)} readOnly={readOnly} onClose={onClose} onApply={onApply} />}
    </Dialog>
  );
}

function ToothForm({ tooth, initial, readOnly, onClose, onApply }: { tooth: number; initial: Tooth; readOnly?: boolean; onClose: () => void; onApply: (t: Tooth) => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<Tooth>(() => JSON.parse(JSON.stringify(initial)) as Tooth);
  const [error, setError] = useState<string | null>(null);
  const gone = d.status === 'missing' || d.status === 'extracted';
  return (
    <form
      className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto"
      onSubmit={(e) => {
        e.preventDefault();
        const clean: Tooth = { ...d, note: d.note?.trim() || undefined, planned: d.planned.map((p) => ({ ...p, note: p.note?.trim() || undefined })) };
        const r = toothSchema.safeParse(clean);
        if (!r.success) {
          setError(issueText(t, r.error.issues[0]?.message ?? ''));
          return;
        }
        onApply(r.data as Tooth);
        onClose();
      }}
    >
      <p className="text-xs text-muted">{isAnterior(tooth) ? t('dental.anteriorHint') : t('dental.posteriorHint')}</p>
      <label className="flex flex-col gap-1 text-sm">
        {t('dental.statusLabel')}
        <Select value={d.status} disabled={readOnly} onChange={(e) => setD({ ...d, status: e.target.value as Tooth['status'] })}>
          {TOOTH_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`dental.status.${s}`)}
            </option>
          ))}
        </Select>
      </label>
      <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
        <legend className="px-1 text-sm font-medium">{t('dental.conditions')}</legend>
        {gone && d.conditions.length > 0 && <Alert tone="warning">{t('dental.err.conditions_on_missing_tooth')}</Alert>}
        {d.conditions.length === 0 && <p className="text-sm text-muted">{t('dental.noConditions')}</p>}
        {d.conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: CONDITION_COLOURS[c.type] }} aria-hidden />
            <Select className="h-8 w-44" value={c.type} disabled={readOnly} aria-label={t('dental.condition')} onChange={(e) => setD({ ...d, conditions: d.conditions.map((x, j) => (j === i ? { ...x, type: e.target.value as Condition } : x)) })}>
              {TOOTH_CONDITIONS.map((k) => (
                <option key={k} value={k}>
                  {t(`dental.cond.${k}`)}
                </option>
              ))}
            </Select>
            <SurfacePicker tooth={tooth} value={c.surfaces} disabled={readOnly} label={t('dental.surfaces')} onChange={(v) => setD({ ...d, conditions: d.conditions.map((x, j) => (j === i ? { ...x, surfaces: v.length ? v : undefined } : x)) })} />
            {!readOnly && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setD({ ...d, conditions: d.conditions.filter((_, j) => j !== i) })}>
                {t('common.remove')}
              </Button>
            )}
          </div>
        ))}
        {!readOnly && !gone && (
          <Button type="button" size="sm" variant="secondary" className="self-start" disabled={d.conditions.length >= 12} onClick={() => setD({ ...d, conditions: [...d.conditions, { type: 'caries', surfaces: undefined }] })}>
            {t('dental.addCondition')}
          </Button>
        )}
        <p className="text-xs text-muted">{t('dental.surfaceHint')}</p>
      </fieldset>
      <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
        <legend className="px-1 text-sm font-medium">{t('dental.planned')}</legend>
        {d.planned.length === 0 && <p className="text-sm text-muted">{t('dental.noPlanned')}</p>}
        {d.planned.map((p, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select className="h-8 w-44" value={p.procedure} disabled={readOnly} aria-label={t('dental.procedure')} onChange={(e) => setD({ ...d, planned: d.planned.map((x, j) => (j === i ? { ...x, procedure: e.target.value as Procedure } : x)) })}>
                {DENTAL_PROCEDURES.map((k) => (
                  <option key={k} value={k}>
                    {t(`dental.proc.${k}`)}
                  </option>
                ))}
              </Select>
              <SurfacePicker tooth={tooth} value={p.surfaces} disabled={readOnly} label={t('dental.surfaces')} onChange={(v) => setD({ ...d, planned: d.planned.map((x, j) => (j === i ? { ...x, surfaces: v.length ? v : undefined } : x)) })} />
              <Check label={t('dental.done')} checked={p.done} disabled={readOnly} onChange={(v) => setD({ ...d, planned: d.planned.map((x, j) => (j === i ? { ...x, done: v } : x)) })} />
              {!readOnly && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setD({ ...d, planned: d.planned.filter((_, j) => j !== i) })}>
                  {t('common.remove')}
                </Button>
              )}
            </div>
            <TextField label={t('enc.note')} value={p.note ?? ''} readOnly={readOnly} maxLength={300} onChange={(e) => setD({ ...d, planned: d.planned.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} dir="auto" />
          </div>
        ))}
        {!readOnly && (
          <Button type="button" size="sm" variant="secondary" className="self-start" disabled={d.planned.length >= 12} onClick={() => setD({ ...d, planned: [...d.planned, { procedure: 'filling', done: false }] })}>
            {t('dental.addPlanned')}
          </Button>
        )}
      </fieldset>
      <TextAreaField label={t('enc.note')} value={d.note ?? ''} readOnly={readOnly} maxLength={500} rows={2} onChange={(e) => setD({ ...d, note: e.target.value })} dir="auto" />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {readOnly ? t('common.close') : t('common.cancel')}
        </Button>
        {!readOnly && (
          <>
            <Button type="button" variant="ghost" onClick={() => setD(blankTooth(tooth))}>
              {t('dental.clearTooth')}
            </Button>
            <Button type="submit">{t('dental.apply')}</Button>
          </>
        )}
      </div>
    </form>
  );
}

function PlanTable({ plan, onDone }: { plan: { tooth: number; procedure: Procedure; surfaces?: Surface[]; note?: string }[]; onDone?: (tooth: number, index: number) => void }) {
  const { t } = useI18n();
  if (!plan.length) return <p className="text-sm text-muted">{t('dental.noOpenPlan')}</p>;
  return (
    <Table>
      <thead>
        <tr>
          <th>{t('dental.toothCol')}</th>
          <th>{t('dental.procedure')}</th>
          <th>{t('dental.surfaces')}</th>
          <th>{t('enc.note')}</th>
          {onDone && <th />}
        </tr>
      </thead>
      <tbody>
        {plan.map((p, i) => (
          <tr key={`${p.tooth}-${i}`}>
            <td className="num">{p.tooth}</td>
            <td>{t(`dental.proc.${p.procedure}`)}</td>
            <td className="num">{p.surfaces?.join('') || '—'}</td>
            <td dir="auto">{p.note || '—'}</td>
            {onDone && (
              <td>
                <Button size="sm" variant="secondary" onClick={() => onDone(p.tooth, i)}>
                  {t('dental.markDone')}
                </Button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** The visit's chart, editable on an open encounter. `value` is controlled by the encounter editor (saved with it). */
export function DentalChartEditor({ value, onChange, readOnly }: { value: DentalChart; onChange: (c: DentalChart) => void; readOnly: boolean }) {
  const { t } = useI18n();
  const [sel, setSel] = useState<number | null>(null);
  const byTooth = new Map(value.teeth.map((x) => [x.tooth, x]));
  const plan = treatmentPlan(value);
  const setTooth = (d: Tooth) => {
    const rest = value.teeth.filter((x) => x.tooth !== d.tooth);
    onChange({ ...value, teeth: (isCharted(d) ? [...rest, d] : rest).sort((a, b) => a.tooth - b.tooth) });
  };
  const perio = value.periodontal ?? {};
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          {t('dental.dentition')}
          <Select className="h-8 w-40" value={value.dentition} disabled={readOnly} onChange={(e) => onChange({ ...value, dentition: e.target.value as Dentition })}>
            {(['permanent', 'mixed', 'primary'] as const).map((d) => (
              <option key={d} value={d}>
                {t(`dental.dentitionOpt.${d}`)}
              </option>
            ))}
          </Select>
        </label>
        <span className="text-xs text-muted">{readOnly ? t('dental.clickToView') : t('dental.clickToEdit')}</span>
      </div>
      <Odontogram chart={value} selected={sel} onPick={setSel} />
      <DentalLegend />
      <div className="grid gap-3 md:grid-cols-3">
        <Check label={t('dental.bleeding')} checked={!!perio.bleedingOnProbing} disabled={readOnly} onChange={(v) => onChange({ ...value, periodontal: { ...perio, bleedingOnProbing: v } })} />
        <TextField
          label={t('dental.plaque')}
          type="number"
          min={0}
          max={3}
          step="0.1"
          readOnly={readOnly}
          value={perio.plaqueIndex ?? ''}
          onChange={(e) => onChange({ ...value, periodontal: { ...perio, plaqueIndex: e.target.value === '' ? undefined : Number(e.target.value) } })}
          dir="ltr"
        />
        <TextField label={t('dental.perioNotes')} value={perio.notes ?? ''} readOnly={readOnly} maxLength={2000} onChange={(e) => onChange({ ...value, periodontal: { ...perio, notes: e.target.value || undefined } })} dir="auto" />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-bold">{t('dental.treatmentPlan')}</h3>
        <PlanTable
          plan={plan}
          onDone={
            readOnly
              ? undefined
              : (tooth, idx) => {
                  // idx counts open items across the chart; find the matching open item on that tooth.
                  const before = plan.slice(0, idx).filter((p) => p.tooth === tooth).length;
                  const d = byTooth.get(tooth);
                  if (!d) return;
                  let seen = -1;
                  setTooth({ ...d, planned: d.planned.map((p) => (!p.done && ++seen === before ? { ...p, done: true } : p)) });
                }
          }
        />
      </div>
      <ToothDialog tooth={sel} value={sel !== null ? byTooth.get(sel) : undefined} readOnly={readOnly} onClose={() => setSel(null)} onApply={setTooth} />
    </div>
  );
}

/** Patient record tab: current dental status merged across visits, the open treatment plan and the visits that charted. */
export function PatientDentalTab({ patientId }: { patientId: string }) {
  const { t, locale } = useI18n();
  const q = useApi<PatientDentalChart>(`/patients/${patientId}/dental-chart`);
  const [sel, setSel] = useState<number | null>(null);
  if (q.error instanceof ApiError && q.error.status === 403) return <ErrorAlert error={q.error} />;
  return (
    <DataState loading={q.loading} error={q.error} data={q.data}>
      {(d) => (
        <div className="flex flex-col gap-4">
          <Section title={t('dental.current')}>
            {!d.chart ? (
              <p className="text-sm text-muted">{t('dental.noChart')}</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted">{t(`dental.dentitionOpt.${d.chart.dentition}`)}</p>
                <Odontogram chart={d.chart} selected={sel} onPick={setSel} />
                <DentalLegend />
                {d.chart.periodontal && (d.chart.periodontal.bleedingOnProbing !== undefined || d.chart.periodontal.plaqueIndex !== undefined || d.chart.periodontal.notes) && (
                  <p className="text-sm">
                    {d.chart.periodontal.bleedingOnProbing !== undefined && <Badge tone={d.chart.periodontal.bleedingOnProbing ? 'warning' : 'neutral'}>{`${t('dental.bleeding')}: ${d.chart.periodontal.bleedingOnProbing ? t('common.yes') : t('common.no')}`}</Badge>}{' '}
                    {d.chart.periodontal.plaqueIndex !== undefined && <span className="num">{`${t('dental.plaque')}: ${d.chart.periodontal.plaqueIndex}`}</span>}{' '}
                    {d.chart.periodontal.notes && <span dir="auto">{d.chart.periodontal.notes}</span>}
                  </p>
                )}
                <ToothDialog tooth={sel} value={sel !== null ? d.chart.teeth.find((x) => x.tooth === sel) : undefined} readOnly onClose={() => setSel(null)} onApply={() => undefined} />
              </div>
            )}
          </Section>
          <div className="grid gap-4 lg:grid-cols-3">
            <Section title={t('dental.treatmentPlan')} className="lg:col-span-2">
              <PlanTable plan={d.treatmentPlan} />
            </Section>
            <Section title={t('dental.visits')}>
              {d.visits.length === 0 ? (
                <p className="text-sm text-muted">{t('common.empty')}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {[...d.visits].reverse().map((v) => (
                    <li key={v.encounterId} className="flex items-center justify-between gap-2">
                      <Link className="underline" href={`/doctor/encounters/${v.encounterId}`}>
                        <DateText value={v.at} locale={locale} />
                      </Link>
                      <Badge tone={v.status === 'signed' ? 'success' : 'warning'}>{t(`enc.status.${v.status}`)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      )}
    </DataState>
  );
}
