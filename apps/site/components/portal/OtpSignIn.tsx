'use client';

import { useEffect, useRef, useState } from 'react';
import { formatLocalPhone, normalisePhone } from '@hf/shared/egypt/phone';
import { Alert, Bdi, Button, Field, Input } from '@hf/ui';
import { bff, errorText } from '@/lib/bff';
import { t, type Locale } from '@/lib/i18n';
import { useNow } from './hooks';

interface OtpRequestResult {
  sent: boolean;
  phone: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  devCode?: string;
}

/** OTP sign-in (IAM-4): phone → 6-digit code, 60 s resend countdown. Tokens are set as httpOnly cookies by the BFF. */
export function OtpSignIn({ locale, onSignedIn }: { locale: Locale; onSignedIn: () => void }) {
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const now = useNow();
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (sentTo) codeRef.current?.focus();
  }, [sentTo]);

  async function request(target: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await bff<OtpRequestResult>('/api/auth/otp/request', { json: { phone: target } });
      setSentTo(r.phone);
      setResendAt(Date.now() + (r.resendAfterSeconds ?? 60) * 1000);
      setDevCode(r.devCode ?? null);
    } catch (e) {
      setError(errorText(locale, e));
    } finally {
      setBusy(false);
    }
  }

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    const p = normalisePhone(phone);
    if (!p) return setError(t(locale, 'error.invalid_phone'));
    await request(p);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    try {
      await bff('/api/auth/otp/verify', { json: { phone: sentTo, code } });
      onSignedIn();
    } catch (err) {
      setError(errorText(locale, err));
      setCode('');
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (!sentTo) {
    return (
      <form onSubmit={submitPhone} className="flex flex-col gap-3" noValidate>
        <Field label={t(locale, 'auth.phone')} htmlFor="otp-phone" hint={t(locale, 'auth.phoneHint')} error={error}>
          <Input
            id="otp-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            className="num text-start"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={!!error}
          />
        </Field>
        <Button type="submit" disabled={busy || !phone.trim()}>
          {busy ? t(locale, 'common.loading') : t(locale, 'auth.sendCode')}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitCode} className="flex flex-col gap-3" noValidate>
      <p className="text-sm">
        {t(locale, 'auth.codeSent', { phone: '' })}
        <Bdi className="num font-medium">{formatLocalPhone(sentTo)}</Bdi>
      </p>
      {devCode && <Alert tone="info">{t(locale, 'auth.devCode', { code: devCode })}</Alert>}
      <Field label={t(locale, 'auth.code')} htmlFor="otp-code" error={error}>
        <Input
          ref={codeRef}
          id="otp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          dir="ltr"
          className="num text-center text-lg tracking-widest"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d\u0660-\u0669]/g, ''))}
          aria-invalid={!!error}
        />
      </Field>
      <Button type="submit" disabled={busy || code.length !== 6}>
        {busy ? t(locale, 'common.loading') : t(locale, 'auth.verify')}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" className="link" onClick={() => { setSentTo(null); setCode(''); setError(null); setDevCode(null); }}>
          {t(locale, 'auth.changePhone')}
        </button>
        {wait > 0 ? (
          <span className="text-muted" aria-live="polite">
            {t(locale, 'auth.resendIn', { seconds: wait })}
          </span>
        ) : (
          <button type="button" className="link" disabled={busy} onClick={() => void request(sentTo)}>
            {t(locale, 'auth.resend')}
          </button>
        )}
      </div>
    </form>
  );
}
