'use client';

import { useState } from 'react';
import { PERMISSION_KINDS, weekdayOf } from '@hf/shared';
import { Alert, Badge, Bdi, Button, PageHeader, Stat, Table, Tabs } from '@hf/ui';
import { ConfirmDialog, DataState, Section, SelectField, TextAreaField, TextField, useAction } from '@/components/common';
import { BalanceView, MonthPicker, MonthSheet, RecordChips, useReloadOn } from '@/components/hr';
import { useI18n } from '@/components/i18n';
import { useToast } from '@/components/toast';
import { post, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName, num, time12, todayCairo } from '@/lib/format';
import { REQUEST_TONE, duration, fmtDay, weekdayLabel, type AttendanceRecord, type Balances, type ContractView, type LeaveRequest, type LeaveType, type MonthView, type PermissionRequest } from '@/lib/hr';

interface MeHr {
  contract: ContractView | null;
  today: AttendanceRecord | null;
  annualBalance: Balances['annual'] | null;
}

type Tab = 'attendance' | 'requests';

/** Self-service HR for every staff member: clock in/out, month sheet, leave balance and requests. */
export default function MyHrPage() {
  const { t } = useI18n();
  const today = todayCairo();
  const me = useApi<MeHr>('/hr/me');
  const [month, setMonth] = useState(today.slice(0, 7));
  const sheet = useApi<MonthView>(`/hr/me/attendance${qs({ month })}`);
  const [tab, setTab] = useState<Tab>('attendance');
  const [requestsVersion, setRequestsVersion] = useState(0);
  const refreshAll = () => {
    me.reload();
    sheet.reload();
    setRequestsVersion((n) => n + 1);
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.hrMe')} subtitle={t('hr.me.subtitle')} />
      <DataState loading={me.loading} error={me.error} data={me.data}>
        {(m) =>
          !m.contract ? (
            <Alert tone="info">{t('hr.noContract')}</Alert>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <ClockCard data={m} holidays={sheet.data?.month === today.slice(0, 7) ? sheet.data.holidays : []} onDone={refreshAll} />
              <BalanceCard version={requestsVersion} />
            </div>
          )
        }
      </DataState>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'attendance', label: t('hr.me.attendanceTab') },
          { value: 'requests', label: t('hr.me.requestsTab') },
        ]}
      />
      {tab === 'attendance' ? (
        <Section title={t('hr.me.month')} actions={<MonthPicker value={month} onChange={setMonth} />}>
          <DataState loading={sheet.loading} error={sheet.error} data={sheet.data}>
            {(v) => <MonthSheet view={v} today={today} />}
          </DataState>
        </Section>
      ) : (
        <Requests version={requestsVersion} onChanged={refreshAll} hasContract={!!me.data?.contract} />
      )}
    </div>
  );
}

function ClockCard({ data, holidays, onDone }: { data: MeHr; holidays: MonthView['holidays']; onDone: () => void }) {
  const { t, locale, dir } = useI18n();
  const toast = useToast();
  const a = useAction();
  const today = todayCairo();
  const c = data.contract!;
  const holiday = holidays.find((h) => h.day === today);
  const scheduled = !holiday && c.work_pattern.days.includes(weekdayOf(today));
  const rec = data.today;
  const clock = async (action: 'in' | 'out') => {
    const r = await a.run(() => post('/hr/attendance/clock', { action, source: 'console' }));
    if (r) {
      toast(t(action === 'in' ? 'hr.clockedIn' : 'hr.clockedOut'));
      onDone();
    }
  };
  return (
    <Section title={t('hr.today', { day: weekdayLabel(t, weekdayOf(today)), d: fmtDay(today) })} className="lg:col-span-2">
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          {holiday ? (
            <>
              {t('hr.todayHoliday')} <Bdi>{biName(holiday, locale)}</Bdi>
            </>
          ) : scheduled ? (
            <span>{t('hr.todayShift', { start: c.work_pattern.start, end: c.work_pattern.end })}</span>
          ) : (
            t('hr.todayRest')
          )}
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label={t('hr.in')} value={rec?.clock_in ? time12(rec.clock_in, locale) : '—'} />
          <Stat label={t('hr.out')} value={rec?.clock_out ? time12(rec.clock_out, locale) : '—'} />
          <Stat label={t('hr.worked')} value={rec?.clock_out ? <span dir={dir}>{duration(t, rec.worked_minutes)}</span> : '—'} />
        </div>
        {rec && <RecordChips rec={rec} />}
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button size="lg" onClick={() => void clock('in')} disabled={a.busy || !!rec?.clock_in}>
            {t('hr.clockIn')}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => void clock('out')} disabled={a.busy || !!rec?.clock_out || (!!rec && !rec.clock_in)}>
            {t('hr.clockOut')}
          </Button>
        </div>
        <p className="text-xs text-muted">{t('hr.clockHint')}</p>
      </div>
    </Section>
  );
}

function BalanceCard({ version }: { version: number }) {
  const { t } = useI18n();
  const q = useApi<Balances>('/hr/me/balances');
  useReloadOn(version, q.reload);
  return (
    <Section title={t('hr.balance.title')}>
      <DataState loading={q.loading} error={q.error} data={q.data}>
        {(b) => <BalanceView b={b} />}
      </DataState>
    </Section>
  );
}

function Requests({ version, onChanged, hasContract }: { version: number; onChanged: () => void; hasContract: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const today = todayCairo();
  const q = useApi<{ leave: LeaveRequest[]; permissions: PermissionRequest[] }>('/hr/me/requests');
  useReloadOn(version, q.reload);
  const [cancel, setCancel] = useState<{ kind: 'leave-requests' | 'permission-requests'; id: string } | null>(null);
  const cancellable = (status: string, start: string) => status === 'pending' || (status === 'approved' && start.slice(0, 10) > today);
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        <Section title={t('hr.req.leaveTitle')}>
          <DataState loading={q.loading} error={q.error} data={q.data?.leave} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('hr.leaveType')}</th>
                    <th>{t('common.from')}</th>
                    <th>{t('common.to')}</th>
                    <th>{t('hr.days')}</th>
                    <th>{t('common.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {biName(r, locale)}
                        {r.reason && <span className="block text-xs text-muted">{r.reason}</span>}
                      </td>
                      <td className="num">{fmtDay(r.start_date)}</td>
                      <td className="num">{fmtDay(r.end_date)}</td>
                      <td className="num">{num(r.days)}</td>
                      <td>
                        <Badge tone={REQUEST_TONE[r.status]}>{t(`hr.req.${r.status}`)}</Badge>
                        {r.decision_note && <span className="block text-xs text-muted">{r.decision_note}</span>}
                      </td>
                      <td>
                        {cancellable(r.status, r.start_date) && (
                          <Button size="sm" variant="ghost" onClick={() => setCancel({ kind: 'leave-requests', id: r.id })}>
                            {t('hr.req.cancel')}
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
        <Section title={t('hr.req.permTitle')}>
          <DataState loading={q.loading} error={q.error} data={q.data?.permissions} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('common.date')}</th>
                    <th>{t('hr.perm.kind')}</th>
                    <th>{t('hr.perm.time')}</th>
                    <th>{t('common.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="num">{fmtDay(r.work_date)}</td>
                      <td>
                        {t(`hr.perm.${r.kind}`)}
                        {r.reason && <span className="block text-xs text-muted">{r.reason}</span>}
                      </td>
                      <td className="whitespace-nowrap">
                        <bdi className="num">
                          {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}
                        </bdi>{' '}
                        · {duration(t, r.minutes)}
                      </td>
                      <td>
                        <Badge tone={REQUEST_TONE[r.status]}>{t(`hr.req.${r.status}`)}</Badge>
                        {r.decision_note && <span className="block text-xs text-muted">{r.decision_note}</span>}
                      </td>
                      <td>
                        {cancellable(r.status, r.work_date) && (
                          <Button size="sm" variant="ghost" onClick={() => setCancel({ kind: 'permission-requests', id: r.id })}>
                            {t('hr.req.cancel')}
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
      </div>
      {hasContract && (
        <div className="flex flex-col gap-4">
          <LeaveForm onDone={onChanged} />
          <PermissionForm onDone={onChanged} />
        </div>
      )}
      <ConfirmDialog
        open={!!cancel}
        title={t('hr.req.cancelTitle')}
        message={t('hr.req.cancelConfirm')}
        confirmLabel={t('hr.req.cancel')}
        onClose={() => setCancel(null)}
        onConfirm={async () => {
          if (!cancel) return;
          await post(`/hr/${cancel.kind}/${cancel.id}/cancel`);
          toast(t('hr.req.cancelledToast'));
          onChanged();
        }}
      />
    </div>
  );
}

function LeaveForm({ onDone }: { onDone: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const types = useApi<LeaveType[]>('/hr/leave-types');
  const today = todayCairo();
  const [f, setF] = useState({ leaveTypeId: '', startDate: today, endDate: today, reason: '' });
  const a = useAction();
  const active = (types.data ?? []).filter((x) => x.is_active);
  const chosen = active.find((x) => x.id === f.leaveTypeId);
  return (
    <Section title={t('hr.leave.request')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (f.endDate < f.startDate) return a.setError(t('hr.leave.endBeforeStart'));
          const r = await a.run(() => post('/hr/leave-requests', { leaveTypeId: f.leaveTypeId, startDate: f.startDate, endDate: f.endDate, reason: f.reason.trim() || undefined }));
          if (r) {
            toast(t('hr.leave.sent'));
            setF({ ...f, reason: '' });
            onDone();
          }
        }}
      >
        <SelectField label={t('hr.leaveType')} value={f.leaveTypeId} placeholder={t('form.choose')} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })} options={active.map((x) => ({ value: x.id, label: biName(x, locale) }))} required />
        {chosen && (
          <p className="text-xs text-muted">
            {[
              chosen.paid ? t('hr.leave.paid') : t('hr.leave.unpaid'),
              chosen.uses_annual_balance ? t('hr.leave.fromBalance') : null,
              chosen.annual_quota !== null ? t('hr.leave.quota', { n: num(chosen.annual_quota) }) : null,
              chosen.max_consecutive_days !== null ? t('hr.leave.maxConsecutive', { n: num(chosen.max_consecutive_days) }) : null,
            ]
              .filter(Boolean)
              .join(t('common.listSep'))}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('common.from')} type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} required />
          <TextField label={t('common.to')} type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} required />
        </div>
        <p className="text-xs text-muted">{t('hr.leave.daysHint')}</p>
        <TextAreaField label={t('hr.reasonOptional')} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={1000} />
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy || !f.leaveTypeId}>
          {t('hr.leave.submit')}
        </Button>
      </form>
    </Section>
  );
}

function PermissionForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ workDate: todayCairo(), kind: 'late_arrival', startTime: '09:00', endTime: '10:00', reason: '' });
  const a = useAction();
  return (
    <Section title={t('hr.perm.request')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (f.endTime <= f.startTime) return a.setError(t('hr.perm.endBeforeStart'));
          const r = await a.run(() => post('/hr/permission-requests', { workDate: f.workDate, kind: f.kind, startTime: f.startTime, endTime: f.endTime, reason: f.reason.trim() || undefined }));
          if (r) {
            toast(t('hr.perm.sent'));
            setF({ ...f, reason: '' });
            onDone();
          }
        }}
      >
        <TextField label={t('common.date')} type="date" value={f.workDate} onChange={(e) => setF({ ...f, workDate: e.target.value })} required />
        <SelectField label={t('hr.perm.kind')} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={PERMISSION_KINDS.map((k) => ({ value: k, label: t(`hr.perm.${k}`) }))} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('common.from')} type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} required />
          <TextField label={t('common.to')} type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} required />
        </div>
        <p className="text-xs text-muted">{t('hr.perm.hint')}</p>
        <TextAreaField label={t('hr.reasonOptional')} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={1000} />
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy}>
          {t('hr.perm.submit')}
        </Button>
      </form>
    </Section>
  );
}
