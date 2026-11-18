import { Stack } from 'expo-router';
import { StaffGuard } from '../../components/StaffGuard';
import { colors } from '../../components/ui';
import { useI18n } from '../../lib/i18n';

/** My HR (staff self-service): reachable from the doctor and reception home screens; any signed-in staff member. */
export default function HrLayout() {
  const { t } = useI18n();
  return (
    <StaffGuard>
      <Stack screenOptions={{ headerTitleAlign: 'center', headerBackButtonDisplayMode: 'minimal', headerTintColor: colors.primary, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" options={{ title: t('hr.title') }} />
        <Stack.Screen name="month" options={{ title: t('hr.month.title') }} />
        <Stack.Screen name="leave" options={{ title: t('hr.leave.title') }} />
        <Stack.Screen name="leave-request" options={{ title: t('hr.leave.requestTitle') }} />
        <Stack.Screen name="permission-request" options={{ title: t('hr.permission.requestTitle') }} />
        <Stack.Screen name="payslips" options={{ title: t('hr.payslips.title') }} />
        <Stack.Screen name="payslip/[id]" options={{ title: t('hr.payslips.detailTitle') }} />
      </Stack>
    </StaffGuard>
  );
}
