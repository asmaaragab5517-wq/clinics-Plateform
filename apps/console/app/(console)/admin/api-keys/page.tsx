'use client';

import { useState } from 'react';
import { Alert, Badge, Bdi, Button, DateText, PageHeader, Table } from '@hf/ui';
import { Check, DataState, Section, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { OneTimeSecret } from '@/components/secret';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post } from '@/lib/api';
import { useApi } from '@/lib/hooks';

/** Mirrors API_SCOPES in the API's platform module. */
const SCOPES = ['catalogue:read', 'availability:read', 'appointments:read', 'reports:read'] as const;

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const scopeKey = (s: string) => `keys.scope.${s.replace(':', '_')}`;

/** FR-INT-3 read-only public API keys: the full key is shown once at creation; only its hash is stored. */
export default function ApiKeysPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<ApiKey[]>('/api-keys');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [f, setF] = useState({ name: '', expiresInDays: '365' });
  const [scopes, setScopes] = useState<string[]>(['catalogue:read', 'availability:read']);
  const a = useAction();
  const now = Date.now();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.apiKeys')} subtitle={t('keys.subtitle')} />
      {created && (
        <OneTimeSecret title={t('keys.keyTitle', { name: created.name })} value={created.key} onDone={() => setCreated(null)}>
          <p className="text-xs text-muted">{t('keys.usage')}</p>
          <code dir="ltr" className="block break-all rounded-lg bg-bg p-2 font-mono text-xs">
            {`curl -H "x-api-key: ${created.key.slice(0, 14)}…" <API_URL>/v1/ext/clinics`}
          </code>
        </OneTimeSecret>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <Section title={t('keys.list')} className="xl:col-span-2">
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('hook.name')}</th>
                    <th>{t('keys.scopes')}</th>
                    <th>{t('keys.lastUsed')}</th>
                    <th>{t('keys.expires')}</th>
                    <th>{t('common.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((k) => {
                    const expired = !!k.expires_at && new Date(k.expires_at).getTime() < now;
                    return (
                      <tr key={k.id}>
                        <td>
                          <span className="font-medium">{k.name}</span>
                          <Bdi className="block font-mono text-xs text-muted">{`${k.prefix}…`}</Bdi>
                        </td>
                        <td className="text-xs">{k.scopes.map((s) => t(scopeKey(s))).join(t('common.listSep'))}</td>
                        <td>{k.last_used_at ? <DateText value={k.last_used_at} locale={locale} withTime /> : '—'}</td>
                        <td>{k.expires_at ? <DateText value={k.expires_at} locale={locale} /> : t('keys.never')}</td>
                        <td>{k.revoked_at ? <Badge tone="danger">{t('keys.revoked')}</Badge> : expired ? <Badge tone="warning">{t('keys.expired')}</Badge> : <Badge tone="success">{t('common.active')}</Badge>}</td>
                        <td>
                          {can('integration:delete') && !k.revoked_at && (
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={a.busy}
                              onClick={async () => {
                                if (!window.confirm(t('keys.confirmRevoke', { name: k.name }))) return;
                                const r = await a.run(() => post(`/api-keys/${k.id}/revoke`));
                                if (r) {
                                  toast(t('keys.revokedOk'));
                                  q.reload();
                                }
                              }}
                            >
                              {t('keys.revoke')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </DataState>
          <p className="mt-2 text-xs text-muted">{t('keys.privacy')}</p>
        </Section>
        {can('integration:create') && (
          <Section title={t('keys.new')}>
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!scopes.length) return a.setError(t('keys.pickScope'));
                const days = f.expiresInDays ? Number(f.expiresInDays) : undefined;
                const r = await a.run(() => post<{ id: string; key: string }>('/api-keys', { name: f.name.trim(), scopes, expiresInDays: days }));
                if (r) {
                  setCreated({ name: f.name.trim(), key: r.key });
                  setF({ name: '', expiresInDays: '365' });
                  q.reload();
                }
              }}
            >
              <TextField label={t('hook.name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={80} />
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">{t('keys.scopes')}</legend>
                {SCOPES.map((s) => (
                  <Check key={s} label={t(scopeKey(s))} hint={s} checked={scopes.includes(s)} onChange={(x) => setScopes(x ? [...scopes, s] : scopes.filter((y) => y !== s))} />
                ))}
              </fieldset>
              <TextField label={t('keys.expiresInDays')} type="number" min={1} max={730} value={f.expiresInDays} onChange={(e) => setF({ ...f, expiresInDays: e.target.value })} hint={t('keys.expiresHint')} />
              <Button type="submit" disabled={a.busy}>
                {t('keys.create')}
              </Button>
            </form>
          </Section>
        )}
      </div>
    </div>
  );
}
