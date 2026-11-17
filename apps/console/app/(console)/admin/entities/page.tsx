'use client';

import { useState } from 'react';
import { Alert, Badge, Button, PageHeader, Table } from '@hf/ui';
import { Dialog } from '@/components/dialog';
import { DataState, Section, SelectField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post, put } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Entity {
  id: string;
  name_ar: string;
  name_en: string;
  tax_registration_number: string | null;
  commercial_register: string | null;
  address: string | null;
  healthpay_mode: string | null;
  healthpay_configured: boolean;
  eta_mode: 'preprod' | 'prod' | null;
  eta_configured: boolean;
}

/** D3 legal entities with tax IDs, and HealthPay merchant configuration (credentials are write-only, FR-HP-1). */
export default function EntitiesPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<Entity[]>('/legal-entities');
  const [f, setF] = useState({ nameAr: '', nameEn: '', taxRegistrationNumber: '', commercialRegister: '', address: '' });
  const [hp, setHp] = useState<Entity | null>(null);
  const [eta, setEta] = useState<Entity | null>(null);
  const a = useAction();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.entities')} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Section title={t('nav.entities')} className="xl:col-span-2">
          <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('cat.name')}</th>
                    <th>{t('ent.tax')}</th>
                    <th>{t('ent.cr')}</th>
                    <th>{t('ent.healthpay')}</th>
                    <th>{t('ent.eta')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td>{e.name_ar}</td>
                      <td className="num">{e.tax_registration_number ?? '—'}</td>
                      <td className="num">{e.commercial_register ?? '—'}</td>
                      <td>{e.healthpay_configured ? <Badge tone="success">{t(`ent.mode.${e.healthpay_mode ?? 'sandbox'}`)}</Badge> : <Badge tone="warning">{t('ent.notConfigured')}</Badge>}</td>
                      <td>{e.eta_configured ? <Badge tone={e.eta_mode === 'prod' ? 'success' : 'warning'}>{t(`etaCfg.mode.${e.eta_mode ?? 'preprod'}`)}</Badge> : <Badge tone="warning">{t('ent.notConfigured')}</Badge>}</td>
                      <td>
                        {can('settings:edit') && (
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setHp(e)}>
                              {t('ent.configure')}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEta(e)}>
                              {t('etaCfg.configure')}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </DataState>
        </Section>
        {can('settings:edit') && (
          <Section title={t('ent.new')}>
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await a.run(() => post('/legal-entities', { nameAr: f.nameAr, nameEn: f.nameEn, taxRegistrationNumber: f.taxRegistrationNumber || undefined, commercialRegister: f.commercialRegister || undefined, address: f.address || undefined }));
                if (r) {
                  toast(t('common.saved'));
                  q.reload();
                }
              }}
            >
              <TextField label={t('cat.nameAr')} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} required dir="rtl" />
              <TextField label={t('cat.nameEn')} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} dir="ltr" />
              <TextField label={t('ent.tax')} value={f.taxRegistrationNumber} onChange={(e) => setF({ ...f, taxRegistrationNumber: e.target.value })} pattern="[\d-]{9,15}" dir="ltr" />
              <TextField label={t('ent.cr')} value={f.commercialRegister} onChange={(e) => setF({ ...f, commercialRegister: e.target.value })} dir="ltr" />
              <TextField label={t('pat.address')} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
              {a.error && <Alert tone="danger">{a.error}</Alert>}
              <Button type="submit" disabled={a.busy}>
                {t('common.save')}
              </Button>
            </form>
          </Section>
        )}
      </div>
      <HealthPayDialog entity={hp} onClose={() => setHp(null)} onDone={q.reload} />
      <EtaDialog entity={eta} onClose={() => setEta(null)} />
    </div>
  );
}

function HealthPayDialog({ entity, onClose, onDone }: { entity: Entity | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ merchantId: '', apiKey: '', mode: 'sandbox' });
  const a = useAction();
  return (
    <Dialog open={!!entity} onClose={onClose} title={t('ent.healthpay')}>
      <form
        className="flex flex-col gap-3"
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!entity) return;
          const r = await a.run(() => put(`/legal-entities/${entity.id}/healthpay`, f));
          if (r) {
            toast(t('ent.saved'));
            setF({ merchantId: '', apiKey: '', mode: f.mode });
            onDone();
            onClose();
          }
        }}
      >
        <Alert tone="info">{t('ent.secretNote')}</Alert>
        <TextField label={t('ent.merchantId')} value={f.merchantId} onChange={(e) => setF({ ...f, merchantId: e.target.value })} required dir="ltr" />
        <TextField label={t('ent.apiKey')} type="password" autoComplete="new-password" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} required minLength={8} dir="ltr" />
        <SelectField label={t('ent.modeLabel')} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} options={['sandbox', 'live'].map((m) => ({ value: m, label: t(`ent.mode.${m}`) }))} />
        <p className="text-xs text-muted">{t('ent.testGap')}</p>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy}>
          {t('common.save')}
        </Button>
      </form>
    </Dialog>
  );
}

const ETA_BLANK = {
  mode: 'preprod',
  clientId: '',
  clientSecret: '',
  posSerial: '',
  posOsVersion: 'linux',
  presharedKey: '',
  rin: '',
  branchCode: '0',
  activityCode: '',
  companyTradeName: '',
  governate: '',
  regionCity: '',
  street: '',
  buildingNumber: '',
};

/** ETA e-receipt (B2C) POS credentials per legal entity. Secrets are write-only: the API stores them encrypted and never returns them. */
function EtaDialog({ entity, onClose }: { entity: Entity | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ ...ETA_BLANK });
  const a = useAction();
  const set = (k: keyof typeof ETA_BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={!!entity} onClose={onClose} title={`${t('etaCfg.title')}${entity ? ` · ${entity.name_ar}` : ''}`} wide>
      <form
        className="flex flex-col gap-3"
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!entity) return;
          const { governate, regionCity, street, buildingNumber, ...rest } = f;
          const r = await a.run(() => put(`/legal-entities/${entity.id}/eta`, { ...rest, address: { governate, regionCity, street, buildingNumber } }));
          if (r) {
            toast(t('etaCfg.saved'));
            setF({ ...ETA_BLANK, mode: f.mode });
            onClose();
          }
        }}
      >
        <Alert tone="info">{t('etaCfg.secretNote')}</Alert>
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField label={t('etaCfg.mode')} value={f.mode} onChange={set('mode')} options={['preprod', 'prod'].map((m) => ({ value: m, label: t(`etaCfg.mode.${m}`) }))} />
          <TextField label={t('etaCfg.tradeName')} value={f.companyTradeName} onChange={set('companyTradeName')} required minLength={2} />
          <TextField label={t('etaCfg.clientId')} value={f.clientId} onChange={set('clientId')} required minLength={4} dir="ltr" />
          <TextField label={t('etaCfg.clientSecret')} type="password" autoComplete="new-password" value={f.clientSecret} onChange={set('clientSecret')} required minLength={4} dir="ltr" />
          <TextField label={t('etaCfg.posSerial')} value={f.posSerial} onChange={set('posSerial')} required dir="ltr" />
          <TextField label={t('etaCfg.posOs')} value={f.posOsVersion} onChange={set('posOsVersion')} dir="ltr" />
          <TextField label={t('etaCfg.presharedKey')} type="password" autoComplete="new-password" value={f.presharedKey} onChange={set('presharedKey')} dir="ltr" />
          <TextField label={t('etaCfg.rin')} hint={t('etaCfg.rinHint')} value={f.rin} onChange={set('rin')} required pattern="\d{9}" inputMode="numeric" dir="ltr" />
          <TextField label={t('etaCfg.branchCode')} value={f.branchCode} onChange={set('branchCode')} dir="ltr" />
          <TextField label={t('etaCfg.activityCode')} hint={t('etaCfg.activityHint')} value={f.activityCode} onChange={set('activityCode')} required pattern="\d{4}" inputMode="numeric" dir="ltr" />
        </div>
        <fieldset className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-2">
          <legend className="px-1 text-sm font-medium">{t('etaCfg.address')}</legend>
          <TextField label={t('etaCfg.governate')} value={f.governate} onChange={set('governate')} required />
          <TextField label={t('etaCfg.regionCity')} value={f.regionCity} onChange={set('regionCity')} required />
          <TextField label={t('etaCfg.street')} value={f.street} onChange={set('street')} required />
          <TextField label={t('etaCfg.building')} value={f.buildingNumber} onChange={set('buildingNumber')} required dir="ltr" />
        </fieldset>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy}>
          {t('common.save')}
        </Button>
      </form>
    </Dialog>
  );
}
