'use client';

import { useState } from 'react';
import { SERVICE_TYPES, VAT_STATUSES } from '@hf/shared/enums';
import { Alert, Badge, Bdi, Button, Money, PageHeader, Table, Tabs } from '@hf/ui';
import { Check, DataState, Section, SelectField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { patch, post, qs } from '@/lib/api';
import { useServices } from '@/lib/data';
import { useApi } from '@/lib/hooks';
import { biName, isoDate, num, parseEgp, todayCairo } from '@/lib/format';
import type { DoctorRow, PackageRow, PriceRow, ServiceRow } from '@/lib/types';

type Tab = 'services' | 'prices' | 'packages';

/** FR-ORG-3/4: services, per-clinic price lists with effective dates and doctor overrides, packages. */
export default function CataloguePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('services');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.catalogue')} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'services', label: t('cat.services') },
          { value: 'prices', label: t('cat.prices') },
          { value: 'packages', label: t('cat.packages') },
        ]}
      />
      {tab === 'services' && <Services />}
      {tab === 'prices' && <Prices />}
      {tab === 'packages' && <Packages />}
    </div>
  );
}

const emptyService = { code: '', ar: '', en: '', specialtyId: '', durationMinutes: 15, type: 'consultation', vat: 'exempt', isActive: true };

function Services() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { services, reload, loading, error } = useServices();
  const specialties = useApi<{ id: string; name_ar: string; name_en: string }[]>('/specialties');
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [f, setF] = useState(emptyService);
  const a = useAction();
  const start = (s: ServiceRow | null) => {
    setEditing(s);
    setF(s ? { code: s.code, ar: s.name_ar, en: s.name_en, specialtyId: s.specialty_id ?? '', durationMinutes: s.duration_minutes, type: s.type, vat: s.vat, isActive: s.is_active } : emptyService);
  };
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Section title={t('cat.services')} className="xl:col-span-2" actions={<Button size="sm" variant="secondary" onClick={() => start(null)}>{t('cat.newService')}</Button>}>
        <DataState loading={loading} error={error} data={services} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('cat.code')}</th>
                  <th>{t('cat.name')}</th>
                  <th>{t('cat.type')}</th>
                  <th>{t('cat.duration')}</th>
                  <th>{t('cash.vat')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Bdi className="num">{s.code}</Bdi>
                    </td>
                    <td>{biName(s, locale)}</td>
                    <td>{t(`svcType.${s.type}`)}</td>
                    <td className="num">{s.duration_minutes}</td>
                    <td>{t(`vat.${s.vat}`)}</td>
                    <td>{s.is_active ? <Badge tone="success">{t('common.active')}</Badge> : <Badge>{t('common.inactive')}</Badge>}</td>
                    <td>
                      <Button size="sm" variant="ghost" onClick={() => start(s)}>
                        {t('common.edit')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      <Section title={editing ? t('cat.editService') : t('cat.newService')}>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = { code: f.code.toUpperCase(), name: { ar: f.ar, en: f.en }, specialtyId: f.specialtyId || undefined, durationMinutes: Number(f.durationMinutes), type: f.type, vat: f.vat, isActive: f.isActive };
            const r = await a.run(() => (editing ? patch(`/services/${editing.id}`, body) : post('/services', body)));
            if (r) {
              toast(t('common.saved'));
              start(null);
              reload();
            }
          }}
        >
          <TextField label={t('cat.code')} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} pattern="[A-Za-z0-9_-]{2,30}" required dir="ltr" />
          <TextField label={t('cat.nameAr')} value={f.ar} onChange={(e) => setF({ ...f, ar: e.target.value })} required dir="rtl" />
          <TextField label={t('cat.nameEn')} value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} dir="ltr" />
          <SelectField label={t('cat.specialty')} value={f.specialtyId} placeholder={t('form.none')} onChange={(e) => setF({ ...f, specialtyId: e.target.value })} options={(specialties.data ?? []).map((s) => ({ value: s.id, label: biName(s, locale) }))} />
          <div className="grid grid-cols-3 gap-2">
            <TextField label={t('cat.duration')} type="number" min={5} max={480} value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })} />
            <SelectField label={t('cat.type')} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={SERVICE_TYPES.map((x) => ({ value: x, label: t(`svcType.${x}`) }))} />
            <SelectField label={t('cash.vat')} value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} options={VAT_STATUSES.map((x) => ({ value: x, label: t(`vat.${x}`) }))} />
          </div>
          <Check label={t('common.active')} checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} />
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <Button type="submit" disabled={a.busy}>
            {t('common.save')}
          </Button>
        </form>
      </Section>
    </div>
  );
}

function Prices() {
  const { t, locale } = useI18n();
  const { clinicId } = useSession();
  const toast = useToast();
  const q = useApi<PriceRow[]>(`/prices${qs({ clinicId })}`);
  const { services } = useServices();
  const doctors = useApi<DoctorRow[]>(`/doctors${qs({ clinicId })}`);
  const [f, setF] = useState({ serviceId: '', doctorId: '', price: '', effectiveFrom: todayCairo(), effectiveTo: '' });
  const a = useAction();
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Section title={t('cat.prices')} className="xl:col-span-2">
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('cat.code')}</th>
                  <th>{t('cat.name')}</th>
                  <th>{t('book.doctor')}</th>
                  <th>{t('cat.price')}</th>
                  <th>{t('sch.effective')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Bdi className="num">{p.code}</Bdi>
                    </td>
                    <td>{biName(p, locale)}</td>
                    <td>{p.doctor_id ? <Bdi>{biName(doctors.data?.find((d) => d.id === p.doctor_id), locale)}</Bdi> : t('cat.allDoctors')}</td>
                    <td>
                      <Money value={num(p.price)} locale={locale} />
                    </td>
                    <td className="num text-xs">{`${isoDate(p.effective_from)} → ${isoDate(p.effective_to) || '∞'}`}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      <Section title={t('cat.setPrice')}>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const price = parseEgp(f.price);
            if (price === null) return a.setError(t('form.invalidAmount'));
            const r = await a.run(() => post('/prices', { clinicId, serviceId: f.serviceId, doctorId: f.doctorId || null, price, effectiveFrom: f.effectiveFrom, effectiveTo: f.effectiveTo || null }));
            if (r) {
              toast(t('common.saved'));
              q.reload();
            }
          }}
        >
          <SelectField label={t('book.service')} value={f.serviceId} placeholder={t('form.choose')} onChange={(e) => setF({ ...f, serviceId: e.target.value })} options={services.map((s) => ({ value: s.id, label: `${s.code} · ${biName(s, locale)}` }))} required />
          <SelectField label={t('cat.doctorOverride')} value={f.doctorId} placeholder={t('cat.allDoctors')} onChange={(e) => setF({ ...f, doctorId: e.target.value })} options={(doctors.data ?? []).map((d) => ({ value: d.id, label: biName(d, locale) }))} />
          <TextField label={t('cat.priceEgp')} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="decimal" dir="ltr" required />
          <TextField label={t('sch.from')} type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} required />
          <TextField label={t('sch.to')} type="date" value={f.effectiveTo} onChange={(e) => setF({ ...f, effectiveTo: e.target.value })} />
          <p className="text-xs text-muted">{t('cat.priceHint')}</p>
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <Button type="submit" disabled={a.busy}>
            {t('common.save')}
          </Button>
        </form>
      </Section>
    </div>
  );
}

function Packages() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const q = useApi<PackageRow[]>('/packages');
  const { services } = useServices();
  const [f, setF] = useState({ serviceId: '', ar: '', en: '', sessions: 5, validityDays: 90, price: '', familyShareable: false });
  const a = useAction();
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Section title={t('cat.packages')} className="xl:col-span-2">
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('cat.name')}</th>
                  <th>{t('cat.sessions')}</th>
                  <th>{t('cat.validity')}</th>
                  <th>{t('cat.price')}</th>
                  <th>{t('cat.family')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>{biName(p, locale)}</td>
                    <td className="num">{p.sessions}</td>
                    <td className="num">{p.validity_days}</td>
                    <td>
                      <Money value={num(p.price)} locale={locale} />
                    </td>
                    <td>{p.family_shareable ? t('common.yes') : t('common.no')}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      <Section title={t('cat.newPackage')}>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const price = parseEgp(f.price);
            if (price === null) return a.setError(t('form.invalidAmount'));
            const r = await a.run(() => post('/packages', { serviceId: f.serviceId, name: { ar: f.ar, en: f.en }, sessions: Number(f.sessions), validityDays: Number(f.validityDays), price, familyShareable: f.familyShareable }));
            if (r) {
              toast(t('common.saved'));
              q.reload();
            }
          }}
        >
          <SelectField label={t('book.service')} value={f.serviceId} placeholder={t('form.choose')} onChange={(e) => setF({ ...f, serviceId: e.target.value })} options={services.map((s) => ({ value: s.id, label: biName(s, locale) }))} required />
          <TextField label={t('cat.nameAr')} value={f.ar} onChange={(e) => setF({ ...f, ar: e.target.value })} required dir="rtl" />
          <TextField label={t('cat.nameEn')} value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} dir="ltr" />
          <div className="grid grid-cols-2 gap-2">
            <TextField label={t('cat.sessions')} type="number" min={1} value={f.sessions} onChange={(e) => setF({ ...f, sessions: Number(e.target.value) })} />
            <TextField label={t('cat.validity')} type="number" min={1} value={f.validityDays} onChange={(e) => setF({ ...f, validityDays: Number(e.target.value) })} />
          </div>
          <TextField label={t('cat.priceEgp')} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="decimal" dir="ltr" required />
          <Check label={t('cat.family')} checked={f.familyShareable} onChange={(v) => setF({ ...f, familyShareable: v })} />
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <Button type="submit" disabled={a.busy}>
            {t('common.save')}
          </Button>
        </form>
      </Section>
    </div>
  );
}
