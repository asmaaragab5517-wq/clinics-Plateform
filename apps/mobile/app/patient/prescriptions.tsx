import { Banner, Button, Card, Empty, ErrorBox, Loading, Muted, Screen, T } from '../../components/ui';
import { cachePrescriptions, readPrescriptions } from '../../lib/cache';
import { FEATURES } from '../../lib/config';
import { portalApi } from '../../lib/endpoints';
import { date } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useClinicalScreen } from '../../lib/screenCapture';
import { useQuery } from '../../lib/useQuery';

/**
 * Prescriptions (FR-APP-1). The latest ones are cached for offline reading (FR-APP-6).
 * PDF: GET /v1/portal/prescriptions/:id/pdf needs the bearer header, which the in-app browser cannot send;
 * the button is behind FEATURES.signedPdfUrls until the API offers a signed URL (README "Stubbed").
 */
export default function Prescriptions() {
  useClinicalScreen('prescriptions');
  const { t, locale, pick } = useI18n();
  const q = useQuery('rx', portalApi.prescriptions, {
    onData: (d) => void cachePrescriptions(d),
    fallback: async () => (await readPrescriptions())?.items ?? null,
  });
  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      {q.fromCache ? <Banner kind="warn">{t('offline.cached')}</Banner> : null}
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      {q.data && !q.data.length ? <Empty /> : null}
      {(q.data ?? []).map((rx) => (
        <Card key={rx.id}>
          <T style={{ fontWeight: '700' }}>{`${t('rx.title')} · ${date(rx.issued_at)}`}</T>
          <Muted>{pick({ name_ar: rx.doctor_name_ar, name_en: rx.doctor_name_en })}</Muted>
          {(rx.lines ?? []).map((l, i) => (
            <Card key={i} style={{ marginTop: 8, marginBottom: 0 }}>
              <T ltr style={{ fontWeight: '600' }}>{l.drug ?? '—'}</T>
              <T>{(locale === 'en' ? l.instructionsEn || l.instructionsAr : l.instructionsAr || l.instructionsEn) || '—'}</T>
              {l.durationDays ? <Muted>{t('rx.durationDays', { days: l.durationDays })}</Muted> : null}
            </Card>
          ))}
          {FEATURES.signedPdfUrls ? <Button kind="secondary" title={t('rx.openPdf')} onPress={() => undefined} style={{ marginTop: 8 }} /> : null}
        </Card>
      ))}
    </Screen>
  );
}
