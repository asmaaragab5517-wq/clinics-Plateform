'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { formatLocalPhone } from '@hf/shared';
import { Alert, Bdi, Select, Spinner, cx } from '@hf/ui';
import { bff, errorText } from '@/lib/bff';
import { t, type Key, type Locale } from '@/lib/i18n';
import type { PortalMe } from '@/lib/types';
import { patientName, useBffData } from './hooks';

interface PortalCtx {
  locale: Locale;
  me: PortalMe;
  reload: () => Promise<void>;
}
const Ctx = createContext<PortalCtx | null>(null);

export function usePortal(): PortalCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePortal outside PortalProvider');
  return c;
}

export const PORTAL_NAV: [string, Key][] = [
  ['', 'portal.nav.appointments'],
  ['/prescriptions', 'portal.nav.prescriptions'],
  ['/visits', 'portal.nav.visits'],
  ['/documents', 'portal.nav.documents'],
  ['/invoices', 'portal.nav.invoices'],
  ['/packages', 'portal.nav.packages'],
  ['/family', 'portal.nav.family'],
  ['/notifications', 'portal.nav.notifications'],
  ['/privacy', 'portal.nav.privacy'],
];

/** Loads the account once for every portal page; any 401 goes to sign-in. Data is fetched client-side through the no-store BFF. */
export function PortalProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const { data, error, loading, reload } = useBffData<PortalMe>('/api/portal/me', locale);
  const pathname = usePathname() ?? '';
  const base = `/${locale}/portal`;

  // Keep the account's message language in step with the UI language the patient chose (FR-APP-1 language switch).
  useEffect(() => {
    if (data && data.account.locale !== locale) void bff('/api/portal/me', { method: 'PATCH', json: { locale } }).catch(() => null);
  }, [data, locale]);

  return (
    <div className="container-page grid gap-6 py-8 lg:grid-cols-4">
      <aside className="lg:col-span-1">
        <nav aria-label={t(locale, 'nav.portal')} className="rounded-xl border border-border bg-surface p-2">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {PORTAL_NAV.map(([href, key]) => {
              const active = href ? pathname.startsWith(base + href) : pathname === base;
              return (
                <li key={href} className="shrink-0">
                  <Link href={base + href} aria-current={active ? 'page' : undefined} className={cx('block rounded-lg px-3 py-2 text-sm', active ? 'bg-primary/10 font-bold text-primary' : 'hover:bg-bg')}>
                    {t(locale, key)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {data && (
          <div className="mt-3 flex flex-col gap-2 px-2 text-sm text-muted">
            <span>
              {t(locale, 'portal.signedInAs', { phone: '' })}
              <Bdi className="num">{formatLocalPhone(data.account.phone)}</Bdi>
            </span>
            <SignOutButton locale={locale} />
          </div>
        )}
      </aside>
      <div className="min-w-0 lg:col-span-3">
        {loading && !data ? (
          <Spinner label={t(locale, 'common.loading')} />
        ) : error || !data ? (
          <Alert>{errorText(locale, error)}</Alert>
        ) : (
          <Ctx.Provider value={{ locale, me: data, reload }}>{children}</Ctx.Provider>
        )}
      </div>
    </div>
  );
}

export function SignOutButton({ locale }: { locale: Locale }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="link self-start"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await bff('/api/auth/logout', { method: 'POST' }).catch(() => null);
        try {
          window.sessionStorage.clear();
        } catch {
          /* ignore */
        }
        window.location.replace(`/${locale}`);
      }}
    >
      {t(locale, 'nav.signOut')}
    </button>
  );
}

/** Picks one of the account's patients (self or family) for per-patient settings. */
export function PatientSelect({ value, onChange, id = 'patient-select' }: { value: string; onChange: (id: string) => void; id?: string }) {
  const { locale, me } = usePortal();
  if (me.patients.length <= 1) return null;
  return (
    <div className="mb-4 flex max-w-sm flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {t(locale, 'portal.forPatient')}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {me.patients.map((p) => (
          <option key={p.id} value={p.id}>
            {patientName(p, locale)}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function usePatientName() {
  const { locale, me } = usePortal();
  return (id: string | null | undefined) => {
    const p = me.patients.find((x) => x.id === id);
    return p ? patientName(p, locale) : '';
  };
}

export function PortalPage({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section aria-labelledby="portal-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 id="portal-title" className="text-2xl font-bold">
          {title}
        </h1>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function NoPatients() {
  const { locale } = usePortal();
  return (
    <Alert tone="info">
      {t(locale, 'portal.noPatients')}{' '}
      <Link href={`/${locale}/portal/family`} className="link">
        {t(locale, 'portal.nav.family')}
      </Link>
    </Alert>
  );
}
