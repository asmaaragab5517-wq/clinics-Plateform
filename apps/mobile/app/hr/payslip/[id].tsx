import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { View } from 'react-native';
import { Button, Card, Empty, ErrorBox, Loading, Muted, Row, Screen, Section, StatusBadge, T, colors } from '../../../components/ui';
import { hrApi } from '../../../lib/endpoints';
import { money } from '../../../lib/format';
import { lineLabel, lineQuantity, monthLabel } from '../../../lib/hr';
import { useI18n } from '../../../lib/i18n';
import { useAction, useQuery } from '../../../lib/useQuery';
import type { PayslipLine } from '../../../lib/types';

/**
 * Payslip detail from the payslip list (there is no single-payslip JSON route): earnings and deductions lines with
 * labels in the current language, then the totals, as on the printed payslip. The PDF (GET /v1/payroll/payslips/:id/pdf)
 * needs the staff bearer header, which the system browser cannot send, and the app has no file download/share module.
 */
export default function PayslipDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const pdf = useAction();
  const q = useQuery('hr:payslips', hrApi.payslips);
  const p = q.data?.find((x) => x.id === id) ?? null;

  const Lines = ({ lines, tone }: { lines: PayslipLine[]; tone?: string }) =>
    lines.length ? (
      <Card>
        {lines.map((l, i) => {
          const q = lineQuantity(l, t);
          return (
            <Row key={`${l.code}:${i}`} style={{ justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
              <View style={{ flex: 1 }}>
                <T>
                  {lineLabel(l, locale)}
                  {q.text ? <T style={{ color: colors.muted, fontSize: 13 }}>{` (${q.text})`}</T> : null}
                </T>
                {q.note ? <Muted style={{ fontSize: 12 }}>{q.note}</Muted> : null}
              </View>
              <T style={{ color: tone ?? colors.text, marginStart: 8 }}>{money(l.amount, locale)}</T>
            </Row>
          );
        })}
      </Card>
    ) : (
      <Empty text={t('hr.payslips.noLines')} />
    );

  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      {q.data && !p ? <Empty text={t('hr.payslips.notFound')} /> : null}
      {p ? (
        <>
          <Row style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <T style={{ fontWeight: '700', fontSize: 20, flex: 1 }}>{monthLabel(p.month, t)}</T>
            <StatusBadge label={t(p.status === 'paid' ? 'hr.payslips.paid' : 'hr.payslips.approved')} tone={p.status === 'paid' ? 'success' : 'info'} />
          </Row>
          <Section title={t('hr.payslips.earnings')}>
            <Lines lines={p.lines.filter((l) => l.kind === 'earning')} />
          </Section>
          <Section title={t('hr.payslips.deductionLines')}>
            <Lines lines={p.lines.filter((l) => l.kind === 'deduction')} tone={colors.danger} />
          </Section>
          <Card>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
              <T>{t('hr.payslips.gross')}</T>
              <T>{money(p.gross, locale)}</T>
            </Row>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
              <T>{t('hr.payslips.deductions')}</T>
              <T style={{ color: colors.danger }}>{money(p.deductions, locale)}</T>
            </Row>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
              <T style={{ fontWeight: '700', fontSize: 18 }}>{t('hr.payslips.net')}</T>
              <T style={{ fontWeight: '700', fontSize: 18 }}>{money(p.net, locale)}</T>
            </Row>
            <Muted style={{ fontSize: 12, marginTop: 4 }}>{t('hr.payslips.grossNote')}</Muted>
          </Card>
          {p.lines.some((l) => l.kind === 'employer') ? (
            <Section title={t('hr.payslips.employer')}>
              <Lines lines={p.lines.filter((l) => l.kind === 'employer')} tone={colors.muted} />
            </Section>
          ) : null}
          <ErrorBox error={pdf.error} />
          <Button
            kind="secondary"
            title={t('hr.payslips.openPdf')}
            loading={pdf.busy}
            onPress={() =>
              void pdf.run(async () => {
                const { url } = await hrApi.payslipLink(p.id);
                await WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'close' });
              })
            }
          />
        </>
      ) : null}
    </Screen>
  );
}
