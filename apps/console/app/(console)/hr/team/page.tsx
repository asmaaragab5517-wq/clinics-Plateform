'use client';

import { useState } from 'react';
import { addDays } from '@hf/shared';
import { Alert, Bdi, Button, PageHeader, Select, Table } from '@hf/ui';
import { DataState, Section, useAction } from '@/components/common';
import { CorrectionDialog, MonthPicker, MonthSheet, OvertimeActions, PunchList, RecordChips, StateBadge } from '@/components/hr';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName, num, time12, todayCairo } from '@/lib/format';
import { fmtDay, recordPunches, shiftText, type AttendanceRecord, type MonthView } from '@/lib/hr';

interface BoardRow {
  userId: string;
  nameAr: string;
  nameEn: string;
  clinicId: string;
  jobTitleAr: string;
  jobTitleEn: string;
  /** The board does not return the break yet; shown when present. */
  shift: { start: string; end: string; breakStart?: string; breakEnd?: string } | null;
  leave: string | null;
  state: 'present' | 'not_in_yet' | 'absent' | 'on_leave' | 'rest_day' | 'holiday';
  record: AttendanceRecord | null;
}

const STATES = ['present', 'not_in_yet', 'absent', 'on_leave', 'rest_day', 'holiday'] as const;

/** Daily attendance board for managers (hr:view) with each person's month, corrections and overtime approval. */
export default function TeamAttendancePage() {
  const { t, locale } = useI18n();
  const { me, can } = useSession();
  const toast = useToast();
  const today = todayCairo();
  const [date, setDate] = useState(today);
  const [clinic, setClinic] = useState('');
  const [filter, setFilter] = useState<string>('');
  const board = useApi<BoardRow[]>(`/hr/attendance${qs({ date, clinicId: clinic })}`);
  const [person, setPerson] = useState<{ userId: string; name: string } | null>(null);
  const [correct, setCorrect] = useState<{ userId: string; name: string; date: string; rec?: AttendanceRecord | null } | null>(null);
  const a = useAction();
  const name = (r: BoardRow) => (locale === 'en' ? r.nameEn || r.nameAr : r.nameAr);
  const overtime = async (rec: AttendanceRecord, approved: boolean | null, after: () => void) => {
    const r = await a.run(() => post(`/hr/attendance/${rec.id}/overtime`, { approved }));
    if (r) {
      toast(t(approved === null ? 'hr.otPendingToast' : approved ? 'hr.otApprovedToast' : 'hr.otRejectedToast'));
      after();
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.hrTeam')} subtitle={t('hr.team.subtitle')} />
      <Section
        title={t('hr.team.board', { d: fmtDay(date) })}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setDate(addDays(date, -1))} aria-label={t('hr.prevDay')}>
              {t('hr.prevDay')}
            </Button>
            <input type="date" className="h-8 rounded-xl border border-border bg-surface px-2 text-sm" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label={t('common.date')} />
            <Button size="sm" variant="ghost" onClick={() => setDate(addDays(date, 1))} disabled={date >= today}>
              {t('hr.nextDay')}
            </Button>
            {date !== today && (
              <Button size="sm" variant="secondary" onClick={() => setDate(today)}>
                {t('common.today')}
              </Button>
            )}
            <div className="w-48">
              <Select className="!h-8 text-sm" value={clinic} onChange={(e) => setClinic(e.target.value)} aria-label={t('shell.clinic')}>
              <option value="">{t('hr.allClinics')}</option>
              {me.clinics.map((c) => (
                <option key={c.id} value={c.id}>
                  {biName(c, locale)}
                </option>
              ))}
              </Select>
            </div>
            <Button size="sm" variant="ghost" onClick={board.reload}>
              {t('common.refresh')}
            </Button>
          </>
        }
      >
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <DataState loading={board.loading} error={board.error} data={board.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('hr.team.counts')}>
                <Button size="sm" variant={filter === '' ? 'primary' : 'secondary'} onClick={() => setFilter('')}>
                  {t('hr.team.all')} <span className="num">{rows.length}</span>
                </Button>
                {STATES.map((s) => {
                  const n = rows.filter((r) => r.state === s).length;
                  return (
                    <Button key={s} size="sm" variant={filter === s ? 'primary' : 'secondary'} onClick={() => setFilter(filter === s ? '' : s)} aria-pressed={filter === s}>
                      {t(`hr.state.${s}`)} <span className="num">{n}</span>
                    </Button>
                  );
                })}
              </div>
              <Table>
                <thead>
                  <tr>
                    <th>{t('hr.person')}</th>
                    <th>{t('hr.shift')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('hr.in')}</th>
                    <th>{t('hr.out')}</th>
                    <th>{t('hr.details')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => !filter || r.state === filter)
                    .map((r) => (
                      <tr key={r.userId}>
                        <td>
                          <Bdi>{name(r)}</Bdi>
                          <span className="block text-xs text-muted">
                            {locale === 'en' ? r.jobTitleEn || r.jobTitleAr : r.jobTitleAr}
                            {!clinic && me.clinics.length > 1 && <> · {biName(me.clinics.find((c) => c.id === r.clinicId), locale)}</>}
                          </span>
                        </td>
                        <td className="num whitespace-nowrap">{r.shift ? shiftText(t, r.shift) : '—'}</td>
                        <td>
                          <StateBadge state={r.state} />
                        </td>
                        <td className="num whitespace-nowrap">{r.record?.clock_in ? time12(r.record.clock_in, locale) : '—'}</td>
                        <td className="num whitespace-nowrap">{r.record?.clock_out ? time12(r.record.clock_out, locale) : '—'}</td>
                        <td className="text-xs">
                          {r.record && recordPunches(r.record).length > 1 && <PunchList rec={r.record} className="mb-1 block" />}
                          {r.record && <RecordChips rec={r.record} />}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="ghost" onClick={() => {
                                setPerson({ userId: r.userId, name: name(r) });
                                setTimeout(() => document.getElementById('person-month')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
                              }}>
                              {t('hr.team.month')}
                            </Button>
                            {can('hr:edit') && (
                              <Button size="sm" variant="ghost" onClick={() => setCorrect({ userId: r.userId, name: name(r), date, rec: r.record })}>
                                {t('hr.correct')}
                              </Button>
                            )}
                            {can('hr:approve') && r.record && num(r.record.overtime_minutes) > 0 && r.userId !== me.userId && (
                              <OvertimeActions rec={r.record} busy={a.busy} onDecide={(rec, approved) => void overtime(rec, approved, board.reload)} />
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
      </Section>
      <PersonMonth person={person} onClose={() => setPerson(null)} onOvertime={overtime} onChanged={board.reload} error={a.error} />
      <CorrectionDialog
        target={correct}
        onClose={() => setCorrect(null)}
        onSaved={() => {
          toast(t('hr.corrected'));
          board.reload();
        }}
      />
    </div>
  );
}

function PersonMonth({
  person,
  onClose,
  onOvertime,
  onChanged,
  error,
}: {
  person: { userId: string; name: string } | null;
  onClose: () => void;
  onOvertime: (rec: AttendanceRecord, approved: boolean | null, after: () => void) => Promise<void>;
  onChanged: () => void;
  error: string | null;
}) {
  const { t } = useI18n();
  const { can, me } = useSession();
  const today = todayCairo();
  const toast = useToast();
  const [month, setMonth] = useState(today.slice(0, 7));
  const q = useApi<MonthView>(person ? `/hr/attendance/month${qs({ month, userId: person.userId })}` : null);
  const [correct, setCorrect] = useState<{ userId: string; name: string; date: string; rec?: AttendanceRecord | null } | null>(null);
  if (!person) return null;
  const own = person.userId === me.userId;
  return (
    <Section
      title={t('hr.team.monthOf', { name: person.name })}
      actions={
        <>
          <MonthPicker value={month} onChange={setMonth} max={today.slice(0, 7)} />
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <div id="person-month" className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <DataState loading={q.loading} error={q.error} data={q.data}>
          {(v) => (
            <MonthSheet
              view={v}
              today={today}
              onCorrect={can('hr:edit') ? (d) => setCorrect({ userId: person.userId, name: person.name, date: d.date, rec: d.rec }) : undefined}
              onOvertime={can('hr:approve') && !own ? (rec, approved) => void onOvertime(rec, approved, () => (q.reload(), onChanged())) : undefined}
            />
          )}
        </DataState>
      </div>
      <CorrectionDialog
        target={correct}
        onClose={() => setCorrect(null)}
        onSaved={() => {
          toast(t('hr.corrected'));
          q.reload();
          onChanged();
        }}
      />
    </Section>
  );
}
