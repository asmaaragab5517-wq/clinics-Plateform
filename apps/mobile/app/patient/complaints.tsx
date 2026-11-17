import { router } from 'expo-router';
import { Button, Card, Empty, ErrorBox, Loading, Muted, Row, Screen, StatusBadge, T, colors } from '../../components/ui';
import { portalApi, publicApi } from '../../lib/endpoints';
import { date, patientName } from '../../lib/format';
import { hasKey, useI18n } from '../../lib/i18n';
import { useQuery } from '../../lib/useQuery';
import type { ComplaintStatus } from '../../lib/types';

const TONE: Record<ComplaintStatus, 'info' | 'warn' | 'success'> = { open: 'warn', in_progress: 'info', resolved: 'success', closed: 'info' };

/** The patient's complaints with status and the clinic's response (GET /v1/portal/complaints), plus "new complaint". */
export default function Complaints() {
  const { t, locale, pick } = useI18n();
  const q = useQuery('complaints', portalApi.complaints);
  const clinics = useQuery('public:clinics', publicApi.clinics);
  const me = useQuery('portal:me', portalApi.me);
  const many = (me.data?.patients.length ?? 0) > 1;
  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      <Button title={t('complaint.new')} onPress={() => router.push('/patient/complaint')} />
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      {q.data && !q.data.length ? <Empty text={t('complaint.historyEmpty')} /> : null}
      {(q.data ?? []).map((c) => {
        const clinic = clinics.data?.find((x) => x.id === c.clinic_id);
        const patient = many ? me.data?.patients.find((p) => p.id === c.patient_id) : undefined;
        const cat = `complaint.cat.${c.category}`;
        const st = `complaint.status.${c.status}`;
        return (
          <Card key={c.id}>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <T style={{ fontWeight: '700', flex: 1 }}>{hasKey(cat) ? t(cat) : c.category}</T>
              <StatusBadge label={hasKey(st) ? t(st) : c.status} tone={TONE[c.status] ?? 'info'} />
            </Row>
            <Muted>{[date(c.created_at), clinic ? pick(clinic) : null, patient ? patientName(patient, locale) : null].filter(Boolean).join(' · ')}</Muted>
            <T numberOfLines={4} style={{ marginTop: 6 }}>
              {c.description}
            </T>
            {c.resolution ? (
              <Card style={{ marginTop: 8, marginBottom: 0, backgroundColor: colors.bg }}>
                <T style={{ fontWeight: '600' }}>{c.resolved_at ? `${t('complaint.resolution')} · ${date(c.resolved_at)}` : t('complaint.resolution')}</T>
                <T>{c.resolution}</T>
              </Card>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}
