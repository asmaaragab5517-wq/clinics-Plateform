'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { formatDate } from '@hf/shared/datetime';
import { QUEUE_PRIORITIES, type QueuePriority } from '@hf/shared/enums';
import { Alert, Bdi, Button, PageHeader, Select, StatusBadge, Table, Tabs, cx } from '@hf/ui';
import { Dialog } from '@/components/dialog';
import { QuickBookingDialog, WalkInDialog } from '@/components/booking';
import { DataState, KeyHint, ReasonDialog, Section, SelectField, TextField } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { PatientSearch } from '@/components/patient-search';
import { QueueBoard } from '@/components/queue-board';
import { RegisterPatientDialog } from '@/components/register-patient';
import { useSession, useShortcuts } from '@/components/session';
import { WaitlistPanel } from '@/components/waitlist';
import { useToast } from '@/components/toast';
import { post, qs } from '@/lib/api';
import { useApi, useInterval } from '@/lib/hooks';
import { dayRange, isoDate, patientName, time12, todayCairo } from '@/lib/format';
import { sendOrQueue } from '@/lib/offline';
import type { AppointmentRow, PatientRow } from '@/lib/types';

interface CheckInResult {
  ticket: { ticket_number: number } | null;
  packages: { id: string; name_ar: string; name_en: string; remaining: number; expires_on: string }[];
}

export default function ReceptionPage() {
  const { t, locale, err } = useI18n();
  const { clinicId, can } = useSession();
  const toast = useToast();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [patient, setPatient] = useState<{ id: string; name: string; mrn?: string; phone?: string | null; dob?: string } | null>(null);
  const [dialog, setDialog] = useState<'register' | 'book' | 'walkin' | 'family' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [priority, setPriority] = useState<QueuePriority>('normal');
  const [cancelling, setCancelling] = useState<AppointmentRow | null>(null);
  const [view, setView] = useState<'today' | 'waitlist'>('today');
  const today = todayCairo();
  const range = dayRange(today);
  const appts = useApi<AppointmentRow[]>(clinicId ? `/appointments${qs({ clinicId, from: range.from, to: range.to })}` : null);
  useInterval(appts.reload, 60_000);
  const rows = useMemo(() => appts.data ?? [], [appts.data]);
  const current = rows.find((a) => a.id === selected) ?? null;

  const pickPatient = useCallback((p: PatientRow) => setPatient({ id: p.id, name: patientName(p, locale), mrn: p.mrn, phone: p.phone, dob: isoDate(p.date_of_birth) }), [locale]);

  async function checkIn(a: AppointmentRow, prio: QueuePriority = priority) {
    try {
      const r = await sendOrQueue<CheckInResult>('POST', `/appointments/${a.id}/check-in`, { priority: prio }, 'offline.label.checkIn');
      if (r.queued) {
        toast(t('offline.queued'), 'warning');
        return;
      }
      const pk = r.data.packages.map((p) => t('rec.packageLeft', { name: locale === 'en' ? p.name_en || p.name_ar : p.name_ar, n: p.remaining, until: p.expires_on.slice(0, 10) })).join(' · ');
      toast(`${t('rec.checkedIn', { n: r.data.ticket?.ticket_number ?? '—' })}${pk ? ` — ${pk}` : ''}`);
      appts.reload();
    } catch (e) {
      toast(err(e), 'danger');
    }
  }

  async function transition(a: AppointmentRow, to: 'confirmed' | 'no_show' | 'cancelled', reason?: string) {
    await post(`/appointments/${a.id}/transition`, { to, reason });
    appts.reload();
  }

  const move = (d: number) => {
    if (!rows.length) return;
    const i = rows.findIndex((a) => a.id === selected);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + d))];
    if (next) {
      setSelected(next.id);
      document.getElementById(`appt-${next.id}`)?.scrollIntoView({ block: 'nearest' });
    }
  };

  const payTarget = () => {
    const a = current;
    if (a) router.push(`/cashier${qs({ appointmentId: a.id, patientId: a.patient_id })}`);
    else if (patient) router.push(`/cashier${qs({ patientId: patient.id })}`);
    else toast(t('rec.selectFirst'), 'warning');
  };

  useShortcuts({
    '/': () => searchRef.current?.focus(),
    n: () => (patient ? setDialog('book') : (toast(t('book.pickPatient'), 'warning'), searchRef.current?.focus())),
    w: () => (patient ? setDialog('walkin') : (toast(t('book.pickPatient'), 'warning'), searchRef.current?.focus())),
    r: () => setDialog('register'),
    c: () => {
      if (current && ['booked', 'confirmed'].includes(current.status)) void checkIn(current);
      else toast(t('rec.selectCheckIn'), 'warning');
    },
    p: payTarget,
    j: () => move(1),
    k: () => move(-1),
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('nav.reception')}
        subtitle={formatDate(new Date())}
        actions={
          <>
            {can('patient:create') && (
              <Button variant="secondary" onClick={() => setDialog('register')}>
                {t('pat.register')} <KeyHint k="r" />
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDialog('walkin')} disabled={!patient}>
              {t('walkin.title')} <KeyHint k="w" />
            </Button>
            <Button onClick={() => setDialog('book')} disabled={!patient}>
              {t('book.title')} <KeyHint k="n" />
            </Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="flex flex-col gap-4 xl:col-span-4">
          <Section title={t('pat.find')} actions={<KeyHint k="/" />}>
            <PatientSearch ref={searchRef} onSelect={pickPatient} selectedId={patient?.id} />
          </Section>
          {patient && (
            <Section title={t('rec.selectedPatient')}>
              <div className="flex flex-col gap-2 text-sm">
                <Bdi className="text-base font-medium">{patient.name}</Bdi>
                <div className="flex flex-wrap gap-3 text-muted">
                  {patient.mrn && <Bdi className="num">{patient.mrn}</Bdi>}
                  {patient.phone && <Bdi className="num">{patient.phone}</Bdi>}
                  {patient.dob && <span className="num">{patient.dob}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link className="inline-flex h-8 items-center rounded-xl border border-border px-3 hover:bg-bg" href={`/patients/${patient.id}`}>
                    {t('rec.openRecord')}
                  </Link>
                  <Button size="sm" onClick={() => setDialog('book')}>
                    {t('book.title')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setDialog('walkin')}>
                    {t('walkin.title')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setDialog('family')}>
                    {t('family.link')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => router.push(`/cashier${qs({ patientId: patient.id })}`)}>
                    {t('rec.takePayment')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPatient(null)}>
                    {t('common.clear')}
                  </Button>
                </div>
              </div>
            </Section>
          )}
        </div>
        <div className="flex flex-col gap-4 xl:col-span-8">
          {can('appointment:view') && (
            <Tabs<'today' | 'waitlist'>
              value={view}
              onChange={setView}
              items={[
                { value: 'today', label: t('rec.today') },
                { value: 'waitlist', label: t('wl.title') },
              ]}
            />
          )}
          {view === 'waitlist' && (
            <Section title={t('wl.title')}>
              <WaitlistPanel patient={patient} onBooked={appts.reload} />
            </Section>
          )}
          {view === 'today' && (
          <Section
            title={t('rec.today')}
            actions={
              <>
                <label className="flex items-center gap-2 text-sm">
                  {t('rec.checkInPriority')}
                  <Select className="h-8 w-36" value={priority} onChange={(e) => setPriority(e.target.value as QueuePriority)}>
                    {QUEUE_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {t(`priority.${p}`)}
                      </option>
                    ))}
                  </Select>
                </label>
                <Button size="sm" variant="ghost" onClick={appts.reload}>
                  {t('common.refresh')}
                </Button>
              </>
            }
          >
            <DataState loading={appts.loading} error={appts.error} data={appts.data} empty={(d) => d.length === 0}>
              {(list) => (
                <div className="max-h-[420px] overflow-y-auto">
                  <Table aria-label={t('rec.today')}>
                    <thead>
                      <tr>
                        <th>{t('rec.time')}</th>
                        <th>{t('rec.patient')}</th>
                        <th>{t('book.doctor')}</th>
                        <th>{t('common.status')}</th>
                        <th>{t('queue.ticket')}</th>
                        <th>{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((a) => (
                        <tr
                          key={a.id}
                          id={`appt-${a.id}`}
                          aria-selected={a.id === selected}
                          onClick={() => setSelected(a.id)}
                          className={cx('cursor-pointer', a.id === selected && 'bg-primary/10')}
                        >
                          <td className="num whitespace-nowrap">{time12(a.start_at, locale)}</td>
                          <td>
                            <Link href={`/patients/${a.patient_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                              <Bdi>{a.patient_name}</Bdi>
                            </Link>
                            <div className="text-xs text-muted">
                              <Bdi className="num">{a.mrn}</Bdi> {a.is_walk_in && `· ${t('channel.walk_in')}`}
                            </div>
                          </td>
                          <td>
                            <Bdi>{a.doctor_name}</Bdi>
                          </td>
                          <td>
                            <StatusBadge status={a.status} locale={locale} />
                          </td>
                          <td className="num">{a.ticket_number ?? '—'}</td>
                          <td>
                            <div className="flex flex-wrap gap-1">
                              {['booked', 'confirmed'].includes(a.status) && (
                                <Button
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void checkIn(a);
                                  }}
                                >
                                  {t('rec.checkIn')}
                                </Button>
                              )}
                              {a.status === 'booked' && (
                                <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), void transition(a, 'confirmed').catch((x: unknown) => toast(err(x), 'danger')))}>
                                  {t('rec.confirm')}
                                </Button>
                              )}
                              {['booked', 'confirmed'].includes(a.status) && new Date(a.start_at).getTime() < Date.now() && (
                                <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), void transition(a, 'no_show').catch((x: unknown) => toast(err(x), 'danger')))}>
                                  {t('rec.noShow')}
                                </Button>
                              )}
                              {['requested', 'booked', 'confirmed', 'checked_in'].includes(a.status) && (
                                <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), setCancelling(a))}>
                                  {t('common.cancel')}
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
            <p className="mt-2 text-xs text-muted">{t('rec.keysHint')}</p>
          </Section>
          )}
          <Section title={t('rec.queue')}>
            <QueueBoard />
          </Section>
        </div>
      </div>
      <RegisterPatientDialog
        open={dialog === 'register'}
        onClose={() => setDialog(null)}
        onCreated={(p) => {
          toast(t('pat.created', { mrn: p.mrn }));
          setPatient({ id: p.id, name: p.mrn, mrn: p.mrn });
          setDialog(null);
          router.push(`/patients/${p.id}`);
        }}
        onUseExisting={(id) => {
          setDialog(null);
          router.push(`/patients/${id}`);
        }}
      />
      <QuickBookingDialog open={dialog === 'book'} onClose={() => setDialog(null)} patient={patient} onBooked={appts.reload} />
      <WalkInDialog open={dialog === 'walkin'} onClose={() => setDialog(null)} patient={patient} onDone={appts.reload} />
      <LinkFamilyDialog open={dialog === 'family'} onClose={() => setDialog(null)} patient={patient} />
      <ReasonDialog open={!!cancelling} title={t('rec.cancelTitle')} onClose={() => setCancelling(null)} onSubmit={async (reason) => {
          if (cancelling) await transition(cancelling, 'cancelled', reason);
        }} />
    </div>
  );
}

/** FR-PAT-4: link the patient to a family account phone; the holder confirms with the OTP the API sends. */
function LinkFamilyDialog({ open, onClose, patient }: { open: boolean; onClose: () => void; patient: { id: string; name: string } | null }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState('child');
  const [guardian, setGuardian] = useState<PatientRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title={t('family.link')}>
      <div className="flex flex-col gap-4">
        {patient && (
          <p className="text-sm">
            <Bdi className="font-medium">{patient.name}</Bdi>
          </p>
        )}
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!patient) return;
            setBusy(true);
            setError(null);
            try {
              await post(`/patients/${patient.id}/link-account`, { phone, relation });
              toast(t('family.otpSent'));
              setPhone('');
            } catch (x) {
              setError(err(x));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm text-muted">{t('family.accountHint')}</p>
          <TextField label={t('family.accountPhone')} value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" required />
          <SelectField label={t('family.relation')} value={relation} onChange={(e) => setRelation(e.target.value)} options={['child', 'spouse', 'parent', 'sibling', 'other'].map((r) => ({ value: r, label: t(`family.rel.${r}`) }))} />
          <Button type="submit" disabled={busy || !patient}>
            {t('family.sendOtp')}
          </Button>
        </form>
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-sm font-medium">{t('family.guardian')}</p>
          <PatientSearch id="family-guardian" compact onSelect={setGuardian} />
          {guardian && patient && (
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await post(`/patients/${patient.id}/family`, { guardianPatientId: guardian.id });
                  toast(t('family.guardianSet'));
                  setGuardian(null);
                } catch (x) {
                  setError(err(x));
                }
              }}
            >
              {t('family.setGuardian', { name: patientName(guardian) })}
            </Button>
          )}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
