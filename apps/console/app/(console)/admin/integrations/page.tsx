'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Bdi, Button, DateText, PageHeader, Table } from '@hf/ui';
import { Check, DataState, Section, TextField, useAction } from '@/components/common';
import { Dialog } from '@/components/dialog';
import { useI18n } from '@/components/i18n';
import { OneTimeSecret } from '@/components/secret';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { del, patch, post } from '@/lib/api';
import { useApi } from '@/lib/hooks';

/** Mirrors OUTBOUND_EVENTS in the API's events module. */
const EVENTS = ['complaint.created', 'complaint.resolved', 'rating.low', 'incident.reported', 'incident.closed', 'ping'] as const;

interface Endpoint {
  id: string;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  queued: number;
  failed: number;
}

interface Delivery {
  id: string;
  event: string;
  status: 'queued' | 'delivered' | 'failed';
  attempts: number;
  last_status: number | null;
  delivered_at: string | null;
  created_at: string;
}

const evKey = (e: string) => `hook.ev.${e.replace('.', '_')}`;

/** FR-INT-1 outbound webhooks (e.g. ITQAN): pseudonymised events signed with a per-endpoint secret shown once. */
export default function IntegrationsPage() {
  const { t, locale } = useI18n();
  const { can, hasRole } = useSession();
  const toast = useToast();
  const q = useApi<Endpoint[]>('/webhooks');
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [deliveries, setDeliveries] = useState<Endpoint | null>(null);
  const [editing, setEditing] = useState<Endpoint | null>(null);
  const a = useAction();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('nav.integrations')}
        subtitle={t('hook.subtitle')}
        actions={
          can('integration:view') && (
            <Link href="/admin/api-keys" className="inline-flex h-10 items-center rounded-xl border border-border px-4 hover:bg-bg">
              {t('nav.apiKeys')}
            </Link>
          )
        }
      />
      {hasRole('doctor') && (
        <Alert tone="info">
          {t('hook.googleOnProfile')}{' '}
          <Link className="underline" href="/profile">
            {t('nav.profile')}
          </Link>
        </Alert>
      )}
      {secret && (
        <OneTimeSecret title={t('hook.secretTitle', { name: secret.name })} value={secret.value} onDone={() => setSecret(null)}>
          <p className="text-xs text-muted">{t('hook.verifyHint')}</p>
          <code dir="ltr" className="block rounded-lg bg-bg p-2 font-mono text-xs">
            {'x-healthflow-signature: t=<unix>,v1=hex(HMAC-SHA256(secret, `${t}.${body}`))'}
          </code>
        </OneTimeSecret>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <Section title={t('hook.endpoints')} className="xl:col-span-2">
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('hook.name')}</th>
                    <th>{t('hook.events')}</th>
                    <th>{t('hook.queue')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr key={w.id}>
                      <td>
                        <span className="font-medium">{w.name}</span>
                        <Bdi className="block max-w-xs truncate text-xs text-muted">{w.url}</Bdi>
                      </td>
                      <td className="text-xs">{w.events.map((e) => t(evKey(e))).join(t('common.listSep'))}</td>
                      <td className="num text-xs">
                        {t('hook.queued', { n: w.queued })}
                        {w.failed > 0 && <span className="block text-danger">{t('hook.failed', { n: w.failed })}</span>}
                      </td>
                      <td>{w.is_active ? <Badge tone="success">{t('common.active')}</Badge> : <Badge>{t('common.inactive')}</Badge>}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setDeliveries(w)}>
                            {t('hook.deliveries')}
                          </Button>
                          {can('integration:edit') && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={a.busy || !w.is_active}
                                onClick={async () => {
                                  const r = await a.run(() => post(`/webhooks/${w.id}/ping`));
                                  if (r) {
                                    toast(t('hook.pinged'));
                                    q.reload();
                                  }
                                }}
                              >
                                {t('hook.ping')}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditing(w)}>
                                {t('common.edit')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={a.busy}
                                onClick={async () => {
                                  const r = await a.run(() => patch(`/webhooks/${w.id}`, { isActive: !w.is_active }));
                                  if (r) q.reload();
                                }}
                              >
                                {w.is_active ? t('hook.pause') : t('hook.resume')}
                              </Button>
                            </>
                          )}
                          {can('integration:delete') && (
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={a.busy}
                              onClick={async () => {
                                if (!window.confirm(t('hook.confirmDelete', { name: w.name }))) return;
                                const r = await a.run(() => del(`/webhooks/${w.id}`));
                                if (r) {
                                  toast(t('hook.deleted'));
                                  q.reload();
                                }
                              }}
                            >
                              {t('common.delete')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </DataState>
          <p className="mt-2 text-xs text-muted">{t('hook.privacy')}</p>
        </Section>
        {can('integration:create') && <NewEndpoint onCreated={(name, value) => (setSecret({ name, value }), q.reload())} />}
      </div>
      <DeliveriesDialog endpoint={deliveries} onClose={() => setDeliveries(null)} locale={locale} />
      <EditEvents endpoint={editing} onClose={() => setEditing(null)} onDone={q.reload} />
    </div>
  );
}

function EventPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{t('hook.events')}</legend>
      {EVENTS.map((e) => (
        <Check key={e} label={t(evKey(e))} hint={e} checked={value.includes(e)} onChange={(x) => onChange(x ? [...value, e] : value.filter((y) => y !== e))} />
      ))}
    </fieldset>
  );
}

function NewEndpoint({ onCreated }: { onCreated: (name: string, secret: string) => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ name: '', url: 'https://' });
  const [events, setEvents] = useState<string[]>(['complaint.created', 'incident.reported']);
  const a = useAction();
  return (
    <Section title={t('hook.new')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!events.length) return a.setError(t('hook.pickEvent'));
          const r = await a.run(() => post<{ id: string; secret: string }>('/webhooks', { name: f.name.trim(), url: f.url.trim(), events }));
          if (r) {
            onCreated(f.name.trim(), r.secret);
            setF({ name: '', url: 'https://' });
          }
        }}
      >
        <TextField label={t('hook.name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={80} />
        <TextField label={t('hook.url')} type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} required maxLength={500} pattern="https://.+" hint={t('hook.urlHint')} dir="ltr" />
        <EventPicker value={events} onChange={setEvents} />
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy}>
          {t('hook.create')}
        </Button>
      </form>
    </Section>
  );
}

function EditEvents({ endpoint, onClose, onDone }: { endpoint: Endpoint | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [events, setEvents] = useState<string[]>([]);
  const [for_, setFor] = useState<string | null>(null);
  const a = useAction();
  if (endpoint && for_ !== endpoint.id) {
    setFor(endpoint.id);
    setEvents(endpoint.events);
  }
  return (
    <Dialog open={!!endpoint} onClose={() => (setFor(null), onClose())} title={endpoint?.name ?? ''}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!endpoint) return;
          if (!events.length) return a.setError(t('hook.pickEvent'));
          const r = await a.run(() => patch(`/webhooks/${endpoint.id}`, { events }));
          if (r) {
            setFor(null);
            onDone();
            onClose();
          }
        }}
      >
        <EventPicker value={events} onChange={setEvents} />
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy}>
          {t('common.save')}
        </Button>
      </form>
    </Dialog>
  );
}

function DeliveriesDialog({ endpoint, onClose, locale }: { endpoint: Endpoint | null; onClose: () => void; locale: 'ar' | 'en' }) {
  const { t } = useI18n();
  const q = useApi<Delivery[]>(endpoint ? `/webhooks/${endpoint.id}/deliveries` : null);
  return (
    <Dialog open={!!endpoint} onClose={onClose} title={t('hook.deliveriesOf', { name: endpoint?.name ?? '' })} wide>
      <div className="mb-2 flex justify-end">
        <Button size="sm" variant="ghost" onClick={q.reload}>
          {t('common.refresh')}
        </Button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('hook.event')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('hook.attempts')}</th>
                  <th>{t('hook.http')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <DateText value={d.created_at} locale={locale} withTime />
                    </td>
                    <td>
                      <bdi dir="ltr" className="font-mono text-xs">
                        {d.event}
                      </bdi>
                    </td>
                    <td>
                      <Badge tone={d.status === 'delivered' ? 'success' : d.status === 'failed' ? 'danger' : 'neutral'}>{t(`hook.status.${d.status}`)}</Badge>
                    </td>
                    <td className="num">{d.attempts}</td>
                    <td className="num">{d.last_status ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </div>
    </Dialog>
  );
}
