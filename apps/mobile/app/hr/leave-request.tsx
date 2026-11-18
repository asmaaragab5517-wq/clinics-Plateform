import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { ActionButton, Banner, Button, Chip, ErrorBox, Field, Loading, Muted, Screen, Section, T, colors, s, useErrorText } from '../../components/ui';
import { isApiError } from '../../lib/api';
import { hrApi } from '../../lib/endpoints';
import { parseYmd } from '../../lib/format';
import { daysText, num, todayCairo } from '../../lib/hr';
import { useI18n } from '../../lib/i18n';
import { useAction, useQuery } from '../../lib/useQuery';

/** Request leave for yourself (POST /v1/hr/leave-requests). Dates are typed as YYYY-MM-DD; Arabic-Indic digits are accepted. */
export default function LeaveRequestScreen() {
  const { t, pick } = useI18n();
  const types = useQuery('hr:leaveTypes', hrApi.leaveTypes);
  const bal = useQuery('hr:balances', () => hrApi.balances());
  const errorText = useErrorText();
  const act = useAction();
  const [typeId, setTypeId] = useState<string | null>(null);
  const [from, setFrom] = useState(todayCairo());
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const active = (types.data ?? []).filter((x) => x.is_active);
  const type = active.find((x) => x.id === typeId) ?? null;
  const fromYmd = parseYmd(from);
  // An empty end date means a one-day leave.
  const toYmd = to.trim() ? parseYmd(to) : fromYmd;
  const fromError = touched && !fromYmd ? t('hr.form.dateFormat') : null;
  const toError =
    to.trim() && !parseYmd(to)
      ? t('hr.form.dateFormat')
      : fromYmd && toYmd && toYmd < fromYmd
        ? t('hr.form.endBeforeStart')
        : fromYmd && toYmd && fromYmd.slice(0, 4) !== toYmd.slice(0, 4)
          ? t('error.leave_must_stay_within_one_year')
          : null;
  const valid = !!type && !!fromYmd && !!toYmd && !toError && reason.length <= 1000;
  const annual = bal.data?.annual;
  const typeUsed = bal.data?.types.find((x) => x.id === typeId)?.used ?? null;

  const message = (e: unknown): string => {
    const d = isApiError(e) ? ((e.details ?? {}) as Record<string, number>) : {};
    if (isApiError(e, 'insufficient_leave_balance')) return t('hr.leave.error.balance', { available: daysText(d.available ?? 0, t), requested: daysText(d.requested ?? 0, t) });
    if (isApiError(e, 'leave_quota_exceeded')) return t('hr.leave.error.quota', { quota: daysText(d.quota ?? 0, t) });
    if (isApiError(e, 'exceeds_max_consecutive_days')) return t('hr.leave.error.maxDays', { max: daysText(d.max ?? 0, t) });
    return errorText(e);
  };

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    void act.run(async () => {
      await hrApi.requestLeave({ leaveTypeId: type!.id, startDate: fromYmd!, endDate: toYmd!, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      Alert.alert(t('hr.leave.submitted'), t('hr.leave.submittedBody'));
      router.back();
    });
  };

  return (
    <Screen>
      {types.loading && !types.data ? <Loading /> : null}
      <ErrorBox error={types.error} onRetry={() => void types.reload()} />
      <Section title={t('hr.leave.type')}>
        <View style={s.wrap}>
          {active.map((x) => (
            <Chip key={x.id} label={pick(x)} selected={typeId === x.id} onPress={() => setTypeId(x.id)} />
          ))}
        </View>
        {touched && !type ? <T style={{ color: colors.danger }}>{t('hr.leave.chooseType')}</T> : null}
        {type ? (
          <View>
            {type.uses_annual_balance && annual ? <Muted>{t('hr.leave.fromBalance', { n: daysText(annual.available, t) })}</Muted> : null}
            {num(type.annual_quota) !== null ? (
              <Muted>{t('hr.leave.quota', { quota: daysText(type.annual_quota!, t), used: daysText(typeUsed ?? 0, t) })}</Muted>
            ) : null}
            {num(type.max_consecutive_days) !== null ? <Muted>{t('hr.leave.maxDays', { max: daysText(type.max_consecutive_days!, t) })}</Muted> : null}
            {!type.paid ? <Muted>{t('hr.leave.unpaid')}</Muted> : null}
          </View>
        ) : null}
      </Section>
      <Field label={t('hr.leave.from')} value={from} onChangeText={setFrom} ltr keyboardType="numbers-and-punctuation" maxLength={10} placeholder="2026-01-31" error={fromError} />
      <Field label={t('hr.leave.to')} value={to} onChangeText={setTo} ltr keyboardType="numbers-and-punctuation" maxLength={10} placeholder={t('hr.leave.toHint')} error={toError} />
      <Field label={t('hr.form.reason')} value={reason} onChangeText={setReason} multiline maxLength={1000} />
      <Muted style={{ marginBottom: 12 }}>{t('hr.leave.daysNote')}</Muted>
      {act.error ? <Banner kind="danger">{message(act.error)}</Banner> : null}
      <ActionButton title={t('hr.form.submit')} onPress={submit} loading={act.busy} />
      <Button kind="ghost" title={t('common.cancel')} onPress={() => router.back()} disabled={act.busy} />
    </Screen>
  );
}
