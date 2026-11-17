'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { addDays } from '@hf/shared';
import { Alert, Badge, Bdi, Button, Input, Money, PageHeader, StatusBadge, Table, Tabs } from '@hf/ui';
import { DataState, KeyHint, Section, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useQueue } from '@/components/queue-board';
import { useSession, useShortcuts } from '@/components/session';
import { useToast } from '@/components/toast';
import { ApiError, post, qs } from '@/lib/api';
import { findOpenEncounter } from '@/lib/encounters';
import { useApi, useInterval } from '@/lib/hooks';
import { dayRange, isoDate, num, time12, todayCairo } from '@/lib/format';
import type { AppointmentRow, QueueTicket } from '@/lib/types';

type Tab = 'queue' | 'today' | 'video' | 'followups' | 'earnings';

export default function DoctorPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('queue');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('doc.myDay')} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'queue', label: t('doc.myQueue') },
          { value: 'today', label: t('doc.todayList') },
          { value: 'video', label: t('tele.tab') },
          { value: 'followups', label: t('doc.followUps') },
          { value: 'earnings', label: t('doc.earnings') },
        ]}
      />
      {tab === 'queue' && <MyQueue />}
      {tab === 'today' && <Today />}
      {tab === 'video' && <Telemedicine />}
      {tab === 'followups' && <FollowUps />}
      {tab === 'earnings' && <Earnings />}
    </div>
  );
}

function useOpenConsult() {
  const router = useRouter();
  const { me } = useSession();
  const a = useAction();
  const open = (appointmentId: string, patientId: string, start: boolean, encounterId?: string | null) =>
    a.run(async () => {
      if (start) await post(`/appointments/${appointmentId}/transition`, { to: 'in_consultation' });
      // Queue and appointment rows carry the visit's encounter id; older rows fall back to the patient's open encounter.
      const id = encounterId ?? (await findOpenEncounter(patientId, me.userId))?.id;
      if (id) router.push(`/doctor/encounters/${id}`);
      else throw new ApiError(404, 'no_encounter');
    });
  return { ...a, open };
}

function MyQueue() {
  const { t, err } = useI18n();
  const { clinicId, me } = useSession();
  const toast = useToast();
  const q = useQueue(clinicId, me.userId);
  const consult = useOpenConsult();
  const g = q.data?.find((x) => x.doctorId === me.userId) ?? null;
  const current: QueueTicket | null = g?.serving ?? g?.called ?? null;

  async function callNext() {
    try {
      const r = await post<{ called: { ticketNumber: number } }>('/queue/call-next', { clinicId, doctorId: me.userId });
      toast(t('doc.called', { n: r.called.ticketNumber }));
      q.reload();
    } catch (e) {
      toast(err(e), 'danger');
    }
  }
  useShortcuts({ n: () => void callNext(), s: () => current && void consult.open(current.appointment_id, current.patient_id, current.status === 'called', current.encounter_id) });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title={t('queue.nowServing')} actions={<span className={q.live ? 'text-xs text-success' : 'text-xs text-muted'}>{q.live ? t('queue.live') : t('queue.polling')}</span>}>
        <div className="flex flex-col items-center gap-3 py-4">
          <span className="num font-display text-6xl font-bold">{current?.ticket_number ?? '—'}</span>
          {current && <Bdi className="text-lg">{current.patient_name ?? ''}</Bdi>}
          {current && <Badge tone={current.status === 'serving' ? 'success' : 'warning'}>{t(`ticket.${current.status}`)}</Badge>}
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="lg" onClick={() => void callNext()}>
              {t('queue.callNext')} <KeyHint k="n" />
            </Button>
            {current && (
              <Button size="lg" variant="secondary" disabled={consult.busy} onClick={() => void consult.open(current.appointment_id, current.patient_id, current.status === 'called', current.encounter_id)}>
                {current.status === 'serving' ? t('doc.openEncounter') : t('doc.startConsult')} <KeyHint k="s" />
              </Button>
            )}
          </div>
          {consult.error && <Alert tone="danger">{consult.error}</Alert>}
        </div>
      </Section>
      <Section title={t('doc.waiting')} className="lg:col-span-2">
        <DataState loading={q.loading} error={q.error} data={q.data}>
          {() =>
            !g || g.waiting.length === 0 ? (
              <p className="text-sm text-muted">{t('queue.empty')}</p>
            ) : (
              <ol className="flex flex-col gap-1">
                {g.waiting.map((w, i) => (
                  <li key={w.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="num w-10 text-lg font-bold">{w.ticket_number}</span>
                    <Link href={`/patients/${w.patient_id}`} className="flex-1 hover:underline">
                      <Bdi>{w.patient_name ?? ''}</Bdi>
                    </Link>
                    {w.priority !== 'normal' && <Badge tone={w.priority === 'emergency' ? 'danger' : 'warning'}>{t(`priority.${w.priority}`)}</Badge>}
                    <span className="text-xs text-muted">{t('queue.position', { position: i + 1 })}</span>
                  </li>
                ))}
              </ol>
            )
          }
        </DataState>
      </Section>
    </div>
  );
}

function Today() {
  const { t, locale } = useI18n();
  const { clinicId, me } = useSession();
  const r = dayRange(todayCairo());
  const q = useApi<AppointmentRow[]>(`/appointments${qs({ clinicId, doctorId: me.userId, from: r.from, to: r.to })}`);
  const consult = useOpenConsult();
  return (
    <Section title={t('doc.todayList')}>
      {consult.error && <Alert tone="danger">{consult.error}</Alert>}
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <th>{t('rec.time')}</th>
                <th>{t('rec.patient')}</th>
                <th>{t('book.service')}</th>
                <th>{t('common.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="num">{time12(a.start_at, locale)}</td>
                  <td>
                    <Link href={`/patients/${a.patient_id}`} className="hover:underline">
                      <Bdi>{a.patient_name}</Bdi>
                    </Link>
                  </td>
                  <td>{a.services.map((s) => (locale === 'en' ? s.name_en || s.name_ar : s.name_ar)).join(t('common.listSep'))}</td>
                  <td>
                    <StatusBadge status={a.status} locale={locale} />
                  </td>
                  <td>
                    {['checked_in', 'in_consultation', 'completed'].includes(a.status) && (
                      <Button size="sm" variant="secondary" onClick={() => void consult.open(a.id, a.patient_id, a.status === 'checked_in', a.encounter_id)}>
                        {a.status === 'checked_in' ? t('doc.startConsult') : t('doc.openEncounter')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </DataState>
    </Section>
  );
}

interface VideoVisit {
  appointment_id: string;
  ref: string;
  start_at: string;
  end_at: string;
  appointment_status: AppointmentRow['status'];
  patient_name: string;
  status: 'scheduled' | 'patient_waiting' | 'in_progress' | 'ended' | 'cancelled' | null;
  patient_joined_at: string | null;
  admitted_at: string | null;
  provider: string | null;
}

/** FR-TEL: today's video consultations with the patient's waiting-room status; Start opens the host link in a new tab. */
function Telemedicine() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [date, setDate] = useState(todayCairo());
  const q = useApi<VideoVisit[]>(`/telemedicine${qs({ date })}`);
  const [host, setHost] = useState<{ url: string; passcode: string | null; encounterId: string | null } | null>(null);
  const a = useAction();
  useInterval(() => q.reload(), date === todayCairo() ? 20_000 : null);

  async function start(v: VideoVisit) {
    // Open the tab synchronously (inside the click) so pop-up blockers allow it, then point it at the host link.
    const tab = window.open('about:blank', '_blank');
    const r = await a.run(() => post<{ url: string; passcode: string | null; encounterId: string | null; provider: string }>(`/telemedicine/${v.appointment_id}/start`));
    if (!r) {
      tab?.close();
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = r.url;
    }
    setHost(r);
    q.reload();
    if (r.encounterId) router.push(`/doctor/encounters/${r.encounterId}`);
    else toast(t('tele.noEncounter'), 'warning');
  }

  async function end(v: VideoVisit) {
    const r = await a.run(() => post(`/telemedicine/${v.appointment_id}/end`));
    if (r) {
      toast(t('tele.ended'));
      q.reload();
    }
  }

  return (
    <Section
      title={t('tele.title')}
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => setDate(addDays(date, -1))} aria-label={t('tele.prevDay')}>
            ‹
          </Button>
          <Input type="date" className="h-8 w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label={t('common.date')} />
          <Button size="sm" variant="ghost" onClick={() => setDate(addDays(date, 1))} aria-label={t('tele.nextDay')}>
            ›
          </Button>
          <Button size="sm" variant="ghost" onClick={q.reload}>
            {t('common.refresh')}
          </Button>
        </>
      }
    >
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      {host && (
        <Alert tone="info">
          {t('tele.hostOpened')}{' '}
          <a href={host.url} target="_blank" rel="noopener noreferrer" className="underline">
            {t('tele.openAgain')}
          </a>
          {host.passcode && (
            <>
              {' · '}
              {t('tele.passcode')}: <bdi dir="ltr" className="num font-bold">{host.passcode}</bdi>
            </>
          )}
        </Alert>
      )}
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <th>{t('rec.time')}</th>
                <th>{t('rec.patient')}</th>
                <th>{t('common.status')}</th>
                <th>{t('tele.room')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const live = ['booked', 'confirmed', 'checked_in', 'in_consultation'].includes(v.appointment_status);
                const roomStatus = v.status ?? 'scheduled';
                return (
                  <tr key={v.appointment_id} className={roomStatus === 'patient_waiting' ? 'bg-warning/5' : undefined}>
                    <td className="num">
                      {time12(v.start_at, locale)} <Bdi className="text-xs text-muted">{v.ref}</Bdi>
                    </td>
                    <td>
                      <Bdi>{v.patient_name}</Bdi>
                    </td>
                    <td>
                      <StatusBadge status={v.appointment_status} locale={locale} />
                    </td>
                    <td>
                      <Badge tone={roomStatus === 'patient_waiting' ? 'warning' : roomStatus === 'in_progress' ? 'success' : roomStatus === 'cancelled' ? 'danger' : 'neutral'}>{t(`tele.status.${roomStatus}`)}</Badge>
                      {roomStatus === 'patient_waiting' && v.patient_joined_at && <span className="ms-2 text-xs text-warning">{t('tele.waitingSince', { time: time12(v.patient_joined_at, locale) })}</span>}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {live && roomStatus !== 'ended' && roomStatus !== 'cancelled' && (
                          <Button size="sm" disabled={a.busy} onClick={() => void start(v)}>
                            {roomStatus === 'in_progress' ? t('tele.rejoin') : t('tele.start')}
                          </Button>
                        )}
                        {(roomStatus === 'in_progress' || roomStatus === 'patient_waiting') && (
                          <Button size="sm" variant="secondary" disabled={a.busy} onClick={() => void end(v)}>
                            {t('tele.end')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </DataState>
      <p className="mt-2 text-xs text-muted">{t('tele.hint')}</p>
    </Section>
  );
}

function FollowUps() {
  const { t } = useI18n();
  const { clinicId, me } = useSession();
  const q = useApi<{ id: string; patient_id: string; patient_name: string; doctor_id: string; due_date: string; note: string | null }[]>(`/follow-ups${qs({ clinicId })}`);
  return (
    <Section title={t('doc.followUps')}>
      <DataState loading={q.loading} error={q.error} data={q.data?.filter((f) => f.doctor_id === me.userId)} empty={(d) => d.length === 0}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <th>{t('doc.dueDate')}</th>
                <th>{t('rec.patient')}</th>
                <th>{t('enc.note')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td className="num">{isoDate(f.due_date)}</td>
                  <td>
                    <Link className="hover:underline" href={`/patients/${f.patient_id}`}>
                      <Bdi>{f.patient_name}</Bdi>
                    </Link>
                  </td>
                  <td dir="auto">{f.note}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </DataState>
    </Section>
  );
}

function Earnings() {
  const { t, locale } = useI18n();
  const q = useApi<{ id: string; month: string; clinic_id: string | null; revenue: number; share: number; status: string; doctor_name: string }[]>('/commission-statements');
  return (
    <Section title={t('doc.earnings')}>
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <th>{t('comm.month')}</th>
                <th>{t('comm.revenue')}</th>
                <th>{t('comm.share')}</th>
                <th>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="num">{isoDate(s.month).slice(0, 7)}</td>
                  <td>
                    <Money value={num(s.revenue)} locale={locale} />
                  </td>
                  <td>
                    <Money value={num(s.share)} locale={locale} />
                  </td>
                  <td>
                    <Badge tone={s.status === 'approved' ? 'success' : 'neutral'}>{t(`comm.status.${s.status}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </DataState>
    </Section>
  );
}
