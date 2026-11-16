'use client';

import { useState } from 'react';
import { ARABIC_WEEKDAYS, WEEK_ORDER, addDays, type AppointmentStatus } from '@hf/shared';
import { Alert, Badge, Bdi, Button, PageHeader, StatusBadge, Table, Tabs } from '@hf/ui';
import { Check, DataState, Section, SelectField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { del, patch, post, qs } from '@/lib/api';
import { useServices } from '@/lib/data';
import { useApi } from '@/lib/hooks';
import { biName, isoDate, time12, todayCairo } from '@/lib/format';
import type { DoctorRow, SessionRow } from '@/lib/types';

const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Tab = 'sessions' | 'exceptions' | 'profiles';

export default function SchedulesPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('sessions');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.schedules')} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'sessions', label: t('sch.sessions') },
          { value: 'exceptions', label: t('sch.exceptions') },
          { value: 'profiles', label: t('sch.profiles') },
        ]}
      />
      {tab === 'sessions' && <Sessions />}
      {tab === 'exceptions' && <Exceptions />}
      {tab === 'profiles' && <Profiles />}
    </div>
  );
}

function useDoctors(clinicId: string) {
  return useApi<DoctorRow[]>(`/doctors${qs({ clinicId })}`);
}

function Weekdays({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const { t, locale } = useI18n();
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{t('sch.weekdays')}</legend>
      <div className="flex flex-wrap gap-3">
        {WEEK_ORDER.map((d) => (
          <Check key={d} label={locale === 'ar' ? (ARABIC_WEEKDAYS[d] ?? '') : (EN_WEEKDAYS[d] ?? '')} checked={value.includes(d)} onChange={(c) => onChange(c ? [...value, d] : value.filter((x) => x !== d))} />
        ))}
      </div>
    </fieldset>
  );
}

function Sessions() {
  const { t, locale } = useI18n();
  const { clinicId, can } = useSession();
  const toast = useToast();
  const sessions = useApi<SessionRow[]>(`/sessions${qs({ clinicId })}`);
  const doctors = useDoctors(clinicId);
  const profiles = useApi<{ id: string; name: string }[]>('/schedule-profiles');
  const { active: services } = useServices();
  const [f, setF] = useState({ doctorId: '', weekdays: [6, 0, 1, 2, 3] as number[], startTime: '16:00', endTime: '21:00', slotMinutes: 15, capacityPerSlot: 1, walkInReserved: 0, effectiveFrom: todayCairo(), effectiveTo: '', profileId: '', serviceIds: [] as string[] });
  const a = useAction();
  const days = (w: number[]) => WEEK_ORDER.filter((d) => w.includes(d)).map((d) => (locale === 'ar' ? ARABIC_WEEKDAYS[d] : EN_WEEKDAYS[d])).join(t('common.listSep'));
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Section title={t('sch.sessions')} className="xl:col-span-2">
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <DataState loading={sessions.loading} error={sessions.error} data={sessions.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('book.doctor')}</th>
                  <th>{t('sch.weekdays')}</th>
                  <th>{t('sch.hours')}</th>
                  <th>{t('sch.slot')}</th>
                  <th>{t('sch.capacity')}</th>
                  <th>{t('sch.walkIn')}</th>
                  <th>{t('sch.effective')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Bdi>{s.doctor_name}</Bdi>
                      {s.profile_id && <Badge tone="warning" className="ms-1">{t('sch.profile')}</Badge>}
                    </td>
                    <td className="text-xs">{days(s.weekdays)}</td>
                    <td className="num">{`${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`}</td>
                    <td className="num">{s.slot_minutes}</td>
                    <td className="num">{s.capacity_per_slot}</td>
                    <td className="num">{s.walk_in_reserved}</td>
                    <td className="num text-xs">{`${isoDate(s.effective_from)} → ${isoDate(s.effective_to) || '∞'}`}</td>
                    <td>
                      {can('schedule:edit') && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => void a.run(() => patch(`/sessions/${s.id}`, { walkInReserved: s.walk_in_reserved + 1 })).then((r) => r && sessions.reload())}>
                            {t('sch.walkInPlus')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void a.run(() => patch(`/sessions/${s.id}`, { isActive: false })).then((r) => r && (toast(t('sch.deactivated')), sessions.reload()))}>
                            {t('sch.deactivate')}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      {can('schedule:create') && (
        <Section title={t('sch.newSession')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await a.run(() => post('/sessions', { ...f, clinicId, effectiveTo: f.effectiveTo || null, profileId: f.profileId || null }));
              if (r) {
                toast(t('common.saved'));
                sessions.reload();
              }
            }}
          >
            <SelectField label={t('book.doctor')} value={f.doctorId} placeholder={t('form.choose')} onChange={(e) => setF({ ...f, doctorId: e.target.value })} options={(doctors.data ?? []).map((d) => ({ value: d.id, label: biName(d, locale) }))} required />
            <Weekdays value={f.weekdays} onChange={(w) => setF({ ...f, weekdays: w })} />
            <div className="grid grid-cols-2 gap-2">
              <TextField label={t('sch.start')} type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
              <TextField label={t('sch.end')} type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
              <TextField label={t('sch.slot')} type="number" min={5} max={240} value={f.slotMinutes} onChange={(e) => setF({ ...f, slotMinutes: Number(e.target.value) })} />
              <TextField label={t('sch.capacity')} type="number" min={1} max={20} value={f.capacityPerSlot} onChange={(e) => setF({ ...f, capacityPerSlot: Number(e.target.value) })} />
              <TextField label={t('sch.walkIn')} type="number" min={0} value={f.walkInReserved} onChange={(e) => setF({ ...f, walkInReserved: Number(e.target.value) })} />
              <SelectField label={t('sch.profile')} value={f.profileId} placeholder={t('sch.noProfile')} onChange={(e) => setF({ ...f, profileId: e.target.value })} options={(profiles.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
              <TextField label={t('sch.from')} type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />
              <TextField label={t('sch.to')} type="date" value={f.effectiveTo} onChange={(e) => setF({ ...f, effectiveTo: e.target.value })} />
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t('sch.allowedServices')}</legend>
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                {services.map((s) => (
                  <Check key={s.id} label={biName(s, locale)} checked={f.serviceIds.includes(s.id)} onChange={(c) => setF({ ...f, serviceIds: c ? [...f.serviceIds, s.id] : f.serviceIds.filter((x) => x !== s.id) })} />
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={a.busy || !f.doctorId || !f.weekdays.length}>
              {t('common.save')}
            </Button>
          </form>
        </Section>
      )}
    </div>
  );
}

interface Affected {
  id: string;
  patient_id: string;
  start_at: string;
  status: AppointmentStatus;
}

function Exceptions() {
  const { t, locale, err } = useI18n();
  const { clinicId, can } = useSession();
  const toast = useToast();
  const today = todayCairo();
  const list = useApi<{ id: string; kind: string; date: string; doctor_id: string | null; clinic_id: string | null; start_time: string | null; end_time: string | null; reason: string | null }[]>(`/schedule-exceptions${qs({ from: today, to: addDays(today, 120) })}`);
  const doctors = useDoctors(clinicId);
  const [f, setF] = useState({ kind: 'leave', doctorId: '', date: today, startTime: '', endTime: '', reason: '', exStart: '18:00', exEnd: '21:00', exSlot: 15 });
  const [affected, setAffected] = useState<Affected[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const a = useAction();
  const docName = (id: string | null) => (id ? biName(doctors.data?.find((d) => d.id === id), locale) : t('sch.wholeClinic'));

  async function bulkCancel() {
    if (!affected) return;
    let done = 0;
    const failures: string[] = [];
    for (const ap of affected) {
      try {
        await post(`/appointments/${ap.id}/transition`, { to: 'cancelled', reason: f.reason || t(`sch.kind.${f.kind}`) });
        done++;
      } catch (e) {
        failures.push(err(e));
      }
      setProgress(t('sch.cancelling', { done, total: affected.length }));
    }
    setProgress(null);
    toast(t('sch.cancelledN', { n: done }), failures.length ? 'warning' : 'success');
    setAffected(null);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Section title={t('sch.exceptions')} className="xl:col-span-2">
        <DataState loading={list.loading} error={list.error} data={list.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('sch.kindLabel')}</th>
                  <th>{t('book.doctor')}</th>
                  <th>{t('sch.hours')}</th>
                  <th>{t('form.reason')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <td className="num">{isoDate(x.date)}</td>
                    <td>
                      <Badge>{t(`sch.kind.${x.kind}`)}</Badge>
                    </td>
                    <td>
                      <Bdi>{docName(x.doctor_id)}</Bdi>
                    </td>
                    <td className="num">{x.start_time ? `${x.start_time.slice(0, 5)}–${x.end_time?.slice(0, 5) ?? ''}` : t('sch.fullDay')}</td>
                    <td dir="auto">{x.reason}</td>
                    <td>
                      {can('schedule:delete') && (
                        <Button size="sm" variant="ghost" onClick={() => void a.run(() => del(`/schedule-exceptions/${x.id}`)).then((r) => r && list.reload())}>
                          {t('common.delete')}
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
      <div className="flex flex-col gap-4">
        {can('schedule:create') && (
          <Section title={t('sch.newException')}>
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const body =
                  f.kind === 'extra'
                    ? { kind: 'extra', doctorId: f.doctorId, date: f.date, reason: f.reason || undefined, extraSession: { clinicId, startTime: f.exStart, endTime: f.exEnd, slotMinutes: f.exSlot } }
                    : { kind: f.kind, clinicId, doctorId: f.doctorId || undefined, date: f.date, startTime: f.startTime || undefined, endTime: f.endTime || undefined, reason: f.reason || undefined, action: 'list' };
                const r = await a.run(() => post<{ affected: Affected[] }>('/schedule-exceptions', body));
                if (r) {
                  list.reload();
                  setAffected(r.affected.length ? r.affected : null);
                  toast(r.affected.length ? t('sch.affectedN', { n: r.affected.length }) : t('common.saved'), r.affected.length ? 'warning' : 'success');
                }
              }}
            >
              <SelectField label={t('sch.kindLabel')} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={['leave', 'holiday', 'extra'].map((k) => ({ value: k, label: t(`sch.kind.${k}`) }))} />
              <SelectField label={t('book.doctor')} value={f.doctorId} placeholder={f.kind === 'holiday' ? t('sch.wholeClinic') : t('form.choose')} onChange={(e) => setF({ ...f, doctorId: e.target.value })} options={(doctors.data ?? []).map((d) => ({ value: d.id, label: biName(d, locale) }))} />
              <TextField label={t('common.date')} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
              {f.kind === 'extra' ? (
                <div className="grid grid-cols-3 gap-2">
                  <TextField label={t('sch.start')} type="time" value={f.exStart} onChange={(e) => setF({ ...f, exStart: e.target.value })} />
                  <TextField label={t('sch.end')} type="time" value={f.exEnd} onChange={(e) => setF({ ...f, exEnd: e.target.value })} />
                  <TextField label={t('sch.slot')} type="number" value={f.exSlot} onChange={(e) => setF({ ...f, exSlot: Number(e.target.value) })} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <TextField label={t('sch.partialFrom')} type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} hint={t('sch.partialHint')} />
                  <TextField label={t('sch.partialTo')} type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
                </div>
              )}
              <TextField label={t('form.reason')} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
              {a.error && <Alert tone="danger">{a.error}</Alert>}
              <Button type="submit" disabled={a.busy || (f.kind !== 'holiday' && !f.doctorId)}>
                {t('common.save')}
              </Button>
            </form>
          </Section>
        )}
        {affected && (
          <Section title={t('sch.affected')}>
            <Alert tone="warning">{t('sch.affectedBody', { n: affected.length })}</Alert>
            <ul className="my-2 flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
              {affected.map((x) => (
                <li key={x.id} className="flex items-center justify-between">
                  <span className="num">{`${x.start_at.slice(0, 10)} ${time12(x.start_at, locale)}`}</span>
                  <StatusBadge status={x.status} locale={locale} />
                </li>
              ))}
            </ul>
            {progress && <p className="text-sm text-muted">{progress}</p>}
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => void bulkCancel()} disabled={!!progress}>
                {t('sch.cancelAll')}
              </Button>
              <Button variant="secondary" onClick={() => setAffected(null)}>
                {t('sch.keep')}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">{t('sch.rescheduleHint')}</p>
          </Section>
        )}
      </div>
    </div>
  );
}

function Profiles() {
  const { t } = useI18n();
  const { can } = useSession();
  const q = useApi<{ id: string; name: string; date_from: string; date_to: string }[]>('/schedule-profiles');
  const [f, setF] = useState({ name: '', dateFrom: '', dateTo: '' });
  const a = useAction();
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Section title={t('sch.profiles')} className="xl:col-span-2">
        <p className="mb-2 text-sm text-muted">{t('sch.profilesHint')}</p>
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('sch.profileName')}</th>
                  <th>{t('sch.from')}</th>
                  <th>{t('sch.to')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="num">{isoDate(p.date_from)}</td>
                    <td className="num">{isoDate(p.date_to)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      {can('schedule:create') && (
        <Section title={t('sch.newProfile')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await a.run(() => post('/schedule-profiles', f));
              if (r) {
                setF({ name: '', dateFrom: '', dateTo: '' });
                q.reload();
              }
            }}
          >
            <TextField label={t('sch.profileName')} value={f.name} placeholder={t('sch.ramadan')} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} />
            <TextField label={t('sch.from')} type="date" value={f.dateFrom} onChange={(e) => setF({ ...f, dateFrom: e.target.value })} required />
            <TextField label={t('sch.to')} type="date" value={f.dateTo} onChange={(e) => setF({ ...f, dateTo: e.target.value })} required />
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy}>
              {t('common.save')}
            </Button>
          </form>
        </Section>
      )}
    </div>
  );
}
