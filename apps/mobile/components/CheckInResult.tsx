import { Banner, Card, T } from './ui';
import { useI18n } from '../lib/i18n';

export function CheckInResult({ ticket }: { ticket: number | null | undefined }) {
  const { t } = useI18n();
  return (
    <Card>
      <Banner kind="success">{t('reception.checkedIn')}</Banner>
      {ticket != null ? <T style={{ fontSize: 28, fontWeight: '700', textAlign: 'center' }}>{`${t('queue.ticket')} ${ticket}`}</T> : null}
    </Card>
  );
}
