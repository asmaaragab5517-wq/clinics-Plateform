import { Stack } from 'expo-router';
import { ModeButton } from '../../components/ModeButton';
import { StaffGuard } from '../../components/StaffGuard';
import { colors } from '../../components/ui';
import { useI18n } from '../../lib/i18n';

export default function DoctorLayout() {
  const { t } = useI18n();
  return (
    <StaffGuard mode="doctor">
      <Stack screenOptions={{ headerTitleAlign: 'center', headerBackButtonDisplayMode: 'minimal', headerTintColor: colors.primary, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" options={{ title: t('doctor.today'), headerRight: () => <ModeButton /> }} />
        <Stack.Screen name="encounter/[appointmentId]" options={{ title: t('emr.encounter') }} />
        <Stack.Screen name="earnings" options={{ title: t('doctor.earnings') }} />
        <Stack.Screen name="video" options={{ title: t('video.title') }} />
        <Stack.Screen name="dictation/[encounterId]" options={{ title: t('ai.dictationTitle') }} />
        <Stack.Screen name="draft/[id]" options={{ title: t('ai.draftTitle') }} />
      </Stack>
    </StaffGuard>
  );
}
