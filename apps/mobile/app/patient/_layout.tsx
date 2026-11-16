import { useEffect } from 'react';
import { Redirect, Stack } from 'expo-router';
import { ModeButton } from '../../components/ModeButton';
import { colors } from '../../components/ui';
import { useI18n } from '../../lib/i18n';
import { registerForPush } from '../../lib/push';
import { useSession } from '../../lib/session';

export default function PatientLayout() {
  const { t } = useI18n();
  const { hasPatient, ready, modes } = useSession();
  useEffect(() => {
    if (hasPatient) void registerForPush({ prompt: false });
  }, [hasPatient]);
  if (ready && !hasPatient) return <Redirect href="/sign-in" />;
  return (
    <Stack screenOptions={{ headerTitleAlign: 'center', headerBackButtonDisplayMode: 'minimal', headerTintColor: colors.primary, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" options={{ title: t('app.name'), headerRight: modes.length > 1 ? () => <ModeButton /> : undefined }} />
      <Stack.Screen name="doctors/index" options={{ title: t('nav.doctors') }} />
      <Stack.Screen name="doctors/[slug]" options={{ title: t('doctor.profile') }} />
      <Stack.Screen name="book/[slug]" options={{ title: t('booking.title') }} />
      <Stack.Screen name="appointments/index" options={{ title: t('patient.appointments') }} />
      <Stack.Screen name="appointments/[id]" options={{ title: t('patient.appointment') }} />
      <Stack.Screen name="prescriptions" options={{ title: t('patient.prescriptions') }} />
      <Stack.Screen name="documents" options={{ title: t('patient.reports') }} />
      <Stack.Screen name="invoices" options={{ title: t('patient.invoices') }} />
      <Stack.Screen name="packages" options={{ title: t('patient.packages') }} />
      <Stack.Screen name="family" options={{ title: t('patient.family') }} />
      <Stack.Screen name="review/[id]" options={{ title: t('review.title') }} />
      <Stack.Screen name="notifications" options={{ title: t('patient.notifications') }} />
      <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
      <Stack.Screen name="payment-result" options={{ title: t('payment.resultTitle') }} />
    </Stack>
  );
}
