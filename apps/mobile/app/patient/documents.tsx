import * as WebBrowser from 'expo-web-browser';
import { Card, Empty, ErrorBox, ListItem, Loading, Muted, Screen, Section, T } from '../../components/ui';
import { portalApi } from '../../lib/endpoints';
import { date } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useClinicalScreen } from '../../lib/screenCapture';
import { useAction, useQuery } from '../../lib/useQuery';

/** Reports/results (FR-APP-1): documents open through a 5-minute signed URL; signed visit summaries in-app. */
export default function Documents() {
  useClinicalScreen('documents');
  const { t } = useI18n();
  const docs = useQuery('docs', portalApi.documents);
  const visits = useQuery('visits', portalApi.visits);
  const open = useAction();

  const openDoc = (id: string) =>
    void open.run(async () => {
      const { url } = await portalApi.documentUrl(id);
      await WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'close' });
    });

  return (
    <Screen refreshing={docs.loading} onRefresh={() => { void docs.reload(); void visits.reload(); }}>
      <ErrorBox error={open.error} />
      <Section title={t('patient.documents')}>
        {docs.loading && !docs.data ? <Loading /> : null}
        <ErrorBox error={docs.error} onRetry={() => void docs.reload()} />
        {docs.data && !docs.data.length ? <Empty /> : null}
        {(docs.data ?? []).map((d) => (
          <ListItem key={d.id} title={d.title} subtitle={`${date(d.created_at)} · ${t(d.patient_provided ? 'documents.uploadedByYou' : 'documents.fromClinic')}`} onPress={() => openDoc(d.id)} />
        ))}
      </Section>
      <Section title={t('patient.visits')}>
        {visits.data && !visits.data.length ? <Empty /> : null}
        <ErrorBox error={visits.error} />
        {(visits.data ?? []).map((v) => (
          <Card key={v.id}>
            <T style={{ fontWeight: '700' }}>{`${date(v.signed_at)} · ${v.doctor_name_ar}`}</T>
            <Muted>{v.clinic_name_ar}</Muted>
            {v.diagnoses?.length ? <T ltr>{v.diagnoses.map((d) => d.code).join(', ')}</T> : null}
            {v.patient_summary ? <T style={{ marginTop: 6 }}>{v.patient_summary}</T> : null}
            {v.follow_up?.date ? <Muted>{`${t('visits.followUp')}: ${v.follow_up.date.split('-').reverse().join('/')}`}</Muted> : null}
          </Card>
        ))}
      </Section>
    </Screen>
  );
}
