'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Bdi, Button, Money, PageHeader, StatusBadge, Table, Tabs } from '@hf/ui';
import { DataState, KeyHint, Section, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useQueue } from '@/components/queue-board';
import { useSession, useShortcuts } from '@/components/session';
import { useToast } from '@/components/toast';
import { ApiError, post, qs } from '@/lib/api';
import { findOpenEncounter } from '@/lib/encounters';
import { useApi } from '@/lib/hooks';
import { dayRange, isoDate, num, time12, todayCairo } from '@/lib/format';
import type { AppointmentRow, QueueTicket } from '@/lib/types';

type Tab = 'queue' | 'today' | 'followups' | 'earnings';

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
          { value: 'followups', label: t('doc.followUps') },
          { value: 'earnings', label: t('doc.earnings') },
        ]}
      />
      {tab === 'queue' && <MyQueue />}
      {tab === 'today' && <Today />}
      {tab === 'followups' && <FollowUps />}
      {tab === 'earnings' && <Earnings />}
    </div>
  );
}

function useOpenConsult() {
  const router = useRouter();
  const { me } = useSession();
  const a = useAction();
  const open = (appointmentId: string, patientId: string, start: boolean) =>
    a.run(async () => {
      if (start) await post(`/appointments/${appointmentId}/transition`, { to: 'in_consultation' });
      const e = await findOpenEncounter(patientId, me.userId);
      if (e) router.push(`/doctor/encounters/${e.id}`);
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
  useShortcuts({ n: () => void callNext(), s: () => current && void consult.open(current.appointment_id, current.patient_id, current.status === 'called') });

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
              <Button size="lg" variant="secondary" disabled={consult.busy} onClick={() => void consult.open(current.appointment_id, current.patient_id, current.status === 'called')}>
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
                      <Button size="sm" variant="secondary" onClick={() => void consult.open(a.id, a.patient_id, a.status === 'checked_in')}>
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
