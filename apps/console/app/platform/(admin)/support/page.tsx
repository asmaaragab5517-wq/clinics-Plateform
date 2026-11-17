'use client';

import { useState } from 'react';
import { Alert, Badge, Button, DateText, PageHeader, Table } from '@hf/ui';
import { DataState, Section, SelectField, TextAreaField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { OneTimeSecret } from '@/components/secret';
import { useToast } from '@/components/toast';
import { pPost } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName } from '@/lib/format';
import type { PlatformOrg, PlatformSupportAccess } from '@/lib/platform-types';

const TONE = { requested: 'warning', approved: 'success', rejected: 'danger', revoked: 'neutral', expired: 'neutral' } as const;

/** BR-20 support access: request a window, wait for the owner's approval, then mint a read-only support token. */
export default function PlatformSupportPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const orgs = useApi<PlatformOrg[]>('/organisations', true);
  const q = useApi<PlatformSupportAccess[]>('/support-access', true);
  const [f, setF] = useState({ orgId: '', reason: '', hours: '4' });
  const [token, setToken] = useState<{ token: string; organisationId: string; expiresAt: string } | null>(null);
  const a = useAction();
  const orgName = (id: string) => {
    const o = orgs.data?.find((x) => x.id === id);
    return o ? biName(o, locale) : id.slice(0, 8);
  };
  const now = Date.now();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('plat.nav.support')} />
      <Alert tone="info">{t('plat.sup.explain')}</Alert>
      {token && (
        <OneTimeSecret title={t('plat.sup.tokenTitle', { org: orgName(token.organisationId) })} value={token.token} onDone={() => setToken(null)}>
          <p className="text-sm">
            {t('plat.sup.expires')}: <DateText value={token.expiresAt} locale={locale} withTime />
          </p>
          <p className="text-xs text-muted">{t('plat.sup.howTo')}</p>
          <code dir="ltr" className="block break-all rounded-lg bg-bg p-2 font-mono text-xs">
            {'curl -H "Authorization: Bearer <token>" "<API_URL>/v1/appointments?from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z"'}
          </code>
          <ul className="list-inside list-disc text-xs text-muted">
            <li>{t('plat.sup.rule1')}</li>
            <li>{t('plat.sup.rule2')}</li>
            <li>{t('plat.sup.rule3')}</li>
          </ul>
        </OneTimeSecret>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <Section title={t('plat.sup.list')} className="xl:col-span-2" actions={<Button size="sm" variant="ghost" onClick={q.reload}>{t('common.refresh')}</Button>}>
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('plat.orgs.org')}</th>
                    <th>{t('support.reason')}</th>
                    <th>{t('support.duration')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('support.window')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => {
                    const live = x.status === 'approved' && !!x.ends_at && new Date(x.ends_at).getTime() > now;
                    const status = x.status === 'approved' && !live ? 'expired' : x.status;
                    return (
                      <tr key={x.id}>
                        <td>
                          {orgName(x.organisation_id)}
                          <span className="block text-xs text-muted">
                            <DateText value={x.created_at} locale={locale} withTime />
                          </span>
                        </td>
                        <td className="max-w-sm" dir="auto">
                          {x.reason}
                        </td>
                        <td className="num">{t('support.hours', { n: x.hours })}</td>
                        <td>
                          <Badge tone={TONE[status]}>{t(`support.status.${status}`)}</Badge>
                        </td>
                        <td className="text-xs">{x.ends_at ? <DateText value={x.ends_at} locale={locale} withTime /> : '—'}</td>
                        <td>
                          {live && (
                            <Button
                              size="sm"
                              disabled={a.busy}
                              onClick={async () => {
                                const r = await a.run(() => pPost<{ token: string; organisationId: string; expiresAt: string }>(`/support-access/${x.id}/token`));
                                if (r) setToken(r);
                              }}
                            >
                              {t('plat.sup.getToken')}
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
        </Section>
        <Section title={t('plat.sup.request')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await a.run(() => pPost(`/organisations/${f.orgId}/support-access`, { reason: f.reason.trim(), hours: Number(f.hours) }));
              if (r) {
                toast(t('plat.sup.requested'));
                setF({ orgId: '', reason: '', hours: '4' });
                q.reload();
              }
            }}
          >
            <SelectField label={t('plat.orgs.org')} value={f.orgId} required placeholder={t('form.choose')} onChange={(e) => setF({ ...f, orgId: e.target.value })} options={(orgs.data ?? []).map((o) => ({ value: o.id, label: biName(o, locale) }))} />
            <TextAreaField label={t('support.reason')} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={10} maxLength={500} rows={3} dir="auto" hint={t('plat.sup.reasonHint')} />
            <TextField label={t('plat.sup.hours')} type="number" min={1} max={72} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} required />
            <Button type="submit" disabled={a.busy}>
              {t('plat.sup.send')}
            </Button>
          </form>
        </Section>
      </div>
    </div>
  );
}
