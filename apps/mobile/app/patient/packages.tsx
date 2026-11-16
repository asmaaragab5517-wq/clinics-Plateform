import { Card, Empty, ErrorBox, Loading, Muted, Screen, T } from '../../components/ui';
import { portalApi } from '../../lib/endpoints';
import { plainDate } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useQuery } from '../../lib/useQuery';

export default function Packages() {
  const { t, pick } = useI18n();
  const q = useQuery('packages', portalApi.packages);
  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      {q.data && !q.data.length ? <Empty /> : null}
      {(q.data ?? []).map((p) => (
        <Card key={p.id}>
          <T style={{ fontWeight: '700' }}>{pick(p)}</T>
          <T>{t('packages.remaining', { remaining: p.sessions_total - p.sessions_used, total: p.sessions_total })}</T>
          <Muted>{`${t('packages.expires')}: ${plainDate(p.expires_on)}`}</Muted>
        </Card>
      ))}
    </Screen>
  );
}
