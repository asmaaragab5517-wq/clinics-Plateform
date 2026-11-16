import { useState } from 'react';
import { router } from 'expo-router';
import { normalisePhone } from '@hf/shared';
import { ActionButton, Button, ErrorBox, Field, H1, Muted, Screen } from '../components/ui';
import { LanguageToggle } from '../components/LanguageToggle';
import { authApi } from '../lib/endpoints';
import { useI18n } from '../lib/i18n';
import { useAction } from '../lib/useQuery';
import { useSession } from '../lib/session';

/** FR-APP-1 OTP sign-in, step 1: phone number (accepts Arabic-Indic digits, normalised to E.164 — FR-COM-6, LOC-4). */
export default function SignIn() {
  const { t } = useI18n();
  const { hasPatient, staffSignedIn } = useSession();
  const [raw, setRaw] = useState('');
  const [invalid, setInvalid] = useState(false);
  const { busy, error, run } = useAction();

  const submit = async () => {
    const phone = normalisePhone(raw);
    setInvalid(!phone);
    if (!phone) return;
    const r = await run(() => authApi.requestOtp(phone));
    if (r) router.push({ pathname: '/otp', params: { phone, resend: String(r.resendAfterSeconds), ...(__DEV__ && r.devCode ? { dev: r.devCode } : {}) } });
  };

  return (
    <Screen>
      <H1>{t('app.name')}</H1>
      <Muted style={{ marginBottom: 20 }}>{t('auth.patientIntro')}</Muted>
      <Field
        label={t('auth.phone')}
        value={raw}
        onChangeText={setRaw}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        placeholder="01XXXXXXXXX"
        ltr
        error={invalid ? t('error.invalid_phone') : null}
        onSubmitEditing={() => void submit()}
      />
      <ErrorBox error={error} />
      <ActionButton title={t('auth.sendCode')} onPress={() => void submit()} loading={busy} disabled={!raw.trim()} />
      <Button kind="secondary" title={t('auth.staffLogin')} onPress={() => router.push('/staff-sign-in')} />
      {hasPatient || staffSignedIn ? <Button kind="ghost" title={t('mode.title')} onPress={() => router.replace('/mode')} /> : null}
      <LanguageToggle />
    </Screen>
  );
}
