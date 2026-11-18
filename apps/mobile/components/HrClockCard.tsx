import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { addDays } from '@hf/shared';
import { ActionButton, Banner, Button, Card, ErrorBox, Loading, Muted, Row, StatusBadge, T, colors } from './ui';
import { isApiError } from '../lib/api';
import { hrApi } from '../lib/endpoints';
import { time } from '../lib/format';
import { isWorkDay, jobTitle, minutesText, todayCairo, wallTime } from '../lib/hr';
import { useI18n } from '../lib/i18n';
import { useAction, useQuery } from '../lib/useQuery';
import type { AttendanceRecord } from '../lib/types';

/** The API closes an open record from yesterday when its clock-in is under 16 hours old (hr.ts `clock`). */
const OVERNIGHT_MS = 16 * 3600 * 1000;

/**
 * My HR home card for the staff modes: today's shift, a large Clock in / Clock out button and the clock-in time.
 * Clocking out asks for confirmation. `showLink` adds the way into the My HR screens (home screens only).
 */
export function HrClockCard({ showLink = true }: { showLink?: boolean }) {
  const { t, locale, pick } = useI18n();
  const today = todayCairo();
  const month = today.slice(0, 7);
  const me = useQuery('hr:me', hrApi.me);
  const c = me.data?.contract ?? null;
  const rec = me.data?.today ?? null;
  // The month gives today's holiday and approved leave, and yesterday's record for a shift past midnight.
  const cur = useQuery(c ? `hr:card:${month}` : null, () => hrApi.month(month));
  const yesterday = addDays(today, -1);
  const needPrev = !!c && !rec?.clock_in && yesterday.slice(0, 7) !== month;
  const prev = useQuery(needPrev ? `hr:card:${yesterday.slice(0, 7)}` : null, () => hrApi.month(yesterday.slice(0, 7)));
  const act = useAction();
  const [notice, setNotice] = useState<string | null>(null);

  const yRec = [...(cur.data?.days ?? []), ...(prev.data?.days ?? [])].find((d) => d.day === yesterday) ?? null;
  const overnight: AttendanceRecord | null =
    !rec?.clock_in && yRec?.clock_in && !yRec.clock_out && Date.now() - new Date(yRec.clock_in).getTime() < OVERNIGHT_MS ? yRec : null;
  const open = overnight ?? (rec?.clock_in && !rec.clock_out ? rec : null);
  const done = !!rec?.clock_in && !!rec.clock_out;

  const holiday = cur.data?.holidays.find((h) => h.day === today) ?? null;
  const leave = cur.data?.leave.find((l) => l.status === 'approved' && l.start_date <= today && l.end_date >= today) ?? null;
  const scheduled = c ? isWorkDay(c.work_pattern, today) : false;

  const reload = async () => {
    await Promise.all([me.reload(), cur.reload(), needPrev ? prev.reload() : Promise.resolve()]);
  };

  const clock = (action: 'in' | 'out') =>
    void act.run(async () => {
      setNotice(null);
      try {
        await hrApi.clock(action);
      } catch (e) {
        // Clocked in or out on another device or in the console: show the current state instead of an error.
        if (isApiError(e, 'already_clocked_in') || isApiError(e, 'not_clocked_in')) setNotice(t(`error.${e.code}` as 'error.already_clocked_in'));
        else throw e;
      }
      await reload();
    });

  const confirmOut = () =>
    Alert.alert(t('hr.clock.outTitle'), t('hr.clock.outConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('hr.clock.out'), style: 'destructive', onPress: () => clock('out') },
    ]);

  const shiftText = !c
    ? null
    : holiday
      ? t('hr.today.holiday', { name: pick(holiday) })
      : leave
        ? t('hr.today.onLeave', { type: pick(leave) })
        : scheduled
          ? t('hr.today.shift', { start: wallTime(today, c.work_pattern.start, locale), end: wallTime(today, c.work_pattern.end, locale) })
          : t('hr.today.restDay');

  return (
    <Card>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <T style={{ fontWeight: '700', fontSize: 18, flex: 1 }}>{t('hr.title')}</T>
        {open ? <StatusBadge label={t('hr.clock.clockedIn')} tone="success" /> : done ? <StatusBadge label={t('hr.clock.doneToday')} tone="info" /> : null}
      </Row>
      {me.loading && !me.data ? <Loading /> : null}
      <ErrorBox error={me.error} onRetry={() => void me.reload()} />
      {me.data && !c ? <Muted style={{ marginVertical: 6 }}>{t('hr.noContract')}</Muted> : null}
      {c ? (
        <View style={{ marginTop: 4 }}>
          <Muted>{jobTitle(c, locale)}</Muted>
          {shiftText ? <T style={{ marginTop: 6 }}>{shiftText}</T> : null}
          {overnight ? (
            <T style={{ marginTop: 6, color: colors.warn }}>{t('hr.clock.sinceYesterday', { time: time(overnight.clock_in!, locale) })}</T>
          ) : rec?.clock_in ? (
            <Row style={{ marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <T style={{ fontWeight: '600' }}>{t('hr.clock.inAt', { time: time(rec.clock_in, locale) })}</T>
              {rec.late_minutes > 0 ? <StatusBadge label={t('hr.day.late', { time: minutesText(rec.late_minutes, t) })} tone="warn" /> : null}
            </Row>
          ) : null}
          {rec?.clock_out ? (
            <T style={{ marginTop: 2 }}>{`${t('hr.clock.outAt', { time: time(rec.clock_out, locale) })} · ${t('hr.day.worked', { time: minutesText(rec.worked_minutes, t) })}`}</T>
          ) : null}
          {notice ? <Banner kind="info">{notice}</Banner> : null}
          {act.error ? <ErrorBox error={act.error} /> : null}
          {open ? (
            <ActionButton large kind="danger" title={t('hr.clock.out')} onPress={confirmOut} loading={act.busy} style={{ marginTop: 12 }} />
          ) : !done ? (
            <ActionButton large title={t('hr.clock.in')} onPress={() => clock('in')} loading={act.busy} style={{ marginTop: 12 }} accessibilityHint={shiftText ?? undefined} />
          ) : null}
          {!open && !done && (!scheduled || holiday) && !leave ? <Muted>{t('hr.clock.restDayNote')}</Muted> : null}
        </View>
      ) : null}
      {showLink ? <Button kind="ghost" title={t('hr.open')} onPress={() => router.push('/hr')} style={{ marginBottom: 0 }} /> : null}
    </Card>
  );
}
