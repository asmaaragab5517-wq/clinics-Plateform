import { Stack } from 'expo-router';
import { ModeButton } from '../../components/ModeButton';
import { StaffGuard } from '../../components/StaffGuard';
import { colors } from '../../components/ui';
import { useI18n } from '../../lib/i18n';

export default function ReceptionLayout() {
  const { t } = useI18n();
  return (
    <StaffGuard mode="reception">
      <Stack screenOptions={{ headerTitleAlign: 'center', headerBackButtonDisplayMode: 'minimal', headerTintColor: colors.primary, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" options={{ title: t('reception.title'), headerRight: () => <ModeButton /> }} />
        <Stack.Screen name="scan" options={{ title: t('reception.scan') }} />
        <Stack.Screen name="search" options={{ title: t('reception.searchCheckIn') }} />
        <Stack.Screen name="walk-in" options={{ title: t('reception.walkIn') }} />
      </Stack>
    </StaffGuard>
  );
}
