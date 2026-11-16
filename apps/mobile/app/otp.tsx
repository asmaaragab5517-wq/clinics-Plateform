import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { toWesternDigits } from '@hf/shared';
import { ActionButton, Button, ErrorBox, Field, Muted, Screen, T } from '../components/ui';
import { deviceId, isApiError } from '../lib/api';
import { authApi, portalApi } from '../lib/endpoints';
import { phone as fmtPhone } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { registerForPush } from '../lib/push';
import { useSession } from '../lib/session';
import { useAction } from '../lib/useQuery';

/**
 * OTP step 2 (IAM-4): 6 digits, 5-minute validity, 3 attempts, resend after 60 s.
 * Error codes: otp_invalid, otp_expired, otp_attempts_exceeded, otp_rate_limited, otp_resend_too_soon.
 * The code is never logged or persisted (SEC-11).
 */
export default function Otp() {
  const { t, locale } = useI18n();
  const params = useLocalSearchParams<{ phone: string; resend?: string; dev?: string }>();
  const phone = params.phone ?? '';
  const { signInPatient } = useSession();
  const [code, setCode] = useState(__DEV__ ? params.dev ?? '' : '');
  const [left, setLeft] = useState(Number(params.resend ?? 60) || 60);
  const verify = useAction();
  const resend = useAction();

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const submit = async () => {
    const c = toWesternDigits(code).replace(/\D/g, '');
    if (c.length !== 6) return;
    const r = await verify.run(async () => authApi.verifyOtp(phone, c, await deviceId()));
    if (!r) return;
    setCode('');
    await signInPatient({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    // Keep server-side messages (SMS/WhatsApp) in the language the user chose in the app.
    if (r.locale !== locale) void portalApi.setLocale(locale).catch(() => undefined);
    void registerForPush({ prompt: true });
    router.replace('/');
  };

  const again = async () => {
    await resend.run(async () => {
      try {
        const r = await authApi.requestOtp(phone);
        setLeft(r.resendAfterSeconds);
        verify.setError(null);
        setCode('');
      } catch (e) {
        if (isApiError(e, 'otp_resend_too_soon')) setLeft(60);
        throw e;
      }
    });
  };

  const expired = isApiError(verify.error, 'otp_expired') || isApiError(verify.error, 'otp_attempts_exceeded');

  return (
    <Screen>
      <Muted>{t('auth.codeSentTo')}</Muted>
      <T ltr style={{ fontSize: 18, fontWeight: '700', marginBottom: 16 }}>
        {fmtPhone(phone)}
      </T>
      <Field
        label={t('auth.code')}
        value={code}
        onChangeText={(v) => setCode(toWesternDigits(v).replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        ltr
        autoFocus
        onSubmitEditing={() => void submit()}
      />
      <ErrorBox error={verify.error ?? resend.error} />
      <ActionButton title={t('auth.verify')} onPress={() => void submit()} loading={verify.busy} disabled={code.length !== 6 || expired} />
      {left > 0 ? (
        <Muted style={{ textAlign: 'center', marginVertical: 8 }}>{t('auth.resendIn', { seconds: left })}</Muted>
      ) : (
        <ActionButton kind="secondary" title={t('auth.resend')} onPress={() => void again()} loading={resend.busy} />
      )}
      <Button kind="ghost" title={t('auth.changePhone')} onPress={() => router.back()} />
    </Screen>
  );
}
