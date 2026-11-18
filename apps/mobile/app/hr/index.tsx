import { router } from 'expo-router';
import { WEEK_ORDER } from '@hf/shared';
import { HrClockCard } from '../../components/HrClockCard';
import { Card, ErrorBox, ListItem, Muted, Row, Screen, Section, T } from '../../components/ui';
import { hrApi } from '../../lib/endpoints';
import { daysText, jobTitle, shiftHours, todayCairo } from '../../lib/hr';
import { useI18n } from '../../lib/i18n';
import { useQuery } from '../../lib/useQuery';
import type { TKey } from '../../lib/i18n';

/** My HR hub (GET /v1/hr/me): clock in/out, contract basics, annual balance, pending requests and the HR screens. */
export default function MyHr() {
  const { t, locale } = useI18n();
  const me = useQuery('hr:me', hrApi.me);
  const c = me.data?.contract ?? null;
  const bal = me.data?.annualBalance ?? null;
  const pending = (me.data?.pending.leave.length ?? 0) + (me.data?.pending.permissions.length ?? 0);
  const today = todayCairo();

  return (
    <Screen refreshing={me.loading} onRefresh={() => void me.reload()}>
      <HrClockCard showLink={false} />
      <ErrorBox error={me.error} onRetry={() => void me.reload()} />
      {c ? (
        <Section title={t('hr.contract.title')}>
          <Card>
            <T style={{ fontWeight: '700' }}>{jobTitle(c, locale)}</T>
            <Muted>{`${t(`hr.contract.type.${c.employment_type}` as TKey)} · ${t(`hr.contract.basis.${c.pay_basis}` as TKey)}`}</Muted>
            <T style={{ marginTop: 6 }}>
              {t('hr.contract.hoursText', { hours: shiftHours(c.work_pattern, today, locale, t) })}
            </T>
            <Muted>{WEEK_ORDER.filter((d) => c.work_pattern.days.includes(d)).map((d) => t(`hr.weekday.${d}` as TKey)).join(t('hr.listSep'))}</Muted>
          </Card>
        </Section>
      ) : null}
      {bal ? (
        <Card onPress={() => router.push('/hr/leave')} accessibilityLabel={t('hr.balance.available', { days: daysText(bal.available, t) })}>
          <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <T style={{ fontWeight: '700' }}>{t('hr.balance.annual', { year: bal.year })}</T>
            <T style={{ fontWeight: '700', fontSize: 18 }}>{daysText(bal.available, t)}</T>
          </Row>
          <Muted>{t('hr.balance.line', { entitled: daysText(bal.entitled + bal.carried + bal.adjusted, t), used: daysText(bal.used, t), pending: daysText(bal.pending, t) })}</Muted>
        </Card>
      ) : null}
      <ListItem title={t('hr.month.title')} subtitle={t('hr.month.subtitle')} onPress={() => router.push('/hr/month')} />
      <ListItem
        title={t('hr.leave.title')}
        subtitle={pending ? t('hr.leave.pendingCount', { n: pending }) : t('hr.leave.subtitle')}
        onPress={() => router.push('/hr/leave')}
      />
      <ListItem title={t('hr.payslips.title')} subtitle={t('hr.payslips.subtitle')} onPress={() => router.push('/hr/payslips')} />
    </Screen>
  );
}
