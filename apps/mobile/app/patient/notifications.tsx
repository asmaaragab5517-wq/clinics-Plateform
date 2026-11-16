import { Card, Empty, ErrorBox, Loading, Muted, Screen, T } from '../../components/ui';
import { portalApi } from '../../lib/endpoints';
import { dateTime } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useQuery } from '../../lib/useQuery';

/** Notifications inbox: messages sent to the account's patients (OTP messages are excluded by the API). */
export default function Notifications() {
  const { t, locale } = useI18n();
  const q = useQuery('notifications', portalApi.notifications);
  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      {q.data && !q.data.length ? <Empty /> : null}
      {(q.data ?? []).map((m) => (
        <Card key={m.id}>
          <T>{m.body}</T>
          <Muted>{`${dateTime(m.created_at, locale)} · ${t(`channel.${m.channel === 'whatsapp' || m.channel === 'sms' || m.channel === 'email' ? m.channel : 'push'}`)}`}</Muted>
        </Card>
      ))}
    </Screen>
  );
}
