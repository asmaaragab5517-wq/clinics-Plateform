import { router } from 'expo-router';
import { Button, Empty, Screen } from '../components/ui';
import { useI18n } from '../lib/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <Screen>
      <Empty text={t('common.notFound')} />
      <Button title={t('nav.home')} onPress={() => router.replace('/')} />
    </Screen>
  );
}
