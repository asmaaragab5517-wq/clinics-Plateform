import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { Banner, Button, Loading, Screen } from './ui';
import { useI18n } from '../lib/i18n';
import { useSession, type Mode } from '../lib/session';

/**
 * Renders children only when the staff session grants `mode`; otherwise sends the user to the mode switcher.
 * Without `mode` (self-service screens such as My HR) any signed-in staff member passes, with or without a clinic.
 */
export function StaffGuard({ mode, children }: { mode?: Exclude<Mode, 'patient'>; children: ReactNode }) {
  const ses = useSession();
  const { t } = useI18n();
  if (!ses.ready) return <Screen><Loading /></Screen>;
  if (!ses.staffSignedIn) return <Redirect href="/staff-sign-in" />;
  if (!ses.staff)
    return (
      <Screen>
        <Banner kind="warn">{t('offline.staffUnavailable')}</Banner>
        <Button title={t('common.retry')} onPress={() => void ses.reloadStaff()} />
      </Screen>
    );
  if (!mode) return <>{children}</>;
  if (!ses.modes.includes(mode)) return <Redirect href="/mode" />;
  if (!ses.clinicId) return <Redirect href="/mode" />;
  return <>{children}</>;
}
