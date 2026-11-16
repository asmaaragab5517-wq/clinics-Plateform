'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { DENOMINATIONS, addDays, VAT_STATUSES, computeBill, countCash, formatMoney, type VatStatus } from '@hf/shared';
import { Alert, Badge, Bdi, Button, DateText, Input, Money, PageHeader, Select, Table, Tabs } from '@hf/ui';
import { DataState, FileLink, Section, SelectField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { PatientSearch } from '@/components/patient-search';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { get, post, qs } from '@/lib/api';
import { usePrices, useServices } from '@/lib/data';
import { useApi } from '@/lib/hooks';
import { biName, dayRange, egpInput, num, parseEgp, patientName, todayCairo } from '@/lib/format';
import type { AppointmentRow, BillRow, PackageRow } from '@/lib/types';

type Tab = 'bills' | 'new' | 'shift';

export default function CashierPage() {
  return (
    <Suspense>
      <Cashier />
    </Suspense>
  );
}

function Cashier() {
  const { t } = useI18n();
  const { can } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const appointmentId = sp.get('appointmentId');
  const patientId = sp.get('patientId');
  const [tab, setTab] = useState<Tab>(patientId ? 'new' : 'bills');

  // "p" from reception: open the existing bill for this appointment if there is one.
  useEffect(() => {
    if (!appointmentId || !patientId) return;
    get<BillRow[]>(`/bills${qs({ patientId })}`)
      .then((bills) => {
        const b = bills.find((x) => x.appointment_id === appointmentId && x.status !== 'void');
        if (b) router.replace(`/cashier/bills/${b.id}`);
      })
      .catch(() => undefined);
  }, [appointmentId, patientId, router]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.cashier')} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'bills', label: t('cash.bills') },
          ...(can('bill:create') ? [{ value: 'new' as Tab, label: t('cash.newBill') }] : []),
          ...(can('shift:view') ? [{ value: 'shift' as Tab, label: t('cash.shift') }] : []),
        ]}
      />
      {tab === 'bills' && <Bills />}
      {tab === 'new' && <NewBill initialPatientId={patientId} initialAppointmentId={appointmentId} />}
      {tab === 'shift' && <ShiftPanel />}
    </div>
  );
}

function Bills() {
  const { t, locale } = useI18n();
  const { clinicId } = useSession();
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState(todayCairo());
  const [to, setTo] = useState(todayCairo());
  const q = useApi<BillRow[]>(`/bills${qs({ clinicId, status, from, to })}`);
  return (
    <Section
      title={t('cash.bills')}
      actions={
        <>
          <Select className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')}>
            <option value="">{t('cash.allStatuses')}</option>
            {['draft', 'issued', 'partially_paid', 'paid', 'void', 'refunded'].map((s) => (
              <option key={s} value={s}>
                {t(`billStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Input type="date" className="h-8 w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('common.from')} />
          <Input type="date" className="h-8 w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('common.to')} />
        </>
      }
    >
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <th>{t('bill.number')}</th>
                <th>{t('rec.patient')}</th>
                <th>{t('common.date')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.total')}</th>
                <th>{t('bill.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link className="underline" href={`/cashier/bills/${b.id}`}>
                      <Bdi className="num">{b.number ?? t('bill.draft')}</Bdi>
                    </Link>
                  </td>
                  <td>
                    <Bdi>{b.patient_name}</Bdi> <Bdi className="num text-xs text-muted">{b.mrn}</Bdi>
                  </td>
                  <td>
                    <DateText value={b.issued_at ?? b.created_at} locale={locale} withTime />
                  </td>
                  <td>
                    <Badge tone={b.status === 'paid' ? 'success' : b.status === 'void' ? 'neutral' : 'warning'}>{t(`billStatus.${b.status}`)}</Badge>
                  </td>
                  <td>
                    <Money value={num(b.total)} locale={locale} />
                  </td>
                  <td>
                    <Money value={num(b.total) - num(b.credited) - (num(b.paid) - num(b.refunded))} locale={locale} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </DataState>
    </Section>
  );
}

interface DraftLine {
  kind: 'service' | 'package' | 'consumable';
  serviceId: string;
  packageId: string;
  description: string;
  qty: number;
  unitPrice: string; // EGP text (consumables or override)
  discountType: 'none' | 'amount' | 'percent';
  discountValue: string;
  vat: VatStatus;
}

const blankLine = (): DraftLine => ({ kind: 'service', serviceId: '', packageId: '', description: '', qty: 1, unitPrice: '', discountType: 'none', discountValue: '', vat: 'exempt' });

function NewBill({ initialPatientId, initialAppointmentId }: { initialPatientId: string | null; initialAppointmentId: string | null }) {
  const { t, locale } = useI18n();
  const { clinicId } = useSession();
  const router = useRouter();
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null);
  const [appointmentId, setAppointmentId] = useState(initialAppointmentId ?? '');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const { active: services } = useServices();
  const { priceOf } = usePrices(clinicId);
  const pkgs = useApi<PackageRow[]>('/packages');
  const apptRange = { from: dayRange(addDays(todayCairo(), -30)).from, to: dayRange(todayCairo(), 2).to };
  const appts = useApi<AppointmentRow[]>(patient ? `/appointments${qs({ clinicId, patientId: patient.id, ...apptRange })}` : null);
  const a = useAction();

  useEffect(() => {
    if (!initialPatientId) return;
    get<{ id: string; first_name_ar: string; father_name_ar: string; family_name_ar: string; mrn: string }>(`/patients/${initialPatientId}`)
      .then((p) => setPatient({ id: p.id, name: `${patientName(p)} · ${p.mrn}` }))
      .catch(() => undefined);
  }, [initialPatientId]);

  const appt = appts.data?.find((x) => x.id === appointmentId);
  // Prefill a line per appointment service.
  useEffect(() => {
    if (!appt) return;
    setLines(appt.services.map((s) => ({ ...blankLine(), serviceId: s.id, vat: services.find((x) => x.id === s.id)?.vat ?? 'exempt' })));
  }, [appt?.id, services.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i: number, p: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const unitOf = (l: DraftLine): number | null => {
    if (l.unitPrice.trim()) return parseEgp(l.unitPrice);
    if (l.kind === 'service' && l.serviceId) return priceOf(l.serviceId, appt?.doctor_id);
    if (l.kind === 'package' && l.packageId) return num(pkgs.data?.find((p) => p.id === l.packageId)?.price);
    return null;
  };
  const vatOf = (l: DraftLine): VatStatus => (l.kind === 'service' ? (services.find((s) => s.id === l.serviceId)?.vat ?? 'exempt') : l.vat);
  const discountOf = (l: DraftLine) => {
    if (l.discountType === 'amount') {
      const v = parseEgp(l.discountValue);
      return v === null ? undefined : { type: 'amount' as const, value: v };
    }
    if (l.discountType === 'percent') {
      const v = Number(l.discountValue);
      return Number.isFinite(v) && v >= 0 && v <= 100 ? { type: 'percent' as const, value: v } : undefined;
    }
    return undefined;
  };

  const preview = useMemo(() => {
    try {
      const ready = lines.filter((l) => unitOf(l) !== null);
      return computeBill(ready.map((l) => ({ qty: l.qty, unitPrice: unitOf(l)!, discount: discountOf(l), vat: vatOf(l) })));
    } catch {
      return null;
    }
  }, [lines, services, pkgs.data, priceOf]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!patient) return;
    const payload = {
      clinicId,
      patientId: patient.id,
      appointmentId: appointmentId || undefined,
      lines: lines.map((l) => ({
        serviceId: l.kind === 'service' ? l.serviceId || undefined : undefined,
        packageId: l.kind === 'package' ? l.packageId || undefined : undefined,
        description: l.kind === 'consumable' ? l.description : undefined,
        qty: l.qty,
        unitPrice: l.unitPrice.trim() ? (parseEgp(l.unitPrice) ?? undefined) : undefined,
        discount: discountOf(l),
        vat: l.kind === 'consumable' ? l.vat : undefined,
      })),
    };
    const b = await a.run(() => post<{ id: string }>('/bills', payload));
    if (b) router.push(`/cashier/bills/${b.id}`);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        <Section title={t('rec.patient')}>
          {patient ? (
            <div className="flex items-center justify-between text-sm">
              <Bdi className="font-medium">{patient.name}</Bdi>
              <Button size="sm" variant="ghost" onClick={() => (setPatient(null), setAppointmentId(''))}>
                {t('common.change')}
              </Button>
            </div>
          ) : (
            <PatientSearch id="bill-patient" onSelect={(p) => setPatient({ id: p.id, name: `${patientName(p, locale)} · ${p.mrn}` })} compact />
          )}
          {patient && (
            <div className="mt-3">
              <SelectField
                label={t('cash.fromAppointment')}
                value={appointmentId}
                onChange={(e) => setAppointmentId(e.target.value)}
                placeholder={t('cash.noAppointment')}
                options={(appts.data ?? []).filter((x) => !['cancelled', 'no_show'].includes(x.status)).map((x) => ({ value: x.id, label: `${x.start_at.slice(0, 10)} · ${x.doctor_name} · ${t(`status.${x.status}`)}` }))}
              />
            </div>
          )}
        </Section>
        <Section title={t('cash.lines')} actions={<Button size="sm" variant="secondary" onClick={() => setLines([...lines, blankLine()])}>{t('cash.addLine')}</Button>}>
          <div className="flex flex-col gap-3">
            {lines.map((l, i) => {
              const unit = unitOf(l);
              return (
                <fieldset key={i} className="grid gap-2 rounded-xl border border-border p-3 md:grid-cols-6">
                  <legend className="px-1 text-sm font-medium">{t('cash.line', { n: i + 1 })}</legend>
                  <SelectField label={t('cash.lineKind')} value={l.kind} onChange={(e) => set(i, { kind: e.target.value as DraftLine['kind'] })} options={['service', 'package', 'consumable'].map((k) => ({ value: k, label: t(`cash.kind.${k}`) }))} />
                  <div className="md:col-span-2">
                    {l.kind === 'service' && <SelectField label={t('book.service')} value={l.serviceId} placeholder={t('form.choose')} onChange={(e) => set(i, { serviceId: e.target.value })} options={services.map((s) => ({ value: s.id, label: `${s.code} · ${biName(s, locale)}` }))} />}
                    {l.kind === 'package' && <SelectField label={t('cash.package')} value={l.packageId} placeholder={t('form.choose')} onChange={(e) => set(i, { packageId: e.target.value })} options={(pkgs.data ?? []).map((p) => ({ value: p.id, label: `${biName(p, locale)} (${p.sessions})` }))} />}
                    {l.kind === 'consumable' && <TextField label={t('cash.description')} value={l.description} onChange={(e) => set(i, { description: e.target.value })} required dir="auto" />}
                  </div>
                  <TextField label={t('cash.qty')} type="number" min={1} value={l.qty} onChange={(e) => set(i, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
                  <TextField label={t('cash.unitPrice')} value={l.unitPrice} placeholder={unit !== null && !l.unitPrice ? egpInput(unit) : ''} onChange={(e) => set(i, { unitPrice: e.target.value })} inputMode="decimal" dir="ltr" hint={l.kind !== 'consumable' ? t('cash.priceFromList') : undefined} />
                  {l.kind === 'consumable' ? (
                    <SelectField label={t('cash.vat')} value={l.vat} onChange={(e) => set(i, { vat: e.target.value as VatStatus })} options={VAT_STATUSES.map((v) => ({ value: v, label: t(`vat.${v}`) }))} />
                  ) : (
                    <div className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">{t('cash.vat')}</span>
                      <span className="flex h-10 items-center">{t(`vat.${vatOf(l)}`)}</span>
                    </div>
                  )}
                  <SelectField label={t('cash.discountType')} value={l.discountType} onChange={(e) => set(i, { discountType: e.target.value as DraftLine['discountType'] })} options={['none', 'amount', 'percent'].map((k) => ({ value: k, label: t(`cash.discount.${k}`) }))} />
                  {l.discountType !== 'none' && <TextField label={l.discountType === 'percent' ? t('cash.discountPercent') : t('cash.discountAmount')} value={l.discountValue} onChange={(e) => set(i, { discountValue: e.target.value })} inputMode="decimal" dir="ltr" />}
                  <div className="flex items-end justify-end md:col-span-6">
                    {lines.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                        {t('common.remove')}
                      </Button>
                    )}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </Section>
      </div>
      <Section title={t('cash.preview')}>
        <div className="flex flex-col gap-2 text-sm">
          <Alert tone="info">{t('cash.previewNote')}</Alert>
          {preview && (
            <dl className="flex flex-col gap-1">
              {(
                [
                  ['bill.subtotal', preview.subtotal],
                  ['bill.discount', preview.discount],
                  ['cash.taxableBase', preview.taxableBase],
                  ['bill.vat', preview.vat],
                  ['common.total', preview.total],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-muted">{t(k)}</dt>
                  <dd className="num">{formatMoney(v, locale)}</dd>
                </div>
              ))}
            </dl>
          )}
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <Button disabled={!patient || a.busy} onClick={() => void submit()}>
            {t('cash.createDraft')}
          </Button>
        </div>
      </Section>
    </div>
  );
}

interface Shift {
  id: string;
  clinic_id: string;
  status: 'open' | 'closed' | 'pending_approval' | 'approved';
  opening_float: number;
  cash_in: number;
  cash_out: number;
  expected: number | null;
  counted: number | null;
  variance: number | null;
  opened_at: string;
  closed_at: string | null;
  cashier_name?: string;
}

const DENOM_LABEL = (d: number) => (d >= 100 ? String(d / 100) : (d / 100).toFixed(2));

function ShiftPanel() {
  const { t, locale } = useI18n();
  const { clinicId, can } = useSession();
  const toast = useToast();
  const cur = useApi<Shift | null>(`/shifts/current${qs({ clinicId })}`);
  const history = useApi<(Shift & { cashier_name: string })[]>(`/shifts${qs({ clinicId })}`);
  const [float, setFloat] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [closed, setClosed] = useState<(Shift & { summary?: { expected: number; counted: number; variance: number; needsApproval: boolean } }) | null>(null);
  const a = useAction();
  const sh = cur.data;
  const countsInt = Object.fromEntries(DENOMINATIONS.map((d) => [String(d), Math.max(0, Math.floor(Number(counts[String(d)] || 0)))]));
  const counted = countCash(countsInt);
  const expected = sh ? num(sh.opening_float) + num(sh.cash_in) - num(sh.cash_out) : 0;
  const money = (v: number) => formatMoney(v, locale);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title={t('cash.currentShift')}>
        <DataState loading={cur.loading} error={cur.error} data={cur.data === undefined ? undefined : { sh }}>
          {() =>
            !sh ? (
              closed ? (
                <div className="flex flex-col gap-2 text-sm">
                  <Alert tone={closed.summary?.needsApproval ? 'warning' : 'success'}>{closed.summary?.needsApproval ? t('cash.varianceApproval') : t('cash.shiftClosed')}</Alert>
                  <FileLink href={`/shifts/${closed.id}/report.pdf`}>{t('cash.shiftReport')}</FileLink>
                </div>
              ) : can('shift:create') ? (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const p = parseEgp(float || '0');
                    if (p === null) return a.setError(t('form.invalidAmount'));
                    const r = await a.run(() => post('/shifts', { clinicId, openingFloat: p }));
                    if (r) {
                      toast(t('cash.shiftOpened'));
                      cur.reload();
                      history.reload();
                    }
                  }}
                >
                  <p className="text-sm text-muted">{t('cash.noShift')}</p>
                  <TextField label={t('cash.openingFloat')} value={float} onChange={(e) => setFloat(e.target.value)} inputMode="decimal" dir="ltr" placeholder="0.00" />
                  {a.error && <Alert tone="danger">{a.error}</Alert>}
                  <Button type="submit" disabled={a.busy}>
                    {t('shift.open')}
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted">{t('cash.noShift')}</p>
              )
            ) : (
              <form
                className="flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await a.run(() => post<Shift & { summary: { expected: number; counted: number; variance: number; needsApproval: boolean } }>(`/shifts/${sh.id}/close`, { counts: countsInt, note: note || undefined }));
                  if (r) {
                    setClosed(r);
                    setCounts({});
                    cur.reload();
                    history.reload();
                  }
                }}
              >
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted">{t('cash.openedAt')}</dt>
                  <dd>
                    <DateText value={sh.opened_at} locale={locale} withTime />
                  </dd>
                  <dt className="text-muted">{t('cash.openingFloat')}</dt>
                  <dd className="num">{money(num(sh.opening_float))}</dd>
                  <dt className="text-muted">{t('cash.cashIn')}</dt>
                  <dd className="num">{money(num(sh.cash_in))}</dd>
                  <dt className="text-muted">{t('cash.cashOut')}</dt>
                  <dd className="num">{money(num(sh.cash_out))}</dd>
                </dl>
                <Table aria-label={t('cash.denominations')}>
                  <thead>
                    <tr>
                      <th>{t('cash.denomination')}</th>
                      <th>{t('cash.count')}</th>
                      <th>{t('common.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DENOMINATIONS.map((d) => (
                      <tr key={d}>
                        <td className="num">{`${DENOM_LABEL(d)} ${locale === 'ar' ? t('cash.egp') : 'EGP'}`}</td>
                        <td>
                          <Input className="h-8 w-24" type="number" min={0} step={1} inputMode="numeric" value={counts[String(d)] ?? ''} onChange={(e) => setCounts({ ...counts, [String(d)]: e.target.value })} aria-label={t('cash.countOf', { d: DENOM_LABEL(d) })} dir="ltr" />
                        </td>
                        <td className="num">{money(d * (countsInt[String(d)] ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <dl className="grid grid-cols-3 gap-2 rounded-xl bg-bg p-3 text-sm">
                  <div>
                    <dt className="text-muted">{t('shift.expected')}</dt>
                    <dd className="num font-bold">{money(expected)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('shift.counted')}</dt>
                    <dd className="num font-bold">{money(counted)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('shift.variance')}</dt>
                    <dd className={`num font-bold ${counted - expected === 0 ? 'text-success' : 'text-danger'}`}>{money(counted - expected)}</dd>
                  </div>
                </dl>
                <TextField label={t('enc.note')} value={note} onChange={(e) => setNote(e.target.value)} />
                {a.error && <Alert tone="danger">{a.error}</Alert>}
                {can('shift:edit') && (
                  <Button type="submit" disabled={a.busy}>
                    {t('shift.close')}
                  </Button>
                )}
              </form>
            )
          }
        </DataState>
      </Section>
      <Section title={t('cash.shiftHistory')}>
        <DataState loading={history.loading} error={history.error} data={history.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('cash.openedAt')}</th>
                  <th>{t('cash.cashier')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('shift.variance')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <DateText value={s.opened_at} locale={locale} withTime />
                    </td>
                    <td>
                      <Bdi>{s.cashier_name}</Bdi>
                    </td>
                    <td>
                      <Badge tone={s.status === 'pending_approval' ? 'warning' : s.status === 'open' ? 'primary' : 'success'}>{t(`shiftStatus.${s.status}`)}</Badge>
                    </td>
                    <td className="num">{s.variance === null ? '—' : money(num(s.variance))}</td>
                    <td>{s.closed_at && <FileLink href={`/shifts/${s.id}/report.pdf`}>{t('cash.shiftReport')}</FileLink>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
    </div>
  );
}
