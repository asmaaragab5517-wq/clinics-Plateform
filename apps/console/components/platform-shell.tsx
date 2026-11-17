'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { Alert, Bdi, Button, cx } from '@hf/ui';
import { csrfHeaders, pGet, writeCookie } from '@/lib/api';
import { LOCALE_COOKIE } from '@/lib/i18n';
import { Loading } from './common';
import { useI18n } from './i18n';
import { ToastProvider } from './toast';

export interface PlatformAdmin {
  kind: 'platform';
  adminId: string;
  email: string;
}

const AdminCtx = createContext<PlatformAdmin | null>(null);
export const usePlatformAdmin = () => useContext(AdminCtx);

const NAV = [
  { href: '/platform', label: 'plat.nav.orgs' },
  { href: '/platform/invoices', label: 'plat.nav.invoices' },
  { href: '/platform/announcements', label: 'plat.nav.announcements' },
  { href: '/platform/support', label: 'plat.nav.support' },
];

export async function platformLogout() {
  const r = await fetch('/api/platform/auth/logout', { method: 'POST', headers: csrfHeaders() }).catch(() => null);
  const j = r ? ((await r.json().catch(() => ({}))) as { redirect?: string }) : {};
  window.location.assign(j.redirect ?? '/platform/login');
}

/** SaaS super-admin shell (FR-ADM-1): its own session, navigation and sign-out; never shares the staff session. */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const { t, locale, err } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<PlatformAdmin | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    pGet<PlatformAdmin>('/me').then(setMe, setError);
    const onUnauthorized = () => window.location.assign(`/platform/login?next=${encodeURIComponent(window.location.pathname)}`);
    window.addEventListener('hf:platform-unauthorized', onUnauthorized);
    return () => window.removeEventListener('hf:platform-unauthorized', onUnauthorized);
  }, []);

  if (error)
    return (
      <div className="mx-auto max-w-lg p-8">
        <Alert tone="danger">{err(error)}</Alert>
        <Button className="mt-4" variant="secondary" onClick={() => void platformLogout()}>
          {t('nav.signOut')}
        </Button>
      </div>
    );
  if (!me) return <Loading className="justify-center p-16" />;

  return (
    <AdminCtx.Provider value={me}>
      <ToastProvider>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
          {t('shell.skip')}
        </a>
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-border bg-surface/95 px-4 py-2 backdrop-blur">
          <Link href="/platform" className="font-display text-lg font-bold text-primary">
            {t('plat.title')}
          </Link>
          <nav aria-label={t('shell.navigation')} className="flex flex-wrap gap-1">
            {NAV.map((n) => {
              const active = n.href === '/platform' ? pathname === '/platform' : pathname.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={cx('rounded-lg px-3 py-1.5 text-sm', active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-bg')}>
                  {t(n.label)}
                </Link>
              );
            })}
          </nav>
          <div className="ms-auto flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              lang={locale === 'ar' ? 'en' : 'ar'}
              onClick={() => {
                writeCookie(LOCALE_COOKIE, locale === 'ar' ? 'en' : 'ar');
                router.refresh();
              }}
            >
              {t('lang.switch')}
            </Button>
            <span className="text-sm">
              <Bdi>{me.email}</Bdi>
            </span>
            <Button size="sm" variant="secondary" onClick={() => void platformLogout()}>
              {t('nav.signOut')}
            </Button>
          </div>
        </header>
        <div className="border-b border-warning/30 bg-warning/10 px-4 py-1 text-xs text-warning" role="note">
          {t('plat.banner')}
        </div>
        <main id="main" className="min-w-0 p-4">
          {children}
        </main>
      </ToastProvider>
    </AdminCtx.Provider>
  );
}
