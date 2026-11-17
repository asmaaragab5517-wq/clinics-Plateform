'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toWesternDigits } from '@hf/shared';
import { Alert, Bdi, Button, Input, OnlineIndicator, Select, cx } from '@hf/ui';
import { Dialog } from './dialog';
import { ApiError, get, logout, markActivity, msSinceActivity, post, readCookie, writeCookie } from '@/lib/api';
import { CLINIC_COOKIE, LOCALE_COOKIE } from '@/lib/i18n';
import { NAV, allowed } from '@/lib/nav';
import { dismissNotice, expireStale, getServerSnapshot, getSnapshot, replay, subscribe } from '@/lib/offline';
import { useOnline } from '@/lib/hooks';
import { biName } from '@/lib/format';
import type { Me } from '@/lib/types';
import { KeyHint, Loading } from './common';
import { useI18n } from './i18n';
import { SessionCtx, ShortcutCtx, type ShortcutMap, type SessionValue } from './session';
import { ToastProvider } from './toast';

const IDLE_MS = 30 * 60 * 1000;
const LOCK_KEY = 'hf_locked';

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { t, locale, err } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [clinicId, setClinic] = useState('');
  const [locked, setLocked] = useState(false);
  const [help, setHelp] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const online = useOnline();
  const offline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Identity, privileges and clinics.
  useEffect(() => {
    get<Me>('/auth/me')
      .then((m) => {
        setMe(m);
        const fromCookie = readCookie(CLINIC_COOKIE);
        const memberClinic = m.memberships.find((x) => x.clinicId)?.clinicId;
        const pick = m.clinics.find((c) => c.id === fromCookie)?.id ?? m.clinics.find((c) => c.id === memberClinic)?.id ?? m.clinics[0]?.id ?? '';
        setClinic(pick);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'session_locked') {
          setLocked(true);
          return;
        }
        setLoadError(e);
      });
    try {
      if (sessionStorage.getItem(LOCK_KEY) === '1') setLocked(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onUnauthorized = () => window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    const onLocked = () => setLocked(true);
    window.addEventListener('hf:unauthorized', onUnauthorized);
    window.addEventListener('hf:locked', onLocked);
    return () => {
      window.removeEventListener('hf:unauthorized', onUnauthorized);
      window.removeEventListener('hf:locked', onLocked);
    };
  }, []);

  // Idle detection (IAM-2) and keep-alive while the user is active.
  useEffect(() => {
    let last = 0;
    const mark = () => {
      const now = Date.now();
      if (now - last > 1000) {
        last = now;
        markActivity();
      }
    };
    const events = ['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, mark, { passive: true });
    const check = setInterval(() => {
      if (msSinceActivity() >= IDLE_MS) setLocked(true);
    }, 15_000);
    const beat = setInterval(() => {
      if (msSinceActivity() < 4 * 60_000) get('/auth/me').catch(() => undefined);
    }, 4 * 60_000);
    return () => {
      for (const e of events) window.removeEventListener(e, mark);
      clearInterval(check);
      clearInterval(beat);
    };
  }, []);

  useEffect(() => {
    try {
      if (locked) sessionStorage.setItem(LOCK_KEY, '1');
      else sessionStorage.removeItem(LOCK_KEY);
    } catch {
      /* ignore */
    }
  }, [locked]);

  // NFR-7 replay when back online; expire queued actions older than 5 minutes.
  useEffect(() => {
    if (online && !locked) void replay();
  }, [online, locked]);
  useEffect(() => {
    const id = setInterval(() => {
      expireStale();
      if (navigator.onLine) void replay();
    }, 20_000);
    return () => clearInterval(id);
  }, []);

  // Shortcut registry (NFR-5).
  const stack = useRef<ShortcutMap[]>([]);
  const registry = useMemo(
    () => ({
      register: (map: ShortcutMap) => {
        stack.current.push(map);
        return () => {
          stack.current = stack.current.filter((m) => m !== map);
        };
      },
    }),
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (locked || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(e.target)) {
        if (e.key === 'Escape' && e.target instanceof HTMLElement) e.target.blur();
        return;
      }
      if (document.querySelector('dialog[open]')) return;
      if (e.key === '?') {
        e.preventDefault();
        setHelp(true);
        return;
      }
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      for (let i = stack.current.length - 1; i >= 0; i--) {
        const h = stack.current[i]?.[key];
        if (h) {
          e.preventDefault();
          h();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked]);

  const setClinicId = useCallback(
    (id: string) => {
      setClinic(id);
      writeCookie(CLINIC_COOKIE, id);
    },
    [setClinic],
  );

  const session = useMemo<SessionValue | null>(() => {
    if (!me) return null;
    const privileges = new Set(me.privileges);
    return {
      me,
      privileges,
      can: (...anyOf: string[]) => anyOf.some((p) => privileges.has(p)),
      hasRole: (...roles: string[]) => roles.some((r) => me.roles.includes(r)),
      clinicId,
      clinic: me.clinics.find((c) => c.id === clinicId),
      setClinicId,
    };
  }, [me, clinicId, setClinicId]);

  const toggleLocale = () => {
    writeCookie(LOCALE_COOKIE, locale === 'ar' ? 'en' : 'ar');
    router.refresh();
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <Alert tone="danger">{err(loadError)}</Alert>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => window.location.reload()}>{t('common.retry')}</Button>
          <Button variant="secondary" onClick={() => void logout()}>
            {t('nav.signOut')}
          </Button>
        </div>
      </div>
    );
  }

  if (!session) {
    return locked ? <LockScreen name="" onUnlock={() => window.location.reload()} /> : <Loading className="justify-center p-16" />;
  }

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => allowed(i, session.privileges, me!.roles)) })).filter((g) => g.items.length);

  return (
    <SessionCtx.Provider value={session}>
      <ShortcutCtx.Provider value={registry}>
        <ToastProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
            {t('shell.skip')}
          </a>
          <div className={cx('flex min-h-screen', locked && 'invisible')} inert={locked}>
            <aside
              className={cx(
                'fixed inset-y-0 start-0 z-30 w-56 shrink-0 overflow-y-auto border-e border-border bg-surface p-3 transition-transform lg:static lg:translate-x-0 lg:ltr:translate-x-0 lg:rtl:translate-x-0',
                navOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full',
              )}
              aria-label={t('shell.navigation')}
            >
              <div className="mb-4 flex items-center justify-between px-2">
                <Link href="/" className="font-display text-lg font-bold text-primary">
                  {t('app.name')}
                </Link>
                <button className="lg:hidden" onClick={() => setNavOpen(false)} aria-label={t('common.close')}>
                  ×
                </button>
              </div>
              <nav className="flex flex-col gap-4">
                {groups.map((g) => (
                  <div key={g.label}>
                    <p className="mb-1 px-2 text-xs font-semibold uppercase text-muted">{t(g.label)}</p>
                    <ul className="flex flex-col gap-0.5">
                      {g.items.map((i) => {
                        const active = pathname === i.href || (i.href !== '/cashier' && pathname.startsWith(`${i.href}/`)) || (i.href === '/cashier' && pathname.startsWith('/cashier/bills'));
                        return (
                          <li key={i.href}>
                            <Link
                              href={i.href}
                              onClick={() => setNavOpen(false)}
                              aria-current={active ? 'page' : undefined}
                              className={cx('block rounded-lg px-2 py-1.5 text-sm', active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-bg')}
                            >
                              {t(i.label)}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                <div>
                  <ul className="flex flex-col gap-0.5 border-t border-border pt-2">
                    <li>
                      <Link href="/profile" className={cx('block rounded-lg px-2 py-1.5 text-sm', pathname === '/profile' ? 'bg-primary/10 text-primary' : 'hover:bg-bg')}>
                        {t('nav.profile')}
                      </Link>
                    </li>
                  </ul>
                </div>
              </nav>
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-border bg-surface/95 px-4 py-2 backdrop-blur">
                <button className="rounded-lg border border-border px-2 py-1 lg:hidden" onClick={() => setNavOpen(true)} aria-label={t('shell.menu')}>
                  ≡
                </button>
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted">{t('shell.clinic')}</span>
                  <Select className="h-9 w-56" value={clinicId} onChange={(e) => setClinicId(e.target.value)} aria-label={t('shell.clinic')}>
                    {me!.clinics.map((c) => (
                      <option key={c.id} value={c.id}>
                        {biName(c, locale)}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="ms-auto flex flex-wrap items-center gap-3">
                  <OnlineIndicator online={online} labels={{ online: t('common.online'), offline: t('shell.offline') }} />
                  {offline.pending.length > 0 && (
                    <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning" role="status">
                      {t('offline.pending', { n: offline.pending.length })}
                    </span>
                  )}
                  <button className="text-sm text-muted hover:text-fg" onClick={() => setHelp(true)} aria-label={t('shortcuts.title')}>
                    <KeyHint k="?" />
                  </button>
                  <Button size="sm" variant="ghost" onClick={toggleLocale} lang={locale === 'ar' ? 'en' : 'ar'}>
                    {t('lang.switch')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setLocked(true)}>
                    {t('lock.lockNow')}
                  </Button>
                  <span className="text-sm">
                    <Bdi>{me!.name}</Bdi>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => void logout()}>
                    {t('nav.signOut')}
                  </Button>
                </div>
              </header>
              {!online && (
                <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning" role="status">
                  {t('common.offline')}
                </div>
              )}
              {offline.notices.length > 0 && (
                <div className="flex flex-col gap-1 border-b border-border px-4 py-2">
                  {offline.notices.map((n) => (
                    <div key={n.id} className={cx('flex items-center justify-between gap-2 text-sm', n.kind === 'synced' ? 'text-success' : n.kind === 'expired' ? 'text-warning' : 'text-danger')} role="status">
                      <span>
                        {t(`offline.${n.kind}`, { label: t(n.label) })}
                        {n.code ? ` — ${err(new ApiError(409, n.code))}` : ''}
                      </span>
                      <button className="text-xs underline" onClick={() => dismissNotice(n.id)}>
                        {t('common.dismiss')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <main id="main" className="min-w-0 flex-1 p-4">
                {session.clinic || me!.clinics.length === 0 ? children : <Loading />}
              </main>
            </div>
          </div>
          {locked && <LockScreen name={me!.name} onUnlock={() => setLocked(false)} />}
          <ShortcutHelp open={help} onClose={() => setHelp(false)} />
        </ToastProvider>
      </ShortcutCtx.Provider>
    </SessionCtx.Provider>
  );
}

function LockScreen({ name, onUnlock }: { name: string; onUnlock: () => void }) {
  const { t, err } = useI18n();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/95 p-4" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <form
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-lg"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await post('/auth/pin/verify', { pin: toWesternDigits(pin) });
            markActivity();
            setPin('');
            onUnlock();
          } catch (x) {
            setError(err(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="lock-title" className="font-display text-xl font-bold">
          {t('lock.title')}
        </h2>
        <p className="text-sm text-muted">{t('lock.body')}</p>
        {name && (
          <p className="text-sm">
            <Bdi>{name}</Bdi>
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          {t('lock.pin')}
          <Input ref={ref} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} pattern="[0-9\u0660-\u0669]{4,8}" required dir="ltr" />
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {t('lock.unlock')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void logout()}>
          {t('lock.signInAgain')}
        </Button>
        <p className="text-xs text-muted">{t('lock.noPin')}</p>
      </form>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['/', 'shortcuts.search'],
  ['n', 'shortcuts.newBooking'],
  ['c', 'shortcuts.checkIn'],
  ['p', 'shortcuts.payment'],
  ['w', 'shortcuts.walkIn'],
  ['r', 'shortcuts.register'],
  ['j', 'shortcuts.down'],
  ['k', 'shortcuts.up'],
  ['?', 'shortcuts.help'],
];

function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t('shortcuts.title')}>
      <p className="mb-3 text-sm text-muted">{t('shortcuts.intro')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {SHORTCUTS.map(([k, label]) => (
          <div key={k} className="contents">
            <dt>
              <KeyHint k={k} />
            </dt>
            <dd>{t(label)}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
