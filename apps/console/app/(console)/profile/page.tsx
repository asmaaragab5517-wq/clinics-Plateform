'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Bdi, Button, DateText, PageHeader } from '@hf/ui';
import { Check, DataState, Section, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { del, patch, post } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName } from '@/lib/format';

/** Profile: roles and clinics, and the quick-unlock PIN used after the 30-minute idle lock (IAM-2). */
export default function ProfilePage() {
  const { t, locale } = useI18n();
  const { me, hasRole } = useSession();
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const a = useAction();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.profile')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('prof.me')}>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">{t('staff.name')}</dt>
              <dd>
                <Bdi>{me.name}</Bdi>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{t('staff.roles')}</dt>
              <dd>{me.roles.map((r) => t(`role.${r}`)).join(t('common.listSep'))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{t('staff.clinics')}</dt>
              <dd>{me.network ? t('staff.orgWide') : me.clinics.map((c) => biName(c, locale)).join(t('common.listSep'))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{t('prof.privileges')}</dt>
              <dd className="num">{me.privileges.length}</dd>
            </div>
          </dl>
        </Section>
        <Section title={t('prof.pin')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!/^\d{4,8}$/.test(pin)) return a.setError(t('prof.pinRule'));
              if (pin !== confirm) return a.setError(t('prof.pinMismatch'));
              const r = await a.run(() => post('/auth/pin', { pin }));
              if (r) {
                toast(t('prof.pinSaved'));
                setPin('');
                setConfirm('');
              }
            }}
          >
            <p className="text-sm text-muted">{t('prof.pinHint')}</p>
            <TextField label={t('prof.newPin')} type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} dir="ltr" />
            <TextField label={t('prof.confirmPin')} type="password" inputMode="numeric" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} dir="ltr" />
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy}>
              {t('common.save')}
            </Button>
          </form>
        </Section>
        {hasRole('doctor') && <GoogleConnection />}
      </div>
    </div>
  );
}

interface GoogleStatus {
  connected: boolean;
  account_email?: string | null;
  scopes?: string[];
  settings?: { calendarSync?: boolean; includePatientNames?: boolean };
  created_at?: string;
}

/** FR-INT-2 / FR-TEL-3: one-way Google Calendar sync of the doctor's appointments (no patient names unless enabled). */
function GoogleConnection() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const q = useApi<GoogleStatus>('/integrations/google');
  const [notice, setNotice] = useState<'connected' | 'error' | null>(null);
  const a = useAction();

  // The API's OAuth callback redirects back to /profile?google=connected|error.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('google');
    if (v === 'connected' || v === 'error') {
      setNotice(v);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  return (
    <Section title={t('google.title')}>
      {notice === 'connected' && <Alert tone="success">{t('google.connectedOk')}</Alert>}
      {notice === 'error' && <Alert tone="danger">{t('google.connectError')}</Alert>}
      <DataState loading={q.loading} error={q.error} data={q.data}>
        {(g) => (
          <div className="mt-2 flex flex-col gap-3 text-sm">
            <p className="text-muted">{t('google.intro')}</p>
            {g.connected ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="success">{t('google.connected')}</Badge>
                  {g.account_email && <Bdi>{g.account_email}</Bdi>}
                  {g.created_at && (
                    <span className="text-xs text-muted">
                      <DateText value={g.created_at} locale={locale} />
                    </span>
                  )}
                </div>
                <Check
                  label={t('google.calendarSync')}
                  checked={g.settings?.calendarSync !== false}
                  disabled={a.busy}
                  onChange={async (v) => {
                    const next = { calendarSync: v, includePatientNames: !!g.settings?.includePatientNames };
                    const r = await a.run(() => patch('/integrations/google', next));
                    if (r) q.setData({ ...g, settings: next });
                  }}
                />
                <Check
                  label={t('google.patientNames')}
                  hint={t('google.patientNamesHint')}
                  checked={!!g.settings?.includePatientNames}
                  disabled={a.busy}
                  onChange={async (v) => {
                    const next = { calendarSync: g.settings?.calendarSync !== false, includePatientNames: v };
                    const r = await a.run(() => patch('/integrations/google', next));
                    if (r) q.setData({ ...g, settings: next });
                  }}
                />
                <Button
                  variant="danger"
                  className="self-start"
                  disabled={a.busy}
                  onClick={async () => {
                    if (!window.confirm(t('google.confirmDisconnect'))) return;
                    const r = await a.run(() => del('/integrations/google'));
                    if (r) {
                      toast(t('google.disconnected'));
                      q.reload();
                    }
                  }}
                >
                  {t('google.disconnect')}
                </Button>
              </>
            ) : (
              <Button
                className="self-start"
                disabled={a.busy}
                onClick={async () => {
                  // Open the tab inside the click so pop-up blockers allow it; Google redirects back to this page.
                  const tab = window.open('about:blank', '_blank');
                  const r = await a.run(() => post<{ url: string }>('/integrations/google/connect'));
                  if (!r) return tab?.close();
                  if (tab) {
                    tab.opener = null;
                    tab.location.href = r.url;
                  } else window.location.assign(r.url);
                }}
              >
                {t('google.connect')}
              </Button>
            )}
            {a.error && <Alert tone="danger">{a.error}</Alert>}
          </div>
        )}
      </DataState>
    </Section>
  );
}
