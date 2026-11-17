'use client';

import { useState } from 'react';
import { Alert, Button, Card } from '@hf/ui';
import { TextField } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { ApiError, writeCookie } from '@/lib/api';
import { LOCALE_COOKIE } from '@/lib/i18n';

function safeNext(n: string) {
  return n.startsWith('/platform') && !n.startsWith('//') ? n : '/platform';
}

/** Platform-admin sign-in: Keycloak in production, seeded platform-admin e-mail in development. */
export function PlatformLoginForm({ mode, defaultEmail, next, error }: { mode: 'dev' | 'oidc'; defaultEmail: string; next: string; error: string | null }) {
  const { t, locale, err } = useI18n();
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(error ? t('login.failed') : null);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="flex w-full max-w-md flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold text-primary">{t('plat.title')}</h1>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              writeCookie(LOCALE_COOKIE, locale === 'ar' ? 'en' : 'ar');
              window.location.reload();
            }}
          >
            {t('lang.switch')}
          </Button>
        </div>
        <p className="text-sm text-muted">{t('plat.loginIntro')}</p>
        {msg && <Alert tone="danger">{msg}</Alert>}
        {mode === 'oidc' ? (
          <a className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 text-lg font-medium text-primary-fg" href={`/api/platform/auth/login?returnTo=${encodeURIComponent(safeNext(next))}`}>
            {t('login.sso')}
          </a>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMsg(null);
              try {
                const r = await fetch('/api/platform/auth/dev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
                if (!r.ok) {
                  const j = (await r.json().catch(() => ({}))) as { error?: string };
                  setMsg(err(new ApiError(r.status, j.error ?? 'unknown_admin')));
                  return;
                }
                window.location.assign(safeNext(next));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Alert tone="warning">{t('login.devNotice')}</Alert>
            <TextField label={t('plat.adminEmail')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" autoComplete="username" />
            <Button type="submit" size="lg" disabled={busy}>
              {t('login.submit')}
            </Button>
          </form>
        )}
        <a href="/login" className="text-center text-sm text-muted underline">
          {t('plat.staffLogin')}
        </a>
      </Card>
    </main>
  );
}
