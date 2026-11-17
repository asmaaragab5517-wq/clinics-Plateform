'use client';

import { useEffect, useMemo, useState } from 'react';
import { QUEUE_PRIORITIES } from '@hf/shared';
import { Alert, Bdi, Button, cx } from '@hf/ui';
import { Dialog } from './dialog';
import { ApiError, newKey, post, qs } from '@/lib/api';
import { useClinicDoctors, useServices } from '@/lib/data';
import { useApi } from '@/lib/hooks';
import { biName, time12, todayCairo } from '@/lib/format';
import { sendOrQueue } from '@/lib/offline';
import type { Slot } from '@/lib/types';
import { ErrorAlert, Loading, SelectField, TextAreaField, TextField } from './common';
import { useI18n } from './i18n';
import { useSession } from './session';
import { useToast } from './toast';

interface PatientRef {
  id: string;
  name: string;
}

function useDoctorServices(doctorId: string) {
  const { clinicId } = useSession();
  const { doctors } = useClinicDoctors(clinicId);
  const { active } = useServices();
  const doc = doctors.find((d) => d.id === doctorId);
  const services = useMemo(() => (doc && doc.serviceIds.size ? active.filter((s) => doc.serviceIds.has(s.id)) : active), [doc, active]);
  return { doctors, services };
}

/** Quick booking from reception (FR-APT-1): doctor → service → free slot from the desk availability engine. */
export function QuickBookingDialog({ open, onClose, patient, onBooked }: { open: boolean; onClose: () => void; patient: PatientRef | null; onBooked: () => void }) {
  const { t, locale, err } = useI18n();
  const { clinicId } = useSession();
  const toast = useToast();
  const [doctorId, setDoctorId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [from, setFrom] = useState(todayCairo());
  const [slot, setSlot] = useState<Slot | null>(null);
  const [channel, setChannel] = useState<'console' | 'phone'>('console');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idem, setIdem] = useState(newKey());
  const { doctors, services } = useDoctorServices(doctorId);
  useEffect(() => {
    if (!doctorId && doctors[0]) setDoctorId(doctors[0].id);
  }, [doctors, doctorId]);
  useEffect(() => {
    if (services.length && !services.some((s) => s.id === serviceId)) setServiceId(services[0]?.id ?? '');
  }, [services, serviceId]);
  const slots = useApi<Slot[]>(open && doctorId && serviceId ? `/availability${qs({ clinicId, doctorId, serviceId, from, days: 7 })}` : null);
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots.data ?? []) if (s.available > 0 && new Date(s.end).getTime() > Date.now()) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return [...m.entries()];
  }, [slots.data]);

  async function book() {
    if (!patient || !slot) return;
    setBusy(true);
    setError(null);
    try {
      await post('/appointments', { patientId: patient.id, clinicId, doctorId, serviceIds: [serviceId], start: slot.start, channel, paymentMode: 'at_clinic', notes: notes.trim() || undefined }, idem);
      toast(t('book.done', { time: time12(slot.start, locale), date: slot.date }));
      setSlot(null);
      setNotes('');
      setIdem(newKey());
      onBooked();
      onClose();
    } catch (e) {
      setError(err(e));
      if (e instanceof ApiError && (e.code === 'slot_unavailable' || e.code === 'slot_not_offered')) {
        setSlot(null);
        slots.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('book.title')}>
      <div className="flex max-h-[75vh] flex-col gap-3 overflow-y-auto">
        {!patient ? (
          <Alert tone="warning">{t('book.pickPatient')}</Alert>
        ) : (
          <p className="text-sm">
            {t('book.for')} <Bdi className="font-medium">{patient.name}</Bdi>
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <SelectField label={t('book.doctor')} value={doctorId} onChange={(e) => setDoctorId(e.target.value)} options={doctors.map((d) => ({ value: d.id, label: d.name }))} placeholder={doctors.length ? undefined : t('book.noDoctors')} />
          <SelectField label={t('book.service')} value={serviceId} onChange={(e) => setServiceId(e.target.value)} options={services.map((s) => ({ value: s.id, label: biName(s, locale) }))} />
          <TextField label={t('book.from')} type="date" value={from} min={todayCairo()} onChange={(e) => setFrom(e.target.value)} />
          <SelectField
            label={t('book.channel')}
            value={channel}
            onChange={(e) => setChannel(e.target.value as 'console' | 'phone')}
            options={[
              { value: 'console', label: t('channel.console') },
              { value: 'phone', label: t('channel.phone') },
            ]}
          />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('book.slot')}</legend>
          {slots.loading && <Loading />}
          <ErrorAlert error={slots.error} />
          {!slots.loading && !slots.error && byDay.length === 0 && <p className="text-sm text-muted">{t('book.noSlots')}</p>}
          <div className="flex flex-col gap-2">
            {byDay.map(([date, list]) => (
              <div key={date}>
                <p className="mb-1 text-xs font-medium text-muted">
                  <span className="num">{date}</span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {list.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => setSlot(s)}
                      aria-pressed={slot?.start === s.start}
                      className={cx('rounded-lg border px-2 py-1 text-xs', slot?.start === s.start ? 'border-primary bg-primary text-primary-fg' : 'border-border hover:bg-bg')}
                    >
                      {time12(s.start, locale)}
                      {s.capacity > 1 && <span className="ms-1 opacity-70">({s.available})</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
        <TextAreaField label={t('book.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!patient || !slot || busy} onClick={() => void book()}>
            {t('book.confirm')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Walk-in: books "now" and checks in straight away, issuing a ticket (FR-APT-5). Queued when offline (NFR-7). */
export function WalkInDialog({ open, onClose, patient, onDone }: { open: boolean; onClose: () => void; patient: PatientRef | null; onDone: () => void }) {
  const { t, locale, err } = useI18n();
  const { clinicId } = useSession();
  const toast = useToast();
  const [doctorId, setDoctorId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [priority, setPriority] = useState<(typeof QUEUE_PRIORITIES)[number]>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { doctors, services } = useDoctorServices(doctorId);
  useEffect(() => {
    if (!doctorId && doctors[0]) setDoctorId(doctors[0].id);
  }, [doctors, doctorId]);
  useEffect(() => {
    if (services.length && !services.some((s) => s.id === serviceId)) setServiceId(services[0]?.id ?? '');
  }, [services, serviceId]);
  return (
    <Dialog open={open} onClose={onClose} title={t('walkin.title')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!patient) return;
          setBusy(true);
          setError(null);
          try {
            const r = await sendOrQueue<{ ticket: { ticket_number: number } | null }>('POST', '/appointments/walk-in', { patientId: patient.id, clinicId, doctorId, serviceIds: [serviceId], priority }, 'offline.label.walkIn');
            toast(r.queued ? t('offline.queued') : t('walkin.done', { n: r.data.ticket?.ticket_number ?? '—' }), r.queued ? 'warning' : 'success');
            onDone();
            onClose();
          } catch (x) {
            setError(err(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        {!patient ? (
          <Alert tone="warning">{t('book.pickPatient')}</Alert>
        ) : (
          <p className="text-sm">
            {t('book.for')} <Bdi className="font-medium">{patient.name}</Bdi>
          </p>
        )}
        <SelectField label={t('book.doctor')} value={doctorId} onChange={(e) => setDoctorId(e.target.value)} options={doctors.map((d) => ({ value: d.id, label: d.name }))} />
        <SelectField label={t('book.service')} value={serviceId} onChange={(e) => setServiceId(e.target.value)} options={services.map((s) => ({ value: s.id, label: biName(s, locale) }))} />
        <SelectField label={t('queue.priority')} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} options={QUEUE_PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`) }))} />
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!patient || !doctorId || !serviceId || busy}>
            {t('walkin.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
