'use client';

import { useMemo } from 'react';
import { formatTime12 } from '@hf/shared/datetime';
import { Alert, Spinner, cx } from '@hf/ui';
import { errorText } from '@/lib/bff';
import { dayLabel } from '@/lib/format';
import { t, type Locale } from '@/lib/i18n';
import type { Slot } from '@/lib/types';
import { useBffData } from './hooks';

/** Next 14 days of free slots grouped by day, 12-hour times with AM/PM markers (FR-WEB-3, LOC-5). */
export function SlotPicker({ locale, doctorId, clinicId, serviceId, value, onChange }: { locale: Locale; doctorId: string; clinicId?: string; serviceId?: string; value?: string; onChange: (s: Slot) => void }) {
  const qs = new URLSearchParams({ doctorId, days: '14' });
  if (clinicId) qs.set('clinicId', clinicId);
  if (serviceId) qs.set('serviceId', serviceId);
  const { data, error, loading, reload } = useBffData<Slot[]>(`/api/public/slots?${qs}`, locale, { redirectOn401: false });

  const days = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of data ?? []) {
      if (clinicId && s.clinicId !== clinicId) continue;
      m.set(s.date, [...(m.get(s.date) ?? []), s]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data, clinicId]);

  if (loading) return <Spinner label={t(locale, 'common.loading')} />;
  if (error)
    return (
      <div className="flex flex-col gap-2">
        <Alert>{errorText(locale, error)}</Alert>
        <button type="button" className="link self-start text-sm" onClick={() => void reload()}>
          {t(locale, 'site.retry')}
        </button>
      </div>
    );
  if (!days.length) return <p className="rounded-xl border border-dashed border-border p-6 text-center text-muted">{t(locale, 'booking.noSlots')}</p>;

  return (
    <div className="flex flex-col gap-4">
      {days.map(([date, slots]) => (
        <fieldset key={date}>
          <legend className="mb-2 font-medium">{dayLabel(date, locale)}</legend>
          <div className="flex flex-wrap gap-2">
            {slots.map((s) => {
              const selected = value === s.start;
              return (
                <button
                  key={s.start}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange(s)}
                  className={cx('num h-10 min-w-24 rounded-xl border px-3 text-sm transition', selected ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:border-primary')}
                >
                  {formatTime12(new Date(s.start), locale)}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
