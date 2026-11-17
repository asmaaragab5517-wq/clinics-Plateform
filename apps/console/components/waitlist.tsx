'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Bdi, Button, DateText, Select, Table } from '@hf/ui';
import { patch, post, qs } from '@/lib/api';
import { useClinicDoctors, useServices } from '@/lib/data';
import { useApi } from '@/lib/hooks';
import { biName, isoDate, patientName, todayCairo } from '@/lib/format';
import type { PatientRow } from '@/lib/types';
import { QuickBookingDialog } from './booking';
import { DataState, SelectField, TextField, useAction } from './common';
import { Dialog } from './dialog';
import { useI18n } from './i18n';
import { PatientSearch } from './patient-search';
import { useSession } from './session';
import { useToast } from './toast';

/** FR-APT-10 waitlist: patients waiting for an earlier slot with a doctor. */
export interface WaitlistRow {
  id: string;
  clinic_id: string;
  doctor_id: string;
  patient_id: string;
  service_id: string | null;
  earliest: string;
  latest: string | null;
  status: 'waiting' | 'offered' | 'booked' | 'cancelled' | 'expired';
  /** Set when a slot was offered (by the desk, or automatically by the worker); cleared when back to waiting. */
  offered_at: string | null;
  created_at: string;
  patient_name: string;
  mrn: string;
  doctor_name: string;
  service_name_ar: string | null;
  service_name_en: string | null;
}

/** 'expired' is set by the worker once the wanted window has passed. */
const STATUSES = ['waiting', 'offered', 'booked', 'cancelled', 'expired'] as const;
type Settable = 'waiting' | 'offered' | 'booked' | 'cancelled';
const PENDING: WaitlistRow['status'][] = ['waiting', 'offered'];

export function WaitlistPanel({ patient, onBooked }: { patient: { id: string; name: string } | null; onBooked?: () => void }) {
  const { t, locale } = useI18n();
  const { clinicId, can } = useSession();
  const toast = useToast();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('waiting');
  const q = useApi<WaitlistRow[]>(clinicId ? `/waitlist${qs({ clinicId, status })}` : null);
  const { services } = useServices();
  const [adding, setAdding] = useState(false);
  const [booking, setBooking] = useState<WaitlistRow | null>(null);
  const a = useAction();
  const setRowStatus = async (w: WaitlistRow, to: Settable, quiet = false) => {
    const r = await a.run(() => patch(`/waitlist/${w.id}`, { status: to }));
    if (r) {
      if (!quiet) toast(t(`wl.marked.${to}`));
      q.reload();
    }
  };
  // Names come with the row; the catalogue is a fallback for rows without them.
  const serviceName = (w: WaitlistRow) => {
    if (!w.service_id) return t('wl.anyService');
    const own = biName({ name_ar: w.service_name_ar, name_en: w.service_name_en }, locale);
    if (own) return own;
    const s = services.find((x) => x.id === w.service_id);
    return s ? biName(s, locale) : '—';
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          {t('common.status')}
          <Select className="h-8 w-36" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`wl.status.${s}`)}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={q.reload}>
            {t('common.refresh')}
          </Button>
          {can('appointment:create') && (
            <Button size="sm" onClick={() => setAdding(true)}>
              {t('wl.add')}
            </Button>
          )}
        </div>
      </div>
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(rows) => (
          <div className="max-h-[420px] overflow-y-auto">
            <Table aria-label={t('wl.title')}>
              <thead>
                <tr>
                  <th>{t('rec.patient')}</th>
                  <th>{t('book.doctor')}</th>
                  <th>{t('book.service')}</th>
                  <th>{t('wl.window')}</th>
                  <th>{t('wl.since')}</th>
                  <th>{t('wl.offeredAt')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <Link href={`/patients/${w.patient_id}`} className="hover:underline">
                        <Bdi>{w.patient_name}</Bdi>
                      </Link>
                      <Bdi className="num block text-xs text-muted">{w.mrn}</Bdi>
                    </td>
                    <td>
                      <Bdi>{w.doctor_name}</Bdi>
                    </td>
                    <td>{serviceName(w)}</td>
                    <td className="num text-xs">
                      {isoDate(w.earliest)} → {w.latest ? isoDate(w.latest) : t('wl.open')}
                      {w.latest && isoDate(w.latest) < todayCairo() && PENDING.includes(w.status) && <Badge tone="danger" className="ms-1">{t('wl.expired')}</Badge>}
                    </td>
                    <td className="text-xs">
                      <DateText value={w.created_at} locale={locale} />
                    </td>
                    <td className="text-xs">{w.offered_at ? <DateText value={w.offered_at} locale={locale} withTime /> : '—'}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {PENDING.includes(w.status) && can('appointment:create') && (
                          <Button size="sm" onClick={() => setBooking(w)}>
                            {t('wl.bookNow')}
                          </Button>
                        )}
                        {PENDING.includes(w.status) && can('appointment:edit') && (
                          <>
                            {w.status === 'waiting' && (
                              <Button size="sm" variant="ghost" disabled={a.busy} onClick={() => void setRowStatus(w, 'offered')}>
                                {t('wl.markOffered')}
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" disabled={a.busy} onClick={() => void setRowStatus(w, 'booked')}>
                              {t('wl.markBooked')}
                            </Button>
                            <Button size="sm" variant="ghost" disabled={a.busy} onClick={() => void setRowStatus(w, 'cancelled')}>
                              {t('common.cancel')}
                            </Button>
                          </>
                        )}
                        {w.status !== 'waiting' && can('appointment:edit') && (
                          <Button size="sm" variant="ghost" disabled={a.busy} onClick={() => void setRowStatus(w, 'waiting')}>
                            {t('wl.reopen')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </DataState>
      <p className="text-xs text-muted">{t('wl.hint')}</p>
      <AddWaitlistDialog open={adding} onClose={() => setAdding(false)} initialPatient={patient} onAdded={q.reload} />
      <QuickBookingDialog
        open={!!booking}
        onClose={() => setBooking(null)}
        patient={booking ? { id: booking.patient_id, name: booking.patient_name } : null}
        preset={booking ? { doctorId: booking.doctor_id, serviceId: booking.service_id, from: isoDate(booking.earliest) } : undefined}
        onBooked={() => {
          if (booking) void setRowStatus(booking, 'booked', true);
          onBooked?.();
        }}
      />
    </div>
  );
}

function AddWaitlistDialog({ open, onClose, initialPatient, onAdded }: { open: boolean; onClose: () => void; initialPatient: { id: string; name: string } | null; onAdded: () => void }) {
  const { t, locale } = useI18n();
  const { clinicId } = useSession();
  const toast = useToast();
  const { doctors } = useClinicDoctors(clinicId);
  const { active } = useServices();
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const patient = picked ?? initialPatient;
  const [f, setF] = useState({ doctorId: '', serviceId: '', earliest: todayCairo(), latest: '' });
  const a = useAction();
  const doc = doctors.find((d) => d.id === f.doctorId);
  const services = doc && doc.serviceIds.size ? active.filter((s) => doc.serviceIds.has(s.id)) : active;
  return (
    <Dialog open={open} onClose={onClose} title={t('wl.add')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!patient) return a.setError(t('book.pickPatient'));
          if (f.latest && f.latest < f.earliest) return a.setError(t('wl.latestAfterEarliest'));
          const r = await a.run(() => post('/waitlist', { patientId: patient.id, clinicId, doctorId: f.doctorId, serviceId: f.serviceId || undefined, earliest: f.earliest, latest: f.latest || undefined }));
          if (r) {
            toast(t('wl.added'));
            setPicked(null);
            setF({ doctorId: '', serviceId: '', earliest: todayCairo(), latest: '' });
            onAdded();
            onClose();
          }
        }}
      >
        {patient ? (
          <div className="flex items-center justify-between text-sm">
            <span>
              {t('book.for')} <Bdi className="font-medium">{patient.name}</Bdi>
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(null)} disabled={!picked}>
              {t('common.change')}
            </Button>
          </div>
        ) : null}
        {(!patient || picked) && <PatientSearch id="waitlist-patient" compact onSelect={(p: PatientRow) => setPicked({ id: p.id, name: patientName(p, locale) })} selectedId={picked?.id} />}
        <SelectField label={t('book.doctor')} value={f.doctorId} required placeholder={t('form.choose')} onChange={(e) => setF({ ...f, doctorId: e.target.value, serviceId: '' })} options={doctors.map((d) => ({ value: d.id, label: d.name }))} />
        <SelectField label={t('book.service')} value={f.serviceId} placeholder={t('wl.anyService')} onChange={(e) => setF({ ...f, serviceId: e.target.value })} options={services.map((s) => ({ value: s.id, label: biName(s, locale) }))} />
        <div className="grid grid-cols-2 gap-2">
          <TextField label={t('wl.earliest')} type="date" value={f.earliest} min={todayCairo()} onChange={(e) => setF({ ...f, earliest: e.target.value })} required />
          <TextField label={t('wl.latest')} type="date" value={f.latest} min={f.earliest} onChange={(e) => setF({ ...f, latest: e.target.value })} />
        </div>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={a.busy || !patient || !f.doctorId}>
            {t('wl.add')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
