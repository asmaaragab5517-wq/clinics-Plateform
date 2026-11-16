import { Card, Empty, ErrorBox, Loading, Muted, Row, Screen, StatusBadge, T } from '../../components/ui';
import { staffApi } from '../../lib/endpoints';
import { money } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useQuery } from '../../lib/useQuery';

/** Own earnings summary (FR-APP-2): monthly commission statements; the API returns only the caller's own rows. */
export default function Earnings() {
  const { t, locale } = useI18n();
  const q = useQuery('statements', staffApi.statements);
  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      {q.data && !q.data.length ? <Empty /> : null}
      {(q.data ?? []).map((st) => (
        <Card key={st.id}>
          <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <T ltr style={{ fontWeight: '700' }}>{st.month.slice(0, 7)}</T>
            <StatusBadge label={t(`earnings.${st.status}`)} tone={st.status === 'approved' ? 'success' : 'warn'} />
          </Row>
          <T>{`${t('report.revenue')}: ${money(st.revenue, locale)}`}</T>
          <T style={{ fontWeight: '700' }}>{`${t('earnings.share')}: ${money(st.share, locale)}`}</T>
          <Muted>{t('earnings.note')}</Muted>
        </Card>
      ))}
    </Screen>
  );
}
