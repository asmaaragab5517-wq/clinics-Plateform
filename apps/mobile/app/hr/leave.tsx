import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { ActionButton, Banner, Button, Card, Empty, ErrorBox, Loading, Muted, Row, Screen, Section, StatusBadge, T, useErrorText } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { hrApi } from '../../lib/endpoints';
import { plainDate } from '../../lib/format';
import { canCancel, daysText, minutesText, num, requestTone, todayCairo, wallTime } from '../../lib/hr';
import { useI18n, type TKey } from '../../lib/i18n';
import { useAction, useQuery } from '../../lib/useQuery';
import type { LeaveRequest, PermissionRequest } from '../../lib/types';

type Item = { type: 'leave'; r: LeaveRequest; sort: string } | { type: 'permission'; r: PermissionRequest; sort: string };

/** Leave and permissions: balances (GET /v1/hr/me/balances), my requests with status and cancel, and the request forms. */
export default function LeaveAndPermissions() {
  const { t, locale, pick } = useI18n();
  const today = todayCairo();
  const bal = useQuery('hr:balances', () => hrApi.balances());
  const req = useQuery('hr:requests', hrApi.requests);
  const act = useAction();
  const errorText = useErrorText();
  const [notice, setNotice] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);

  const items: Item[] = [
    ...(req.data?.leave ?? []).map((r) => ({ type: 'leave' as const, r, sort: r.start_date })),
    ...(req.data?.permissions ?? []).map((r) => ({ type: 'permission' as const, r, sort: r.work_date })),
  ].sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));

  const cancel = (it: Item) =>
    Alert.alert(t('hr.cancel.title'), t(it.type === 'leave' ? 'hr.cancel.leaveConfirm' : 'hr.cancel.permissionConfirm'), [
      { text: t('hr.cancel.keep'), style: 'cancel' },
      {
        text: t('hr.cancel.yes'),
        style: 'destructive',
        onPress: () =>
          void act.run(async () => {
            setNotice(null);
            try {
              if (it.type === 'leave') await hrApi.cancelLeave(it.r.id);
              else await hrApi.cancelPermission(it.r.id);
              setNotice({ kind: 'success', text: t('hr.cancel.done') });
            } catch (e) {
              // 404: decided or started since the list loaded.
              setNotice({ kind: 'danger', text: e instanceof ApiError && e.status === 404 ? t('hr.cancel.tooLate') : errorText(e) });
            }
            await Promise.all([req.reload(), bal.reload()]);
          }),
      },
    ]);

  const a = bal.data?.annual;
  const sharing = (bal.data?.types ?? []).filter((x) => x.uses_annual_balance).map((x) => pick(x));
  const quotaTypes = (bal.data?.types ?? []).filter((x) => !x.uses_annual_balance && (num(x.annual_quota) !== null || x.used > 0));

  return (
    <Screen refreshing={bal.loading || req.loading} onRefresh={() => { void bal.reload(); void req.reload(); }}>
      <Section title={a ? t('hr.balance.annual', { year: a.year }) : t('hr.balance.title')}>
        {bal.loading && !bal.data ? <Loading /> : null}
        <ErrorBox error={bal.error} onRetry={() => void bal.reload()} />
        {a ? (
          <Card>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <T style={{ fontWeight: '700' }}>{t('hr.balance.availableLabel')}</T>
              <T style={{ fontWeight: '700', fontSize: 20 }}>{daysText(a.available, t)}</T>
            </Row>
            <Muted>{t('hr.balance.entitled', { n: daysText(a.entitled, t) })}</Muted>
            {a.carried ? <Muted>{t('hr.balance.carried', { n: daysText(a.carried, t) })}</Muted> : null}
            {a.adjusted ? <Muted>{t('hr.balance.adjusted', { n: daysText(a.adjusted, t) })}</Muted> : null}
            <Muted>{t('hr.balance.used', { n: daysText(a.used, t) })}</Muted>
            {a.pending ? <Muted>{t('hr.balance.pending', { n: daysText(a.pending, t) })}</Muted> : null}
            {sharing.length ? <Muted style={{ marginTop: 4, fontSize: 12 }}>{t('hr.balance.sharedBy', { types: sharing.join(t('hr.listSep')) })}</Muted> : null}
          </Card>
        ) : null}
        {quotaTypes.map((x) => (
          <Row key={x.id} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
            <T style={{ flex: 1 }}>{pick(x)}</T>
            <Muted>
              {num(x.annual_quota) !== null ? t('hr.balance.usedOf', { used: daysText(x.used, t), of: daysText(x.annual_quota!, t) }) : t('hr.balance.used', { n: daysText(x.used, t) })}
            </Muted>
          </Row>
        ))}
      </Section>

      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
        <ActionButton title={t('hr.leave.request')} onPress={() => router.push('/hr/leave-request')} style={{ flexGrow: 1 }} />
        <ActionButton kind="secondary" title={t('hr.permission.request')} onPress={() => router.push('/hr/permission-request')} style={{ flexGrow: 1 }} />
      </Row>

      <Section title={t('hr.requests.title')}>
        {notice ? <Banner kind={notice.kind}>{notice.text}</Banner> : null}
        {req.loading && !req.data ? <Loading /> : null}
        <ErrorBox error={req.error} onRetry={() => void req.reload()} />
        {req.data && !items.length ? <Empty text={t('hr.requests.empty')} /> : null}
        {items.map((it) => {
          const r = it.r;
          const startDay = it.type === 'leave' ? it.r.start_date : it.r.work_date;
          return (
            <Card key={`${it.type}:${r.id}`} style={r.status === 'cancelled' || r.status === 'rejected' ? { opacity: 0.8 } : undefined}>
              <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <T style={{ fontWeight: '700' }}>{it.type === 'leave' ? pick(it.r) : t(`hr.permission.kind.${it.r.kind}` as TKey)}</T>
                  {it.type === 'leave' ? (
                    <Muted>{`${it.r.start_date === it.r.end_date ? plainDate(it.r.start_date) : t('hr.range', { from: plainDate(it.r.start_date), to: plainDate(it.r.end_date) })} · ${daysText(it.r.days, t)}`}</Muted>
                  ) : (
                    <Muted>{`${plainDate(it.r.work_date)} · ${wallTime(it.r.work_date, it.r.start_time, locale)} – ${wallTime(it.r.work_date, it.r.end_time, locale)} · ${minutesText(it.r.minutes, t)}`}</Muted>
                  )}
                </View>
                <StatusBadge label={t(`hr.status.${r.status}` as TKey)} tone={requestTone(r.status)} />
              </Row>
              {r.reason ? <T style={{ marginTop: 4, fontSize: 14 }}>{r.reason}</T> : null}
              {r.decision_note ? <Muted style={{ marginTop: 4 }}>{t('hr.requests.note', { note: r.decision_note })}</Muted> : null}
              {canCancel(r.status, startDay, today) ? (
                <ActionButton kind="secondary" title={t('hr.cancel.action')} onPress={() => cancel(it)} loading={act.busy} style={{ marginTop: 10, marginBottom: 0 }} />
              ) : null}
            </Card>
          );
        })}
      </Section>
      <Button kind="ghost" title={t('hr.month.title')} onPress={() => router.push('/hr/month')} />
    </Screen>
  );
}
