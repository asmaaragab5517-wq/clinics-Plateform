import { useState } from 'react';
import { router } from 'expo-router';
import { ActionButton, Banner, Button, ErrorBox, Field, H2, Muted, Screen } from '../components/ui';
import { DEV_STAFF_TOKEN, OIDC_ENABLED } from '../lib/config';
import { useI18n } from '../lib/i18n';
import { signInWithKeycloak } from '../lib/oidc';
import { useSession } from '../lib/session';
import { useAction } from '../lib/useQuery';

/**
 * Staff sign-in. Production: Keycloak (OIDC code + PKCE, lib/oidc.ts). Development: paste a bearer from
 * POST /v1/auth/dev/staff-token (API rejects it in production). The pasted value is stored only in SecureStore.
 */
export default function StaffSignIn() {
  const { t, locale } = useI18n();
  const { signInStaff } = useSession();
  const [token, setToken] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const done = () => router.replace('/mode');

  const keycloak = async () => {
    setNotice(null);
    await run(async () => {
      const r = await signInWithKeycloak({ locale });
      if (!r.ok) {
        if (r.reason !== 'cancelled') setNotice(t(`auth.oidc_${r.reason}`));
        return;
      }
      await signInStaff(r.tokens);
      done();
    });
  };

  const dev = async () => {
    const v = token.trim().replace(/^Bearer\s+/i, '');
    if (!v) return;
    await run(async () => {
      await signInStaff({ accessToken: v, source: 'dev' });
      setToken('');
      done();
    });
  };

  return (
    <Screen>
      <Muted style={{ marginBottom: 16 }}>{t('auth.staffIntro')}</Muted>
      {notice ? <Banner kind="warn">{notice}</Banner> : null}
      <ErrorBox error={error} />
      {OIDC_ENABLED ? <ActionButton title={t('auth.staffKeycloak')} onPress={() => void keycloak()} loading={busy} /> : <Banner kind="info">{t('auth.oidc_not_configured')}</Banner>}
      {DEV_STAFF_TOKEN ? (
        <>
          <H2>{t('auth.devToken')}</H2>
          <Muted style={{ marginBottom: 8 }}>{t('auth.devTokenHint')}</Muted>
          <Field label={t('auth.devTokenLabel')} value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry ltr />
          <ActionButton kind="secondary" title={t('auth.devTokenUse')} onPress={() => void dev()} loading={busy} disabled={!token.trim()} />
        </>
      ) : null}
      <Button kind="ghost" title={t('common.back')} onPress={() => router.back()} />
    </Screen>
  );
}
