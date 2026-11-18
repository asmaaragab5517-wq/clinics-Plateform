import { router } from 'expo-router';
import { Card, Empty, ErrorBox, Loading, Muted, Row, Screen, StatusBadge, T, colors } from '../../components/ui';
import { hrApi } from '../../lib/endpoints';
import { money } from '../../lib/format';
import { monthLabel } from '../../lib/hr';
import { useI18n } from '../../lib/i18n';
import { useQuery } from '../../lib/useQuery';

/** My payslips (GET /v1/payroll/me/payslips): approved and paid months with gross, deductions and net. */
export default function Payslips() {
  const { t, locale } = useI18n();
  const q = useQuery('hr:payslips', hrApi.payslips);
  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      {q.data && !q.data.length ? <Empty text={t('hr.payslips.empty')} /> : null}
      {(q.data ?? []).map((p) => (
        <Card key={p.id} onPress={() => router.push({ pathname: '/hr/payslip/[id]', params: { id: p.id } })} accessibilityLabel={`${monthLabel(p.month, t)}, ${t('hr.payslips.net')} ${money(p.net, locale)}`}>
          <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <T style={{ fontWeight: '700', flex: 1 }}>{monthLabel(p.month, t)}</T>
            <StatusBadge label={t(p.status === 'paid' ? 'hr.payslips.paid' : 'hr.payslips.approved')} tone={p.status === 'paid' ? 'success' : 'info'} />
          </Row>
          <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <Muted>{t('hr.payslips.gross')}</Muted>
            <T>{money(p.gross, locale)}</T>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Muted>{t('hr.payslips.deductions')}</Muted>
            <T style={{ color: colors.danger }}>{money(p.deductions, locale)}</T>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <T style={{ fontWeight: '700' }}>{t('hr.payslips.net')}</T>
            <T style={{ fontWeight: '700' }}>{money(p.net, locale)}</T>
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
