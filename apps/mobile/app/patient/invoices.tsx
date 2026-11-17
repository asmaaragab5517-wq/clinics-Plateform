import * as WebBrowser from 'expo-web-browser';
import { ActionButton, Card, Empty, ErrorBox, Loading, Muted, Row, Screen, StatusBadge, T } from '../../components/ui';
import { FEATURES } from '../../lib/config';
import { portalApi } from '../../lib/endpoints';
import { date, money } from '../../lib/format';
import { useI18n, hasKey } from '../../lib/i18n';
import { useAction, useQuery } from '../../lib/useQuery';

/** Invoices; the PDF opens through a 10-minute signed link (GET /v1/portal/invoices/:id/link) in the system browser. */
export default function Invoices() {
  const { t, locale } = useI18n();
  const q = useQuery('invoices', portalApi.invoices);
  const pdf = useAction();
  const openPdf = (id: string) =>
    void pdf.run(async () => {
      const { url } = await portalApi.invoiceLink(id);
      await WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'close' });
    });
  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      <ErrorBox error={pdf.error} />
      {q.data && !q.data.length ? <Empty /> : null}
      {(q.data ?? []).map((b) => {
        const balance = b.total - b.paid + b.refunded - b.credited;
        const k = `bill.status.${b.status}`;
        return (
          <Card key={b.id}>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <T ltr style={{ fontWeight: '700' }}>{b.number}</T>
              <StatusBadge label={hasKey(k) ? t(k) : b.status} tone={b.status === 'paid' ? 'success' : b.status === 'refunded' ? 'info' : 'warn'} />
            </Row>
            <Muted>{`${b.clinic_name_ar} · ${date(b.issued_at)}`}</Muted>
            <T>{`${t('common.total')}: ${money(b.total, locale)}`}</T>
            <T>{`${t('bill.paid')}: ${money(b.paid, locale)}`}</T>
            {balance > 0 ? <T style={{ fontWeight: '700' }}>{`${t('bill.balance')}: ${money(balance, locale)}`}</T> : null}
            {FEATURES.signedPdfUrls && b.status !== 'draft' && b.status !== 'void' ? <ActionButton kind="secondary" title={t('bill.openPdf')} onPress={() => openPdf(b.id)} loading={pdf.busy} style={{ marginTop: 8 }} /> : null}
          </Card>
        );
      })}
    </Screen>
  );
}
