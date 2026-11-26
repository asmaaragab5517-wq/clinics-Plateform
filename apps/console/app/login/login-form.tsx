'use client';

import { useState } from 'react';
import { Alert, Bdi, Button, Card, Select } from '@hf/ui';
import { useI18n } from '@/components/i18n';
import { writeCookie } from '@/lib/api';
import { LOCALE_COOKIE } from '@/lib/i18n';

function safeNext(n: string) {
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/api/') ? n : '/';
}

export function LoginForm({ mode, users, next, error, notice }: { mode: 'dev' | 'oidc'; users: string[]; next: string; error: string | null; notice?: string | null }) {
  const { t, locale } = useI18n();
  const [email, setEmail] = useState(users[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(error === 'mfa' ? t('login.mfaMissing') : error ? t('login.failed') : null);
  const enrolled = mode === 'oidc' && notice === 'mfa_enrolled';
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="flex w-full max-w-md flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold text-primary">{t('app.name')}</h1>
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
        <p className="text-sm text-muted">{t('auth.staffLogin')}</p>
        {msg && <Alert tone="danger">{msg}</Alert>}
        {enrolled && <Alert tone="success">{t('login.mfaEnrolled')}</Alert>}
        {mode === 'oidc' ? (
          <a
            className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 text-lg font-medium text-primary-fg"
            href={enrolled ? `/api/auth/login?prompt=login&again=1&returnTo=${encodeURIComponent(safeNext(next))}` : `/api/auth/login?returnTo=${encodeURIComponent(safeNext(next))}`}
          >
            {enrolled ? t('login.mfaAgain') : t('login.sso')}
          </a>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMsg(null);
              try {
                const r = await fetch('/api/auth/dev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
                if (!r.ok) {
                  const j = (await r.json().catch(() => ({}))) as { error?: string };
                  setMsg(j.error === 'api_unreachable' ? t('err.api_unreachable') : j.error === 'dev_auth_disabled' ? t('err.dev_auth_disabled') : t('login.failed'));
                  return;
                }
                try {
                  sessionStorage.removeItem('hf_locked');
                } catch {
                  /* ignore */
                }
                window.location.assign(safeNext(next));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Alert tone="warning">{t('login.devNotice')}</Alert>
            <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="dev-user">
              {t('login.devUser')}
            </label>
            <Select id="dev-user" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr">
              {users.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted">
              <Bdi>{email}</Bdi>
            </p>
            <Button type="submit" size="lg" disabled={busy}>
              {t('login.submit')}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
