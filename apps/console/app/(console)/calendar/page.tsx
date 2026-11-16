'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ARABIC_WEEKDAYS, WEEK_ORDER, addDays, startOfWeek, weekdayOf, zonedToUtc } from '@hf/shared';
import { Alert, Bdi, Button, Dialog, PageHeader, Select, StatusBadge, Tabs, cx } from '@hf/ui';
import { ErrorAlert, Loading, TextField } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post, qs } from '@/lib/api';
import { useClinicDoctors } from '@/lib/data';
import { useApi } from '@/lib/hooks';
import { cairoDate, cairoTime, time12, todayCairo } from '@/lib/format';
import type { AppointmentRow } from '@/lib/types';

type View = 'day' | 'week' | 'month';
const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 08:00–22:00
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MOVABLE = ['requested', 'booked', 'confirmed'];

/** FR-APT-8: day/week/month per doctor or clinic, Saturday week start, colour by status, drag to reschedule. */
export default function CalendarPage() {
  const { t, locale, err } = useI18n();
  const { clinicId } = useSession();
  const toast = useToast();
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(todayCairo());
  const [doctorId, setDoctorId] = useState('');
  const [open, setOpen] = useState<AppointmentRow | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const { doctors } = useClinicDoctors(clinicId);

  const days = useMemo(() => {
    if (view === 'day') return [anchor];
    if (view === 'week') {
      const s = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    const first = `${anchor.slice(0, 7)}-01`;
    const s = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(s, i));
  }, [view, anchor]);
  const from = zonedToUtc(days[0]!, '00:00').toISOString();
  const to = zonedToUtc(addDays(days[days.length - 1]!, 1), '00:00').toISOString();
  const q = useApi<AppointmentRow[]>(clinicId ? `/appointments${qs({ clinicId, doctorId: doctorId || undefined, from, to })}` : null);

  const byCell = useMemo(() => {
    const m = new Map<string, AppointmentRow[]>();
    for (const a of q.data ?? []) {
      const d = cairoDate(a.start_at);
      const h = Number(cairoTime(a.start_at).slice(0, 2));
      const key = view === 'month' ? d : `${d}|${Math.max(HOURS[0]!, Math.min(HOURS[HOURS.length - 1]!, h))}`;
      m.set(key, [...(m.get(key) ?? []), a]);
    }
    return m;
  }, [q.data, view]);

  const step = (dir: number) => setAnchor(view === 'day' ? addDays(anchor, dir) : view === 'week' ? addDays(anchor, 7 * dir) : (() => {
    const [y, mo] = anchor.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, mo - 1 + dir, 1));
    return d.toISOString().slice(0, 10);
  })());

  async function reschedule(a: AppointmentRow, date: string, time: string) {
    setDropError(null);
    const start = zonedToUtc(date, time);
    if (start.toISOString() === new Date(a.start_at).toISOString()) return;
    try {
      await post(`/appointments/${a.id}/reschedule`, { start: start.toISOString(), reason: 'calendar' });
      toast(t('cal.moved', { date, time: time12(start, locale) }));
      q.reload();
      setOpen(null);
    } catch (e) {
      setDropError(err(e));
    }
  }

  function onDrop(e: React.DragEvent, date: string, hour?: number) {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/plain');
    const a = (q.data ?? []).find((x) => x.id === id);
    if (!a) return;
    const orig = cairoTime(a.start_at);
    const time = hour === undefined ? orig : `${String(hour).padStart(2, '0')}:${orig.slice(3, 5)}`;
    void reschedule(a, date, time);
  }

  const dayName = (d: string) => (locale === 'ar' ? ARABIC_WEEKDAYS[weekdayOf(d)] : EN_WEEKDAYS[weekdayOf(d)]);

  const Chip = ({ a }: { a: AppointmentRow }) => (
    <button
      type="button"
      draggable={MOVABLE.includes(a.status)}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', a.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => setOpen(a)}
      className={cx('appt-' + a.status, 'w-full truncate rounded-md border px-1 py-0.5 text-start text-xs', MOVABLE.includes(a.status) && 'cursor-grab')}
      title={`${time12(a.start_at, locale)} ${a.patient_name} — ${a.doctor_name}`}
    >
      <span className="num">{time12(a.start_at, locale)}</span> <Bdi>{a.patient_name}</Bdi>
      {!doctorId && <span className="block truncate text-[10px] opacity-75">{a.doctor_name}</span>}
    </button>
  );

  const dropProps = (key: string, date: string, hour?: number) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== key) setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => onDrop(e, date, hour),
  });

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t('nav.calendar')} subtitle={t('cal.hint')} />
      <div className="flex flex-wrap items-center gap-2">
        <Tabs<View>
          value={view}
          onChange={setView}
          items={[
            { value: 'day', label: t('cal.day') },
            { value: 'week', label: t('cal.week') },
            { value: 'month', label: t('cal.month') },
          ]}
        />
        <Button size="sm" variant="secondary" onClick={() => step(-1)} aria-label={t('cal.prev')}>
          {t('cal.prev')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setAnchor(todayCairo())}>
          {t('common.today')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => step(1)} aria-label={t('cal.next')}>
          {t('cal.next')}
        </Button>
        <input type="date" className="h-8 rounded-xl border border-border bg-surface px-2 text-sm" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} aria-label={t('cal.goTo')} />
        <Select className="h-8 w-56" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label={t('book.doctor')}>
          <option value="">{t('cal.allDoctors')}</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        {q.loading && <Loading className="p-0" />}
      </div>
      <Legend />
      {dropError && <Alert tone="danger">{dropError}</Alert>}
      <ErrorAlert error={q.error} />
      {view === 'month' ? (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border" role="grid" aria-label={t('cal.month')}>
          {WEEK_ORDER.map((wd) => (
            <div key={wd} className="bg-bg p-1 text-center text-xs font-medium" role="columnheader">
              {locale === 'ar' ? ARABIC_WEEKDAYS[wd] : EN_WEEKDAYS[wd]}
            </div>
          ))}
          {days.map((d) => {
            const list = byCell.get(d) ?? [];
            const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
            return (
              <div key={d} role="gridcell" {...dropProps(d, d)} className={cx('min-h-24 bg-surface p-1', !inMonth && 'opacity-50', over === d && 'ring-2 ring-primary', d === todayCairo() && 'bg-primary/5')}>
                <button className="num text-xs font-medium hover:underline" onClick={() => (setAnchor(d), setView('day'))}>
                  {d.slice(8)}
                </button>
                <div className="mt-1 flex flex-col gap-0.5">
                  {list.slice(0, 3).map((a) => (
                    <Chip key={a.id} a={a} />
                  ))}
                  {list.length > 3 && <span className="text-[10px] text-muted">{t('cal.more', { n: list.length - 3 })}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[900px] table-fixed border-collapse text-sm" role="grid">
            <thead>
              <tr>
                <th className="w-16 bg-bg p-1" />
                {days.map((d) => (
                  <th key={d} className={cx('bg-bg p-1 text-center font-medium', d === todayCairo() && 'text-primary')}>
                    {dayName(d)} <span className="num text-xs text-muted">{d.slice(5)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HOURS.map((h) => (
                <tr key={h}>
                  <th scope="row" className="num border-t border-border p-1 align-top text-xs font-normal text-muted">
                    {time12(zonedToUtc(anchor, `${String(h).padStart(2, '0')}:00`), locale)}
                  </th>
                  {days.map((d) => {
                    const key = `${d}|${h}`;
                    return (
                      <td key={key} {...dropProps(key, d, h)} className={cx('h-14 border-s border-t border-border p-0.5 align-top', over === key && 'bg-primary/10')}>
                        <div className="flex flex-col gap-0.5">
                          {(byCell.get(key) ?? []).map((a) => (
                            <Chip key={a.id} a={a} />
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AppointmentDialog a={open} onClose={() => setOpen(null)} onReschedule={reschedule} error={dropError} />
    </div>
  );
}

function Legend() {
  const { t } = useI18n();
  return (
    <ul className="flex flex-wrap gap-2 text-xs" aria-label={t('cal.legend')}>
      {['requested', 'booked', 'confirmed', 'checked_in', 'in_consultation', 'completed', 'no_show', 'cancelled'].map((s) => (
        <li key={s} className={cx('appt-' + s, 'rounded-md border px-2 py-0.5')}>
          {t(`status.${s}`)}
        </li>
      ))}
    </ul>
  );
}

/** Keyboard-accessible alternative to drag-and-drop. */
function AppointmentDialog({ a, onClose, onReschedule, error }: { a: AppointmentRow | null; onClose: () => void; onReschedule: (a: AppointmentRow, date: string, time: string) => Promise<void>; error: string | null }) {
  const { t, locale } = useI18n();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const key = a?.id ?? '';
  const [lastKey, setLastKey] = useState('');
  if (a && key !== lastKey) {
    setLastKey(key);
    setDate(cairoDate(a.start_at));
    setTime(cairoTime(a.start_at));
  }
  return (
    <Dialog open={!!a} onClose={onClose} title={t('cal.appointment')}>
      {a && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between">
            <Link href={`/patients/${a.patient_id}`} className="font-medium hover:underline">
              <Bdi>{a.patient_name}</Bdi>
            </Link>
            <StatusBadge status={a.status} locale={locale} />
          </div>
          <p>
            <Bdi>{a.doctor_name}</Bdi> · <span className="num">{cairoDate(a.start_at)}</span> <span className="num">{time12(a.start_at, locale)}</span>
          </p>
          <p className="text-muted">
            {t('cal.ref')} <Bdi className="num">{a.ref}</Bdi> · {a.services.map((s) => (locale === 'en' ? s.name_en || s.name_ar : s.name_ar)).join(t('common.listSep'))}
          </p>
          {MOVABLE.includes(a.status) && (
            <form
              className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                void onReschedule(a, date, time);
              }}
            >
              <TextField label={t('cal.newDate')} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              <TextField label={t('cal.newTime')} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required />
              <Button type="submit">{t('cal.reschedule')}</Button>
            </form>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Dialog>
  );
}
