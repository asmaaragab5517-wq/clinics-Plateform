'use client';

import { Card } from '@hf/ui';
import { t, type Locale } from '@/lib/i18n';
import { OtpSignIn } from './OtpSignIn';

/** Only same-site portal paths are accepted as a post-sign-in destination (no open redirect). */
function safeNext(locale: Locale, next: string | undefined): string {
  return next && /^\/(ar|en)\/portal(\/[\w\-/]*)?(\?[\w=&%-]*)?$/.test(next) && !next.includes('//') && !next.startsWith(`/${locale}/portal/sign-in`) ? next : `/${locale}/portal`;
}

export function SignIn({ locale, next }: { locale: Locale; next?: string }) {
  return (
    <div className="container-page max-w-md py-12">
      <Card className="p-6">
        <h1 className="mb-1 text-2xl font-bold">{t(locale, 'auth.signInTitle')}</h1>
        <p className="mb-6 text-sm text-muted">{t(locale, 'auth.signInSubtitle')}</p>
        <OtpSignIn locale={locale} onSignedIn={() => window.location.replace(safeNext(locale, next))} />
      </Card>
    </div>
  );
}
