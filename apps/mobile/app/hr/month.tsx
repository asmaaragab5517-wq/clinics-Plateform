import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Empty, ErrorBox, Loading, Muted, Row, Screen, Section, StatusBadge, T, colors } from '../../components/ui';
import { hrApi } from '../../lib/endpoints';
import { plainDate, time } from '../../lib/format';
import { daysText, dayTone, minutesText, monthDays, monthLabel, punchesOf, punchesText, shiftMonth, todayCairo, wallTime, weekOf, weekdayName, type DayRow } from '../../lib/hr';
import { useI18n, type TKey } from '../../lib/i18n';
import { useQuery } from '../../lib/useQuery';
import type { AttendanceRecord, LocationCheck, LocationCheckDetail, MonthSummary } from '../../lib/types';

/** My month (GET /v1/hr/me/attendance?month=): one row per day with its status, and the month's summary. */
export default function MyMonth() {
  const { t, pick } = useI18n();
  const today = todayCairo();
  const [month, setMonth] = useState(today.slice(0, 7));
  const q = useQuery(`hr:month:${month}`, () => hrApi.month(month));
  const rows = q.data && q.data.month === month ? monthDays(q.data, today, pick) : [];
  const isCurrent = month >= today.slice(0, 7);

  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Button kind="ghost" title={t('hr.month.previous')} onPress={() => setMonth(shiftMonth(month, -1))} style={{ marginBottom: 0 }} />
        <T style={{ fontWeight: '700', fontSize: 18 }}>{monthLabel(month, t)}</T>
        <Button kind="ghost" title={t('hr.month.next')} onPress={() => setMonth(shiftMonth(month, 1))} disabled={isCurrent} style={{ marginBottom: 0 }} />
      </Row>
      {q.loading && !rows.length ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      {q.data?.summary && q.data.month === month ? <Summary s={q.data.summary} /> : null}
      {q.data && q.data.month === month && !q.data.contract ? <Muted style={{ marginBottom: 8 }}>{t('hr.noContract')}</Muted> : null}
      {q.data && q.data.month === month && !rows.length ? <Empty text={t('hr.month.empty')} /> : null}
      {rows.map((r, i) => {
        const week = weekOf(r.day);
        const header = i === 0 || weekOf(rows[i - 1]!.day) !== week;
        return (
          <View key={r.day}>
            {header ? <Muted style={{ marginTop: i ? 8 : 0, marginBottom: 6 }}>{t('hr.month.weekOf', { date: plainDate(week) })}</Muted> : null}
            <DayCard r={r} />
          </View>
        );
      })}
    </Screen>
  );
}

function Summary({ s }: { s: MonthSummary }) {
  const { t } = useI18n();
  const item = (label: string, value: string, tone?: string) => (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
      <Muted>{label}</Muted>
      <T style={{ fontWeight: '600', color: tone ?? colors.text }}>{value}</T>
    </Row>
  );
  return (
    <Section title={t('hr.month.summary')}>
      <Card>
        {item(t('hr.sum.worked'), t('hr.sum.ofScheduled', { n: s.workedDays, of: s.scheduledDays }))}
        {item(t('hr.sum.workedTime'), minutesText(s.workedMinutes, t))}
        {item(t('hr.sum.absent'), daysText(s.absentDays, t), s.absentDays ? colors.danger : undefined)}
        {item(t('hr.sum.leave'), daysText(s.leaveDays, t))}
        {s.unpaidLeaveDays ? item(t('hr.sum.unpaidLeave'), daysText(s.unpaidLeaveDays, t)) : null}
        {item(t('hr.sum.lateness'), minutesText(s.latenessMinutes, t), s.latenessMinutes ? colors.warn : undefined)}
        {item(t('hr.sum.overtime'), minutesText(s.overtimeMinutes, t))}
        {s.nightOvertimeMinutes ? item(t('hr.sum.nightOvertime'), minutesText(s.nightOvertimeMinutes, t)) : null}
        {s.restDayOvertimeMinutes ? item(t('hr.sum.restDayOvertime'), minutesText(s.restDayOvertimeMinutes, t)) : null}
        {s.pendingOvertimeMinutes ? item(t('hr.sum.pendingOvertime'), minutesText(s.pendingOvertimeMinutes, t)) : null}
        {s.futureDays ? <Muted style={{ marginTop: 4 }}>{t('hr.sum.future', { n: s.futureDays })}</Muted> : null}
        <Muted style={{ marginTop: 4, fontSize: 12 }}>{t('hr.sum.latenessNote')}</Muted>
      </Card>
    </Section>
  );
}

function DayCard({ r }: { r: DayRow }) {
  const { t, locale, pick } = useI18n();
  const rec = r.record;
  const details: { text: string; tone?: string }[] = [];
  if (rec?.clock_in) {
    // Several pairs (split shift, stepping out): "In 09:02 · Out 13:00 · In 17:05".
    const pairs = punchesOf(rec);
    details.push({ text: pairs.length > 1 ? punchesText(rec, locale, t) : `${time(rec.clock_in, locale)} – ${rec.clock_out ? time(rec.clock_out, locale) : '…'}` });
  }
  if (rec?.late_minutes) details.push({ text: t('hr.day.late', { time: minutesText(rec.late_minutes, t) }), tone: colors.warn });
  if (rec?.early_leave_minutes) details.push({ text: t('hr.day.early', { time: minutesText(rec.early_leave_minutes, t) }), tone: colors.warn });
  if (rec?.overtime_minutes) {
    const ot = rec.overtime_status ?? (rec.overtime_approved ? 'approved' : 'pending');
    details.push({
      text: t(ot === 'approved' ? 'hr.day.overtime' : ot === 'rejected' ? 'hr.day.overtimeRejected' : 'hr.day.overtimePending', {
        time: rec.overtime_night_minutes ? t('hr.day.withNight', { time: minutesText(rec.overtime_minutes, t), night: minutesText(rec.overtime_night_minutes, t) }) : minutesText(rec.overtime_minutes, t),
      }),
      tone: ot === 'approved' ? colors.success : ot === 'rejected' ? colors.danger : colors.warn,
    });
  }
  if (r.holiday) details.push({ text: r.holiday });
  if (r.leave) details.push({ text: pick(r.leave) });
  if (r.pendingLeave) details.push({ text: t('hr.day.leavePending', { type: pick(r.pendingLeave) }), tone: colors.warn });
  for (const p of r.permissions)
    details.push({
      text: t(p.status === 'approved' ? 'hr.day.permission' : 'hr.day.permissionPending', {
        kind: t(`hr.permission.kind.${p.kind}` as TKey),
        from: wallTime(r.day, p.start, locale),
        to: wallTime(r.day, p.end, locale),
      }),
    });
  return (
    <Card style={r.kind === 'rest_day' || r.kind === 'upcoming' ? { opacity: 0.8 } : undefined}>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <T style={{ fontWeight: '600', flex: 1 }}>{`${weekdayName(r.day, t)} ${plainDate(r.day)}`}</T>
        <StatusBadge label={t(`hr.day.status.${r.kind}` as TKey)} tone={dayTone(r.kind)} />
      </Row>
      {details.map((d, i) => (
        <T key={i} style={{ fontSize: 14, marginTop: 2, color: d.tone ?? colors.muted }}>
          {d.text}
        </T>
      ))}
      {rec ? <LocationBadges rec={rec} /> : null}
      {rec?.source === 'manual' ? <Muted style={{ fontSize: 12 }}>{t('hr.day.adjusted')}</Muted> : null}
    </Card>
  );
}

const CHECK_TONE: Record<LocationCheck, 'success' | 'danger' | 'warn'> = { ok: 'success', outside: 'danger', unverified: 'warn' };

/** Clock-in/out location verdicts; nothing when the clinic does not check location (null). */
function LocationBadges({ rec }: { rec: AttendanceRecord }) {
  const { t } = useI18n();
  const label = (check: LocationCheck, d: LocationCheckDetail | null | undefined) => {
    const m = Math.round(Number(d?.distance ?? 0));
    if (check === 'ok') return d?.method === 'gps' ? t('hr.loc.okGps', { m }) : t('hr.loc.okNetwork');
    if (check === 'outside') return d?.distance !== undefined ? t('hr.loc.outside', { m }) : t('hr.loc.outsideNoDistance');
    return t('hr.loc.unverified');
  };
  const items = [
    { key: 'in', when: t('hr.loc.in'), check: rec.clock_in_check, detail: rec.clock_in_check_detail },
    { key: 'out', when: t('hr.loc.out'), check: rec.clock_out_check, detail: rec.clock_out_check_detail },
  ].filter((x) => !!x.check);
  if (!items.length) return null;
  return (
    <Row style={{ flexWrap: 'wrap', marginTop: 6, marginStart: -8 }}>
      {items.map((x) => (
        <StatusBadge key={x.key} label={t('hr.loc.badge', { when: x.when, what: label(x.check!, x.detail) })} tone={CHECK_TONE[x.check!]} />
      ))}
    </Row>
  );
}
