'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Bdi, Button, Card, EmptyState, Field, Select, Spinner, Textarea } from '@hf/ui';
import { bff, errorText } from '@/lib/bff';
import { dateOnly, dateTime, pick } from '@/lib/format';
import { has, t, tDyn } from '@/lib/i18n';
import type { ConsentState, ConsentVersion, PortalMessage, Preferences } from '@/lib/types';
import { PatientForm } from './PatientForm';
import { NoPatients, PatientSelect, PortalPage, usePatientName, usePortal } from './PortalShell';
import { patientName, useBffData } from './hooks';

const label = (key: string, fallback: string) => (has(key) ? key : fallback);

export function FamilyView() {
  const { locale, me, reload } = usePortal();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <PortalPage
      title={t(locale, 'family.title')}
      actions={
        !adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            {t(locale, 'family.add')}
          </Button>
        )
      }
    >
      {notice && (
        <div className="mb-3">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      {adding && (
        <Card className="mb-4">
          <h2 className="mb-3 font-bold">{t(locale, 'booking.newPatient')}</h2>
          <PatientForm
            locale={locale}
            phone={me.account.phone}
            hasSelf={me.patients.some((p) => p.relation === 'self')}
            onCreated={async () => {
              setAdding(false);
              setNotice(t(locale, 'booking.patientAdded'));
              await reload();
            }}
          />
          <button type="button" className="link mt-3 text-sm" onClick={() => setAdding(false)}>
            {t(locale, 'common.cancel')}
          </button>
        </Card>
      )}
      {me.patients.length === 0 ? (
        <EmptyState title={t(locale, 'family.empty')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {me.patients.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-col gap-1">
                <Bdi className="font-bold">{patientName(p, locale)}</Bdi>
                <span className="text-sm text-muted">{tDyn(locale, label(`relation.${p.relation}`, 'relation.other'))}</span>
                <span className="text-sm">
                  {t(locale, 'patient.dob')}: <span className="num">{dateOnly(p.date_of_birth)}</span> · {t(locale, `patient.${p.gender}`)}
                </span>
                <span className="text-xs text-muted">
                  {t(locale, 'patient.mrn')}: <Bdi className="num">{p.mrn}</Bdi>
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PortalPage>
  );
}

const CHANNELS = ['whatsapp', 'sms', 'push', 'email'] as const;

export function NotificationsView() {
  const { locale, me } = usePortal();
  const inbox = useBffData<PortalMessage[]>('/api/portal/notifications', locale);
  const name = usePatientName();
  const [patientId, setPatientId] = useState(me.patients[0]?.id ?? '');
  return (
    <PortalPage title={t(locale, 'portal.nav.notifications')}>
      <Card className="mb-6">
        <h2 className="mb-3 font-bold">{t(locale, 'prefs.title')}</h2>
        {me.patients.length === 0 ? (
          <NoPatients />
        ) : (
          <>
            <PatientSelect id="prefs-patient" value={patientId} onChange={setPatientId} />
            {patientId && <PreferencesForm key={patientId} patientId={patientId} />}
          </>
        )}
      </Card>
      <h2 className="mb-3 text-lg font-bold">{t(locale, 'notifications.inbox')}</h2>
      {inbox.loading && !inbox.data ? (
        <Spinner label={t(locale, 'common.loading')} />
      ) : inbox.error ? (
        <Alert>{errorText(locale, inbox.error)}</Alert>
      ) : !inbox.data?.length ? (
        <EmptyState title={t(locale, 'notifications.empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {inbox.data.map((m) => (
            <li key={m.id}>
              <Card className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span className="flex items-center gap-2">
                    <Badge>{tDyn(locale, label(`channel.${m.channel}`, ''), m.channel)}</Badge>
                    {name(m.patient_id) && <Bdi>{name(m.patient_id)}</Bdi>}
                  </span>
                  <span className="num">{dateTime(m.created_at, locale)}</span>
                </div>
                <p dir="auto" className="whitespace-pre-line text-sm">
                  {m.body}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PortalPage>
  );
}

function PreferencesForm({ patientId }: { patientId: string }) {
  const { locale } = usePortal();
  const { data, loading, error } = useBffData<Preferences>(`/api/portal/preferences/${patientId}`, locale);
  const [form, setForm] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  useEffect(() => {
    if (data) setForm({ channels: data.channels ?? [], marketing_opt_out: !!data.marketing_opt_out, sms_opt_out: !!data.sms_opt_out, whatsapp_opt_out: !!data.whatsapp_opt_out });
  }, [data]);
  if (loading || !form) return error ? <Alert>{errorText(locale, error)}</Alert> : <Spinner label={t(locale, 'common.loading')} />;

  const toggle = (c: string) => setForm({ ...form, channels: form.channels.includes(c) ? form.channels.filter((x) => x !== c) : [...form.channels, c] });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          await bff(`/api/portal/preferences/${patientId}`, { method: 'PATCH', json: { channels: form.channels, marketingOptOut: form.marketing_opt_out, smsOptOut: form.sms_opt_out, whatsappOptOut: form.whatsapp_opt_out } });
          setMsg({ tone: 'success', text: t(locale, 'prefs.saved') });
        } catch (err) {
          setMsg({ tone: 'danger', text: errorText(locale, err) });
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t(locale, 'prefs.channels')}</legend>
        <div className="flex flex-wrap gap-4">
          {CHANNELS.map((c) => (
            <label key={c} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.channels.includes(c)} onChange={() => toggle(c)} />
              {t(locale, `channel.${c}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {(
        [
          ['marketing_opt_out', 'prefs.marketingOptOut'],
          ['sms_opt_out', 'prefs.smsOptOut'],
          ['whatsapp_opt_out', 'prefs.whatsappOptOut'],
        ] as const
      ).map(([k, key]) => (
        <label key={k} className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
          {t(locale, key)}
        </label>
      ))}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Button type="submit" disabled={busy || form.channels.length === 0} className="self-start">
        {t(locale, 'common.save')}
      </Button>
    </form>
  );
}

export function PrivacyView() {
  const { locale, me } = usePortal();
  const [patientId, setPatientId] = useState(me.patients[0]?.id ?? '');
  // Deep link (e.g. from a video visit): ?patient=<id>#consent-telemedicine.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('patient');
    if (p && me.patients.some((x) => x.id === p)) setPatientId(p);
  }, [me.patients]);
  return (
    <PortalPage title={t(locale, 'portal.nav.privacy')}>
      {me.patients.length === 0 ? (
        <NoPatients />
      ) : (
        <>
          <PatientSelect id="privacy-patient" value={patientId} onChange={setPatientId} />
          <ConsentsCard patientId={patientId} />
          <DataRequestCard patientId={patientId} />
        </>
      )}
      <DeleteAccountCard />
    </PortalPage>
  );
}

function ConsentsCard({ patientId }: { patientId: string }) {
  const { locale } = usePortal();
  const { data, loading, error, reload } = useBffData<{ versions: ConsentVersion[]; consents: ConsentState[] }>('/api/portal/consents', locale);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  // The consent list loads after the page, so the browser cannot scroll to #consent-<type> on its own.
  const loaded = !!data;
  useEffect(() => {
    if (!loaded || !window.location.hash.startsWith('#consent-')) return;
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [loaded]);

  async function record(v: ConsentVersion, granted: boolean) {
    setBusy(v.type);
    setMsg(null);
    try {
      await bff('/api/portal/consents', { json: { patientId, type: v.type, granted, versionId: v.id } });
      setMsg({ tone: 'success', text: t(locale, 'consents.saved') });
      await reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: errorText(locale, e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-3 font-bold">{t(locale, 'consents.title')}</h2>
      {loading && !data ? (
        <Spinner label={t(locale, 'common.loading')} />
      ) : error ? (
        <Alert>{errorText(locale, error)}</Alert>
      ) : (
        <ul className="flex flex-col gap-4">
          {(data?.versions ?? []).map((v) => {
            const c = data?.consents.find((x) => x.patient_id === patientId && x.type === v.type);
            const reconsent = !!c?.needsReconsent;
            return (
              <li key={v.id} id={`consent-${v.type}`} className="scroll-mt-4 rounded-xl border border-border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{tDyn(locale, label(`consentType.${v.type}`, ''), v.type)}</h3>
                  {c ? <Badge tone={c.granted ? 'success' : 'neutral'}>{t(locale, c.granted ? 'consents.granted' : 'consents.withdrawn')}</Badge> : <Badge>{t(locale, 'consents.notGiven')}</Badge>}
                </div>
                {has(`consentInfo.${v.type}`) && <p className="mb-2 text-sm">{tDyn(locale, `consentInfo.${v.type}`)}</p>}
                {reconsent && (
                  <div className="mb-2">
                    <Alert tone="warning">{t(locale, 'consents.needsReconsent')}</Alert>
                  </div>
                )}
                <details open={reconsent || !c}>
                  <summary className="cursor-pointer text-sm text-muted">
                    <span className="num">v{v.version}</span> · {dateOnly(v.published_at)}
                  </summary>
                  <p dir="auto" className="mt-2 whitespace-pre-line text-sm">
                    {pick(locale, v.text_ar, v.text_en)}
                  </p>
                </details>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(!c || !c.granted || reconsent) && (
                    <Button size="sm" disabled={busy === v.type} onClick={() => void record(v, true)}>
                      {t(locale, 'consents.accept')}
                    </Button>
                  )}
                  {c?.granted && (
                    <Button size="sm" variant="secondary" disabled={busy === v.type} onClick={() => void record(v, false)}>
                      {t(locale, 'consents.withdraw')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {msg && (
        <div className="mt-3">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
    </Card>
  );
}

const DSR_KINDS = ['export', 'access', 'correction', 'erasure'] as const;

function DataRequestCard({ patientId }: { patientId: string }) {
  const { locale } = usePortal();
  const [kind, setKind] = useState<(typeof DSR_KINDS)[number]>('export');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  return (
    <Card className="mb-6">
      <h2 className="mb-3 font-bold">{t(locale, 'dsr.title')}</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            await bff('/api/portal/data-requests', { json: { patientId, kind, ...(details.trim() ? { details: details.trim() } : {}) } });
            setMsg({ tone: 'success', text: t(locale, 'dsr.submitted') });
            setDetails('');
          } catch (err) {
            setMsg({ tone: 'danger', text: errorText(locale, err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t(locale, 'dsr.kind')} htmlFor="dsr-kind">
          <Select id="dsr-kind" value={kind} onChange={(e) => setKind(e.target.value as (typeof DSR_KINDS)[number])}>
            {DSR_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(locale, `dsr.kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t(locale, 'dsr.details')} (${t(locale, 'site.optional')})`} htmlFor="dsr-details">
          <Textarea id="dsr-details" maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Button type="submit" disabled={busy} className="self-start">
          {t(locale, 'site.submit')}
        </Button>
      </form>
    </Card>
  );
}

function DeleteAccountCard() {
  const { locale } = usePortal();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const word = t(locale, 'account.deleteWord');
  return (
    <Card className="border-danger/40">
      <h2 className="mb-2 font-bold text-danger">{t(locale, 'account.deleteTitle')}</h2>
      <p className="mb-3 text-sm">{t(locale, 'account.deleteWarning')}</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (confirm.trim() !== word) return;
          setBusy(true);
          setError(null);
          try {
            await bff('/api/portal/account/delete', { method: 'POST', json: {} });
            try {
              window.sessionStorage.clear();
            } catch {
              /* ignore */
            }
            window.alert(t(locale, 'account.deleted'));
            window.location.replace(`/${locale}`);
          } catch (err) {
            setError(errorText(locale, err));
            setBusy(false);
          }
        }}
      >
        <Field label={t(locale, 'account.deleteConfirm')} htmlFor="del-confirm">
          <input id="del-confirm" dir="auto" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-10 w-full max-w-xs rounded-xl border border-border bg-surface px-3" />
        </Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" variant="danger" disabled={busy || confirm.trim() !== word} className="self-start">
          {t(locale, 'account.deleteSubmit')}
        </Button>
      </form>
    </Card>
  );
}
