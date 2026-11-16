import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Empty, ErrorBox, H1, Loading, Muted, Row, Screen, Section, T } from '../../../components/ui';
import { publicApi } from '../../../lib/endpoints';
import { dateTime, money } from '../../../lib/format';
import { useI18n } from '../../../lib/i18n';
import { useQuery } from '../../../lib/useQuery';

export default function DoctorProfileScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t, pick, locale } = useI18n();
  const d = useQuery(slug ? `doctor:${slug}` : null, () => publicApi.doctor(slug!));
  if (d.loading && !d.data) return <Screen><Loading /></Screen>;
  if (!d.data) return <Screen><ErrorBox error={d.error} onRetry={() => void d.reload()} /></Screen>;
  const doc = d.data;
  const bio = locale === 'en' ? doc.bio_en || doc.bio_ar : doc.bio_ar || doc.bio_en;
  return (
    <Screen footer={<Button title={t('nav.book')} onPress={() => router.push({ pathname: '/patient/book/[slug]', params: { slug: doc.slug } })} />}>
      <H1>{[doc.title, pick(doc)].filter(Boolean).join(' ')}</H1>
      <Muted>{doc.specialties.map((x) => pick(x)).join(' · ')}</Muted>
      {doc.rating_avg != null ? <T style={{ marginTop: 6 }}>{`${t('doctor.rating')}: ${Number(doc.rating_avg).toFixed(1)} (${doc.rating_count ?? 0})`}</T> : null}
      {doc.syndicate_number ? <T ltr>{`${t('doctor.syndicate')} ${doc.syndicate_number}`}</T> : null}
      {doc.nextAvailable ? <T style={{ marginTop: 6, fontWeight: '600' }}>{`${t('doctor.nextAvailable')}: ${dateTime(doc.nextAvailable, locale)}`}</T> : null}
      {bio ? <T style={{ marginTop: 12 }}>{bio}</T> : null}

      <Section title={t('doctor.clinics')}>
        {doc.clinics.map((c) => (
          <Card key={c.id}>
            <T style={{ fontWeight: '600' }}>{pick(c)}</T>
          </Card>
        ))}
      </Section>

      <Section title={t('doctor.services')}>
        {doc.services.map((sv) => (
          <Card key={sv.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T style={{ flex: 1 }}>{pick(sv)}</T>
              {sv.prices?.[0] ? <T style={{ fontWeight: '600' }}>{money(sv.prices[0].price, locale)}</T> : null}
            </Row>
            <Muted>{t('doctor.minutes', { minutes: sv.duration_minutes })}</Muted>
          </Card>
        ))}
      </Section>

      <Section title={t('doctor.reviews')}>
        {!doc.reviews.length ? <Empty /> : null}
        {doc.reviews.map((r, i) => (
          <Card key={i}>
            <T style={{ fontWeight: '600' }}>{`${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}  ${r.display_name}`}</T>
            {r.comment ? <T>{r.comment}</T> : null}
          </Card>
        ))}
      </Section>
    </Screen>
  );
}
