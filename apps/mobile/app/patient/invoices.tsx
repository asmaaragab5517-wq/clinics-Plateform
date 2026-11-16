import { Card, Empty, ErrorBox, Loading, Muted, Row, Screen, StatusBadge, T } from '../../components/ui';
import { portalApi } from '../../lib/endpoints';
import { date, money } from '../../lib/format';
import { useI18n, hasKey } from '../../lib/i18n';
import { useQuery } from '../../lib/useQuery';

export default function Invoices() {
  const { t, locale } = useI18n();
  const q = useQuery('invoices', portalApi.invoices);
  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      {q.data && !q.data.length ? <Empty /> : null}
      {(q.data ?? []).map((b) => {
        const balance = b.total - b.paid + b.refunded - b.credited;
        const k = `bill.status.${b.status}`;
        return (
          <Card key={b.id}>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <T ltr style={{ fontWeight: '700' }}>{b.number}</T>
              <StatusBadge label={hasKey(k) ? t(k) : b.status} tone={b.status === 'paid' ? 'success' : b.status === 'refunded' ? 'info' : 'warn'} />
            </Row>
            <Muted>{`${b.clinic_name_ar} · ${date(b.issued_at)}`}</Muted>
            <T>{`${t('common.total')}: ${money(b.total, locale)}`}</T>
            <T>{`${t('bill.paid')}: ${money(b.paid, locale)}`}</T>
            {balance > 0 ? <T style={{ fontWeight: '700' }}>{`${t('bill.balance')}: ${money(balance, locale)}`}</T> : null}
          </Card>
        );
      })}
    </Screen>
  );
}
