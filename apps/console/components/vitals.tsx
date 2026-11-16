'use client';

import { bmi } from '@/lib/format';
import { TextField } from './common';
import { useI18n } from './i18n';

const VITALS: { key: string; unit: string; step?: string; int?: boolean }[] = [
  { key: 'systolic', unit: 'mmHg', int: true },
  { key: 'diastolic', unit: 'mmHg', int: true },
  { key: 'heartRate', unit: 'bpm', int: true },
  { key: 'temperatureC', unit: '°C', step: '0.1' },
  { key: 'respiratoryRate', unit: '/min', int: true },
  { key: 'spo2', unit: '%', int: true },
  { key: 'weightKg', unit: 'kg', step: '0.1' },
  { key: 'heightCm', unit: 'cm', step: '0.1' },
  { key: 'glucoseMgDl', unit: 'mg/dL', step: '1' },
];

/** Vitals with BMI auto-calculated (FR-EMR-2). */
export function VitalsFields({ value, onChange, readOnly }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; readOnly?: boolean }) {
  const { t } = useI18n();
  const b = bmi(Number(value.weightKg) || null, Number(value.heightCm) || null);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {VITALS.map((v) => (
        <TextField key={v.key} label={`${t(`vitals.${v.key}`)} (${v.unit})`} type="number" inputMode="decimal" step={v.step ?? '1'} value={value[v.key] ?? ''} readOnly={readOnly} onChange={(e) => onChange({ ...value, [v.key]: e.target.value })} dir="ltr" />
      ))}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t('vitals.bmi')}</span>
        <output className="num flex h-10 items-center rounded-xl border border-border bg-bg px-3" aria-live="polite">
          {b ?? '—'}
        </output>
      </div>
    </div>
  );
}

export function vitalsPayload(v: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of VITALS) {
    const raw = v[f.key];
    if (raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out[f.key] = f.int ? Math.round(n) : n;
  }
  return out;
}

