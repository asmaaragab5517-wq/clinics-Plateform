import { router } from 'expo-router';
import { View, useWindowDimensions } from 'react-native';
import { AppointmentCard } from '../../components/AppointmentCard';
import { Banner, Button, Card, Empty, ErrorBox, Loading, Muted, Screen, Section, T, s } from '../../components/ui';
import { cacheUpcoming, readUpcoming } from '../../lib/cache';
import { portalApi } from '../../lib/endpoints';
import { date } from '../../lib/format';
import { useI18n, type TKey } from '../../lib/i18n';
import { useQuery } from '../../lib/useQuery';

const TILES: { key: TKey; path: string }[] = [
  { key: 'patient.findDoctor', path: '/patient/doctors' },
  { key: 'patient.appointments', path: '/patient/appointments' },
  { key: 'patient.prescriptions', path: '/patient/prescriptions' },
  { key: 'patient.reports', path: '/patient/documents' },
  { key: 'patient.invoices', path: '/patient/invoices' },
  { key: 'patient.packages', path: '/patient/packages' },
  { key: 'patient.family', path: '/patient/family' },
  { key: 'patient.notifications', path: '/patient/notifications' },
  { key: 'settings.title', path: '/patient/settings' },
];

/** Patient home: next appointment (with live queue position when checked in) and shortcuts. */
export default function PatientHome() {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const cols = width >= 700 ? 3 : 2;
  const upcoming = useQuery('upcoming', () => portalApi.appointments('upcoming'), {
    onData: (d) => void cacheUpcoming(d),
    fallback: async () => (await readUpcoming())?.items ?? null,
  });
  const next = upcoming.data?.[0];

  return (
    <Screen refreshing={upcoming.loading} onRefresh={() => void upcoming.reload()}>
      <Section title={t('patient.nextAppointment')}>
        {upcoming.fromCache ? <Banner kind="warn">{t('offline.cached')}</Banner> : null}
        {upcoming.loading && !upcoming.data ? <Loading /> : null}
        <ErrorBox error={upcoming.error} onRetry={() => void upcoming.reload()} />
        {next ? <AppointmentCard a={next} live={!upcoming.fromCache} /> : upcoming.data ? <Empty text={t('patient.noUpcoming')} /> : null}
        {upcoming.data && upcoming.data.length > 1 ? <Muted>{t('patient.moreUpcoming', { count: upcoming.data.length - 1, date: date(upcoming.data[1]!.start_at) })}</Muted> : null}
        <Button title={t('nav.book')} onPress={() => router.push('/patient/doctors')} style={{ marginTop: 8 }} />
      </Section>
      <View style={s.wrap}>
        {TILES.map((tile) => (
          <View key={tile.path} style={{ width: `${100 / cols}%`, paddingEnd: 8 }}>
            <Card onPress={() => router.push(tile.path as never)} accessibilityLabel={t(tile.key)} style={{ minHeight: 72, justifyContent: 'center' }}>
              <T style={{ fontWeight: '600', textAlign: 'center' }}>{t(tile.key)}</T>
            </Card>
          </View>
        ))}
      </View>
    </Screen>
  );
}
