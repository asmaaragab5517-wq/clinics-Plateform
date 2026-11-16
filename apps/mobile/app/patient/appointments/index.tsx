import { useState } from 'react';
import { View } from 'react-native';
import { AppointmentCard } from '../../../components/AppointmentCard';
import { Banner, Chip, Empty, ErrorBox, Loading, Screen, s } from '../../../components/ui';
import { cacheUpcoming, readUpcoming } from '../../../lib/cache';
import { portalApi } from '../../../lib/endpoints';
import { useI18n } from '../../../lib/i18n';
import { useQuery } from '../../../lib/useQuery';

export default function Appointments() {
  const { t } = useI18n();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const q = useQuery(`appointments:${scope}`, () => portalApi.appointments(scope), {
    onData: (d) => scope === 'upcoming' && void cacheUpcoming(d),
    fallback: async () => (scope === 'upcoming' ? (await readUpcoming())?.items ?? null : null),
  });
  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      <View style={s.wrap}>
        <Chip label={t('appointments.upcoming')} selected={scope === 'upcoming'} onPress={() => setScope('upcoming')} />
        <Chip label={t('appointments.past')} selected={scope === 'past'} onPress={() => setScope('past')} />
      </View>
      {q.fromCache ? <Banner kind="warn">{t('offline.cached')}</Banner> : null}
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      {q.data && !q.data.length ? <Empty /> : null}
      {(q.data ?? []).map((a) => (
        <AppointmentCard key={a.id} a={a} live={scope === 'upcoming' && !q.fromCache} />
      ))}
    </Screen>
  );
}
