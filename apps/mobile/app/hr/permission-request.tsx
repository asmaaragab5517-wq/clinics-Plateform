import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { minutesOf } from '@hf/shared';
import { ActionButton, Banner, Button, Chip, Field, Muted, Screen, Section, T, colors, s, useErrorText } from '../../components/ui';
import { isApiError } from '../../lib/api';
import { hrApi } from '../../lib/endpoints';
import { parseHhmm, parseYmd } from '../../lib/format';
import { isWorkDay, minutesText, todayCairo } from '../../lib/hr';
import { useI18n, type TKey } from '../../lib/i18n';
import { useAction, useQuery } from '../../lib/useQuery';
import type { PermissionKind } from '../../lib/types';

const KINDS: PermissionKind[] = ['late_arrival', 'early_leave', 'during_day'];

/**
 * Request an hourly permission (POST /v1/hr/permission-requests): late arrival, early leave or time out during the
 * day, within the monthly allowance. Times are Cairo local on a 24-hour clock (HH:MM).
 */
export default function PermissionRequestScreen() {
  const { t } = useI18n();
  const me = useQuery('hr:me', hrApi.me);
  const errorText = useErrorText();
  const act = useAction();
  const [kind, setKind] = useState<PermissionKind | null>(null);
  const [day, setDay] = useState(todayCairo());
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const pattern = me.data?.contract?.work_pattern ?? null;
  const allowance = me.data?.permissionAllowance ?? null;
  const left = allowance ? { n: Math.max(0, allowance.perMonth - allowance.used), minutes: Math.max(0, allowance.minutesPerMonth - allowance.usedMinutes) } : null;

  const pickKind = (k: PermissionKind) => {
    setKind(k);
    // Late arrival starts at the shift start; early leave ends at the shift end.
    if (!pattern) return;
    if (k === 'late_arrival') {
      setStart(pattern.start);
      if (end === pattern.end) setEnd('');
    } else if (k === 'early_leave') {
      setEnd(pattern.end);
      if (start === pattern.start) setStart('');
    }
  };

  const dayYmd = parseYmd(day);
  const startHm = parseHhmm(start);
  const endHm = parseHhmm(end);
  const dayError = touched && !dayYmd ? t('hr.form.dateFormat') : null;
  const startError = touched && !startHm ? t('hr.form.timeFormat') : null;
  const endError = touched && !endHm ? t('hr.form.timeFormat') : startHm && endHm && minutesOf(endHm) <= minutesOf(startHm) ? t('hr.form.endBeforeStartTime') : null;
  const minutes = startHm && endHm && minutesOf(endHm) > minutesOf(startHm) ? minutesOf(endHm) - minutesOf(startHm) : null;
  const valid = !!kind && !!dayYmd && minutes !== null;

  const message = (e: unknown): string => {
    if (isApiError(e, 'permission_allowance_exceeded')) {
      const d = (e.details ?? {}) as { perMonth?: number; minutesPerMonth?: number; used?: number; usedMinutes?: number };
      return t('hr.permission.error.allowance', {
        perMonth: d.perMonth ?? 0,
        minutes: minutesText(d.minutesPerMonth ?? 0, t),
        used: d.used ?? 0,
        usedMinutes: minutesText(d.usedMinutes ?? 0, t),
      });
    }
    if (isApiError(e, 'validation_failed') && Array.isArray(e.details) && (e.details as { path?: string }[]).some((x) => x.path === 'endTime')) return t('hr.form.endBeforeStartTime');
    return errorText(e);
  };

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    void act.run(async () => {
      await hrApi.requestPermission({ workDate: dayYmd!, kind: kind!, startTime: startHm!, endTime: endHm!, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      Alert.alert(t('hr.permission.submitted'), t('hr.leave.submittedBody'));
      router.back();
    });
  };

  return (
    <Screen>
      <Section title={t('hr.permission.kind')}>
        <View style={s.wrap}>
          {KINDS.map((k) => (
            <Chip key={k} label={t(`hr.permission.kind.${k}` as TKey)} selected={kind === k} onPress={() => pickKind(k)} />
          ))}
        </View>
        {touched && !kind ? <T style={{ color: colors.danger }}>{t('hr.permission.chooseKind')}</T> : null}
      </Section>
      <Field label={t('hr.permission.day')} value={day} onChangeText={setDay} ltr keyboardType="numbers-and-punctuation" maxLength={10} placeholder="2026-01-31" error={dayError} />
      {pattern && dayYmd ? (
        <Muted style={{ marginTop: -6, marginBottom: 12 }}>
          {isWorkDay(pattern, dayYmd) ? t('hr.permission.shift', { start: pattern.start, end: pattern.end }) : t('hr.permission.restDay')}
        </Muted>
      ) : null}
      <Field label={t('hr.permission.from')} value={start} onChangeText={setStart} ltr keyboardType="numbers-and-punctuation" maxLength={5} placeholder="09:00" error={startError} />
      <Field label={t('hr.permission.to')} value={end} onChangeText={setEnd} ltr keyboardType="numbers-and-punctuation" maxLength={5} placeholder="11:30" error={endError} />
      {minutes !== null ? <T style={{ marginBottom: 12 }}>{t('hr.permission.duration', { time: minutesText(minutes, t) })}</T> : null}
      <Field label={t('hr.form.reason')} value={reason} onChangeText={setReason} multiline maxLength={1000} />
      {allowance && left ? (
        <View style={{ marginBottom: 12 }}>
          <T style={{ fontWeight: '600' }}>
            {t('hr.permission.left', { n: left.n, of: allowance.perMonth, time: minutesText(left.minutes, t), ofTime: minutesText(allowance.minutesPerMonth, t) })}
          </T>
          {left.n === 0 || left.minutes === 0 ? <Banner kind="warn">{t('hr.permission.noneLeft')}</Banner> : null}
          {minutes !== null && left.n > 0 && minutes > left.minutes && dayYmd?.slice(0, 7) === todayCairo().slice(0, 7) ? (
            <Banner kind="warn">{t('hr.permission.overMinutes', { time: minutesText(left.minutes, t) })}</Banner>
          ) : null}
        </View>
      ) : null}
      <Muted style={{ marginBottom: 12 }}>{t('hr.permission.allowanceNote')}</Muted>
      {act.error ? <Banner kind="danger">{message(act.error)}</Banner> : null}
      <ActionButton title={t('hr.form.submit')} onPress={submit} loading={act.busy} />
      <Button kind="ghost" title={t('common.cancel')} onPress={() => router.back()} disabled={act.busy} />
    </Screen>
  );
}
