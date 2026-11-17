'use client';

import { useState } from 'react';
import { formatMoney } from '@hf/shared';
import { Alert, Badge, Bdi, Button, PageHeader, Table } from '@hf/ui';
import { DataState, Section, SelectField, TextField, useAction } from '@/components/common';
import { Dialog } from '@/components/dialog';
import { useI18n } from '@/components/i18n';
import { useToast } from '@/components/toast';
import { pPatch, pPost } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName, isoDate, num } from '@/lib/format';
import type { PlatformOrg, PlatformPlan } from '@/lib/platform-types';

const PLANS = ['starter', 'network', 'enterprise'] as const;
const SUB_STATUSES = ['trial', 'active', 'past_due', 'cancelled'] as const;

function bytes(v: number | string): string {
  const n = num(v);
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** FR-ADM-1 organisations: plan, subscription, usage, onboarding, suspension and plan changes. */
export default function OrganisationsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const q = useApi<PlatformOrg[]>('/organisations', true);
  const plans = useApi<PlatformPlan[]>('/plans', true);
  const [edit, setEdit] = useState<PlatformOrg | null>(null);
  const a = useAction();
  const planName = (code: string | null) => {
    const p = plans.data?.find((x) => x.code === code);
    return p ? biName(p, locale) : (code ?? '—');
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('plat.nav.orgs')} />
      <Section title={t('plat.orgs.list')} actions={<Button size="sm" variant="ghost" onClick={q.reload}>{t('common.refresh')}</Button>}>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('plat.orgs.org')}</th>
                  <th>{t('sub.plan')}</th>
                  <th>{t('plat.orgs.subscription')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('plat.orgs.usage')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className="font-medium">{biName(o, locale)}</span>
                      <Bdi className="block font-mono text-xs text-muted">{o.slug}</Bdi>
                    </td>
                    <td>{planName(o.plan_code)}</td>
                    <td>
                      {o.sub_status ? <Badge tone={o.sub_status === 'active' ? 'success' : o.sub_status === 'trial' ? 'primary' : 'danger'}>{t(`sub.status.${o.sub_status}`)}</Badge> : '—'}
                      {o.period_end && <span className="num block text-xs text-muted">{t('plat.orgs.until', { date: isoDate(o.period_end) })}</span>}
                    </td>
                    <td>{o.status === 'active' ? <Badge tone="success">{t('common.active')}</Badge> : <Badge tone="danger">{t(`plat.orgs.status.${o.status}`)}</Badge>}</td>
                    <td className="text-xs">
                      <span className="num block">{t('plat.orgs.usageLine1', { clinics: o.clinics, staff: o.staff, patients: o.patients })}</span>
                      <span className="num block text-muted">{t('plat.orgs.usageLine2', { appts: o.appointments_30d, sms: o.sms_segments_30d, cost: formatMoney(num(o.sms_cost_30d), locale) })}</span>
                      <span className="block text-muted">
                        {t('sub.limit.storage')}: <bdi dir="ltr">{bytes(o.storage_bytes)}</bdi>
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setEdit(o)}>
                          {t('plat.orgs.changePlan')}
                        </Button>
                        <Button
                          size="sm"
                          variant={o.status === 'active' ? 'danger' : 'primary'}
                          disabled={a.busy}
                          onClick={async () => {
                            const next = o.status === 'active' ? 'suspended' : 'active';
                            if (next === 'suspended' && !window.confirm(t('plat.orgs.confirmSuspend', { name: biName(o, locale) }))) return;
                            const r = await a.run(() => pPatch(`/organisations/${o.id}`, { status: next }));
                            if (r) {
                              toast(next === 'active' ? t('plat.orgs.activated') : t('plat.orgs.suspended'));
                              q.reload();
                            }
                          }}
                        >
                          {o.status === 'active' ? t('plat.orgs.suspend') : t('plat.orgs.activate')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      <div className="grid gap-4 xl:grid-cols-3">
        <NewOrg plans={plans.data ?? []} onDone={q.reload} />
        <Section title={t('plat.plans')} className="xl:col-span-2">
          <DataState loading={plans.loading} error={plans.error} data={plans.data} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('sub.plan')}</th>
                    <th>{t('plat.monthly')}</th>
                    <th>{t('sub.limit.clinics')}</th>
                    <th>{t('sub.limit.staff')}</th>
                    <th>{t('plat.smsAllowance')}</th>
                    <th>{t('sub.limit.storage')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.code}>
                      <td>
                        {biName(p, locale)} <Bdi className="font-mono text-xs text-muted">{p.code}</Bdi>
                      </td>
                      <td className="num">{formatMoney(num(p.monthly_price), locale)}</td>
                      <td className="num">{p.limits.clinics ?? '—'}</td>
                      <td className="num">{p.limits.staff ?? '—'}</td>
                      <td className="num">{p.limits.smsPerMonth?.toLocaleString('en') ?? '—'}</td>
                      <td className="num">{p.limits.storageGb ? `${p.limits.storageGb} GB` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </DataState>
        </Section>
      </div>
      <EditOrg org={edit} plans={plans.data ?? []} onClose={() => setEdit(null)} onDone={q.reload} />
    </div>
  );
}

function NewOrg({ plans, onDone }: { plans: PlatformPlan[]; onDone: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const blank = { slug: '', nameAr: '', nameEn: '', plan: 'starter', ownerEmail: '', ownerName: '', trialDays: '30' };
  const [f, setF] = useState(blank);
  const a = useAction();
  return (
    <Section title={t('plat.orgs.new')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await a.run(() => pPost<{ organisationId: string }>('/organisations', { ...f, slug: f.slug.trim().toLowerCase(), ownerEmail: f.ownerEmail.trim(), trialDays: Number(f.trialDays || 0) }));
          if (r) {
            toast(t('plat.orgs.created'));
            setF(blank);
            onDone();
          }
        }}
      >
        <TextField label={t('plat.orgs.slug')} hint={t('plat.orgs.slugHint')} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} required pattern="[a-z0-9\-]{3,40}" dir="ltr" />
        <TextField label={t('cat.nameAr')} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} required minLength={2} dir="rtl" />
        <TextField label={t('cat.nameEn')} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} dir="ltr" />
        <SelectField label={t('sub.plan')} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} options={PLANS.map((p) => ({ value: p, label: biName(plans.find((x) => x.code === p), locale) || p }))} />
        <TextField label={t('plat.orgs.ownerName')} value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} required minLength={2} />
        <TextField label={t('plat.orgs.ownerEmail')} type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} required dir="ltr" hint={t('plat.orgs.ownerHint')} />
        <TextField label={t('plat.orgs.trialDays')} type="number" min={0} max={90} value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} />
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy}>
          {t('plat.orgs.create')}
        </Button>
      </form>
    </Section>
  );
}

function EditOrg({ org, plans, onClose, onDone }: { org: PlatformOrg | null; plans: PlatformPlan[]; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ plan: '', subscriptionStatus: '', periodEnd: '' });
  const [for_, setFor] = useState<string | null>(null);
  const a = useAction();
  if (org && for_ !== org.id) {
    setFor(org.id);
    setF({ plan: org.plan_code ?? 'starter', subscriptionStatus: org.sub_status ?? 'active', periodEnd: org.period_end ? isoDate(org.period_end) : '' });
  }
  return (
    <Dialog open={!!org} onClose={() => (setFor(null), onClose())} title={org ? t('plat.orgs.editTitle', { name: biName(org, locale) }) : ''}>
      {org && (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const body: Record<string, string> = {};
            if (f.plan !== org.plan_code) body.plan = f.plan;
            if (f.subscriptionStatus !== org.sub_status) body.subscriptionStatus = f.subscriptionStatus;
            if (f.periodEnd && f.periodEnd !== (org.period_end ? isoDate(org.period_end) : '')) body.periodEnd = f.periodEnd;
            if (!Object.keys(body).length) return onClose();
            const r = await a.run(() => pPatch(`/organisations/${org.id}`, body));
            if (r) {
              toast(t('common.saved'));
              setFor(null);
              onDone();
              onClose();
            }
          }}
        >
          <SelectField label={t('sub.plan')} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} options={PLANS.map((p) => ({ value: p, label: biName(plans.find((x) => x.code === p), locale) || p }))} />
          <SelectField label={t('plat.orgs.subscription')} value={f.subscriptionStatus} onChange={(e) => setF({ ...f, subscriptionStatus: e.target.value })} options={SUB_STATUSES.map((s) => ({ value: s, label: t(`sub.status.${s}`) }))} />
          <TextField label={t('sub.periodEnd')} type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} />
          <p className="text-xs text-muted">{t('plat.orgs.limitsNote')}</p>
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <Button type="submit" disabled={a.busy}>
            {t('common.save')}
          </Button>
        </form>
      )}
    </Dialog>
  );
}
