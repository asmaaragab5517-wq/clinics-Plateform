import * as WebBrowser from 'expo-web-browser';
import { ActionButton, Banner, Card, Empty, ErrorBox, Loading, Muted, Screen, T } from '../../components/ui';
import { cachePrescriptions, readPrescriptions } from '../../lib/cache';
import { FEATURES } from '../../lib/config';
import { portalApi } from '../../lib/endpoints';
import { date } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useClinicalScreen } from '../../lib/screenCapture';
import { useAction, useQuery } from '../../lib/useQuery';

/**
 * Prescriptions (FR-APP-1). The latest ones are cached for offline reading (FR-APP-6).
 * PDF: GET /v1/portal/prescriptions/:id/link returns a 10-minute signed URL, opened in the system browser
 * (it can save or share the PDF). The link is fetched on tap, never cached.
 */
export default function Prescriptions() {
  useClinicalScreen('prescriptions');
  const { t, locale, pick } = useI18n();
  const q = useQuery('rx', portalApi.prescriptions, {
    onData: (d) => void cachePrescriptions(d),
    fallback: async () => (await readPrescriptions())?.items ?? null,
  });
  const pdf = useAction();
  const openPdf = (id: string) =>
    void pdf.run(async () => {
      const { url } = await portalApi.prescriptionLink(id);
      await WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'close' });
    });
  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      {q.fromCache ? <Banner kind="warn">{t('offline.cached')}</Banner> : null}
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      <ErrorBox error={pdf.error} />
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
          {FEATURES.signedPdfUrls ? <ActionButton kind="secondary" title={t('rx.openPdf')} onPress={() => openPdf(rx.id)} loading={pdf.busy} style={{ marginTop: 8 }} /> : null}
        </Card>
      ))}
    </Screen>
  );
}
