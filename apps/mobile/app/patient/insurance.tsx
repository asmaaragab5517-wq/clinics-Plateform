import { View } from 'react-native';
import { Card, Empty, ErrorBox, Loading, Muted, Row, Screen, StatusBadge, T } from '../../components/ui';
import { portalApi } from '../../lib/endpoints';
import { money, patientName, plainDate } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useQuery } from '../../lib/useQuery';

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Insurance on file (GET /v1/portal/coverages): payer, plan, member number, coverage share and validity. Read-only. */
export default function Insurance() {
  const { t, locale } = useI18n();
  const q = useQuery('coverages', portalApi.coverages);
  const me = useQuery('portal:me', portalApi.me);
  const nameOf = (id: string) => {
    const p = me.data?.patients.find((x) => x.id === id);
    return p && (me.data?.patients.length ?? 0) > 1 ? patientName(p, locale) : null;
  };
  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      <Muted style={{ marginBottom: 12 }}>{t('insurance.intro')}</Muted>
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      {q.data && !q.data.length ? <Empty text={t('insurance.empty')} /> : null}
      {(q.data ?? []).map((c) => {
        const pct = num(c.coverage_percent);
        const copay = num(c.copay_fixed);
        const payer = (locale === 'en' && c.payer_name_en) || c.payer_name_ar || c.payer_name_en || t('insurance.payer');
        const who = nameOf(c.patient_id);
        return (
          <Card key={c.id}>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: '700' }}>{payer}</T>
                {c.plan_name ? <Muted>{c.plan_name}</Muted> : null}
              </View>
              <StatusBadge label={t(c.is_active ? 'insurance.active' : 'insurance.inactive')} tone={c.is_active ? 'success' : 'info'} />
            </Row>
            {who ? <T style={{ marginTop: 4 }}>{who}</T> : null}
            <Row style={{ marginTop: 8, alignItems: 'center' }}>
              <Muted>{`${t('insurance.memberNumber')}: `}</Muted>
              <T ltr selectable style={{ fontWeight: '700' }}>
                {c.member_number}
              </T>
            </Row>
            {pct !== null ? <T>{`${t('insurance.coverage')}: ${t('insurance.percent', { pct: Math.round(pct * 100) / 100 })}`}</T> : null}
            {copay ? <T>{`${t('insurance.copay')}: ${money(copay, locale)}`}</T> : null}
            <Muted>{c.valid_to ? t('insurance.validRange', { from: plainDate(c.valid_from), to: plainDate(c.valid_to) }) : t('insurance.validFrom', { from: plainDate(c.valid_from) })}</Muted>
          </Card>
        );
      })}
    </Screen>
  );
}
