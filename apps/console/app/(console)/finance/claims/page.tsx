'use client';

import { useEffect, useState } from 'react';
import { formatMoney } from '@hf/shared/money';
import { Alert, Badge, Bdi, Button, DateText, PageHeader, Table } from '@hf/ui';
import { DataState, FileLink, Section, SelectField, TextField, useAction } from '@/components/common';
import { Dialog } from '@/components/dialog';
import { useI18n } from '@/components/i18n';
import type { Payer } from '@/components/insurance';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { get, post } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName, egpInput, isoDate, num, parseEgp, todayCairo } from '@/lib/format';

interface Batch {
  id: string;
  payer_id: string;
  number: string;
  period_from: string;
  period_to: string;
  total: number;
  paid: number;
  status: 'draft' | 'submitted' | 'partially_paid' | 'paid';
  submitted_at: string | null;
  created_at: string;
  payer_name_ar: string;
  items: number;
}

interface ClaimItem {
  id: string;
  bill_id: string;
  invoice: string | null;
  bill_date: string | null;
  patient_id: string;
  mrn: string;
  patient_name_ar: string;
  patient_name_en: string | null;
  amount: number;
  paid: number;
  status: 'claimed' | 'paid' | 'partially_paid' | 'rejected';
  rejection_reason: string | null;
  approval_number: string | null;
  member_number: string | null;
}

interface ClaimLine {
  item: ClaimItem;
  outstanding: number;
  paid: string;
  reason: string;
}

const ITEM_TONE: Record<ClaimItem['status'], 'neutral' | 'success' | 'warning' | 'danger'> = { claimed: 'neutral', paid: 'success', partially_paid: 'warning', rejected: 'danger' };

const STATUS_TONE: Record<Batch['status'], 'neutral' | 'primary' | 'warning' | 'success'> = { draft: 'neutral', submitted: 'primary', partially_paid: 'warning', paid: 'success' };

export default function ClaimsPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<Batch[]>('/insurance/claim-batches');
  const payers = useApi<Payer[]>('/insurance/payers');
  const today = todayCairo();
  const [f, setF] = useState({ payerId: '', from: `${today.slice(0, 7)}-01`, to: today });
  const [settle, setSettle] = useState<Batch | null>(null);
  const a = useAction();
  const approve = can('bill:approve');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.claims')} subtitle={t('claims.subtitle')} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Section title={t('claims.batches')} className="xl:col-span-2">
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('claims.number')}</th>
                    <th>{t('ins.payer')}</th>
                    <th>{t('claims.period')}</th>
                    <th>{t('claims.bills')}</th>
                    <th>{t('claims.claimed')}</th>
                    <th>{t('bill.paid')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <Bdi className="num font-medium">{b.number}</Bdi>
                        <span className="block text-xs text-muted">
                          <DateText value={b.created_at} locale={locale} />
                        </span>
                      </td>
                      <td>{b.payer_name_ar}</td>
                      <td className="num text-xs">
                        {isoDate(b.period_from)} → {isoDate(b.period_to)}
                      </td>
                      <td className="num">{b.items}</td>
                      <td className="num">{formatMoney(num(b.total), locale)}</td>
                      <td className="num">{formatMoney(num(b.paid), locale)}</td>
                      <td>
                        <Badge tone={STATUS_TONE[b.status]}>{t(`claims.status.${b.status}`)}</Badge>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {can('bill:export') && <FileLink href={`/insurance/claim-batches/${b.id}/export.csv`}>{t('claims.exportCsv')}</FileLink>}
                          {approve && b.status === 'draft' && (
                            <Button
                              size="sm"
                              disabled={a.busy}
                              onClick={async () => {
                                const r = await a.run(() => post(`/insurance/claim-batches/${b.id}/submit`));
                                if (r) {
                                  toast(t('claims.submitted'));
                                  q.reload();
                                }
                              }}
                            >
                              {t('claims.submit')}
                            </Button>
                          )}
                          {approve && (b.status === 'submitted' || b.status === 'partially_paid') && (
                            <Button size="sm" variant="secondary" onClick={() => setSettle(b)}>
                              {t('claims.settle')}
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
        </Section>
        {approve && (
          <Section title={t('claims.new')}>
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await a.run(() => post<{ items: number }>('/insurance/claim-batches', f));
                if (r) {
                  toast(t('claims.created', { n: r.items }));
                  q.reload();
                }
              }}
            >
              <p className="text-sm text-muted">{t('claims.newHint')}</p>
              <SelectField label={t('ins.payer')} value={f.payerId} required placeholder={t('form.choose')} onChange={(e) => setF({ ...f, payerId: e.target.value })} options={(payers.data ?? []).map((p) => ({ value: p.id, label: biName(p, locale) }))} />
              <div className="grid grid-cols-2 gap-2">
                <TextField label={t('common.from')} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} required />
                <TextField label={t('common.to')} type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} required />
              </div>
              <Button type="submit" disabled={a.busy || !f.payerId}>
                {t('claims.create')}
              </Button>
            </form>
          </Section>
        )}
      </div>
      <SettleDialog batch={settle} onClose={() => setSettle(null)} onDone={q.reload} />
    </div>
  );
}

function SettleDialog({ batch, onClose, onDone }: { batch: Batch | null; onClose: () => void; onDone: () => void }) {
  const { t, locale, err } = useI18n();
  const toast = useToast();
  const [lines, setLines] = useState<ClaimLine[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const a = useAction();

  useEffect(() => {
    if (!batch) return;
    let live = true;
    setLines(null);
    setLoadErr(null);
    setReference('');
    get<ClaimItem[]>(`/insurance/claim-batches/${batch.id}/items`).then(
      (items) =>
        live &&
        setLines(
          items.map((item) => {
            const outstanding = Math.max(0, num(item.amount) - num(item.paid));
            return { item, outstanding, paid: item.status === 'claimed' ? egpInput(outstanding) : '', reason: '' };
          }),
        ),
      (e: unknown) => live && setLoadErr(err(e)),
    );
    return () => {
      live = false;
    };
  }, [batch?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, p: Partial<ClaimLine>) => setLines((ls) => ls?.map((l, j) => (j === i ? { ...l, ...p } : l)) ?? null);
  const open = (l: ClaimLine) => l.outstanding > 0 && l.item.status !== 'rejected';
  const totalPaid = (lines ?? []).reduce((s, l) => s + (open(l) ? parseEgp(l.paid) ?? 0 : 0), 0);

  return (
    <Dialog open={!!batch} onClose={onClose} title={batch ? t('claims.settleTitle', { n: batch.number }) : ''} wide>
      {loadErr && <Alert tone="danger">{loadErr}</Alert>}
      {!lines && !loadErr && <p className="text-sm text-muted">{t('common.loading')}</p>}
      {lines && batch && (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const items: { billId: string; paidAmount: number; rejectionReason?: string }[] = [];
            for (const l of lines) {
              if (!open(l)) continue;
              const reason = l.reason.trim();
              if (!l.paid.trim() && !reason) continue; // left for a later remittance
              const p = parseEgp(l.paid || '0');
              if (p === null || p > l.outstanding) return a.setError(t('claims.paidRule', { invoice: l.item.invoice ?? l.item.mrn }));
              items.push({ billId: l.item.bill_id, paidAmount: p, rejectionReason: reason || undefined });
            }
            if (!items.length) return a.setError(t('claims.noItems'));
            const r = await a.run(() => post(`/insurance/claim-batches/${batch.id}/settle`, { reference: reference.trim(), items }));
            if (r) {
              toast(t('claims.settled'));
              onDone();
              onClose();
            }
          }}
        >
          <TextField label={t('claims.reference')} value={reference} onChange={(e) => setReference(e.target.value)} required maxLength={100} dir="ltr" hint={t('claims.referenceHint')} />
          <div className="max-h-[50vh] overflow-y-auto">
            <Table>
              <thead>
                <tr>
                  <th>{t('bill.number')}</th>
                  <th>{t('claims.billDate')}</th>
                  <th>{t('claims.patient')}</th>
                  <th>{t('claims.claimed')}</th>
                  <th>{t('claims.alreadyPaid')}</th>
                  <th>{t('claims.paidAmount')}</th>
                  <th>{t('claims.rejection')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.item.id}>
                    <td>
                      <Bdi className="num">{l.item.invoice ?? '—'}</Bdi>
                      <span className="block">
                        <Badge tone={ITEM_TONE[l.item.status]}>{t(`claims.item.${l.item.status}`)}</Badge>
                      </span>
                      {l.item.approval_number && <Bdi className="num block text-xs text-muted">{l.item.approval_number}</Bdi>}
                    </td>
                    <td className="num text-xs">{l.item.bill_date ? <DateText value={l.item.bill_date} locale={locale} /> : '—'}</td>
                    <td>
                      <span className="block">{biName({ name_ar: l.item.patient_name_ar, name_en: l.item.patient_name_en }, locale)}</span>
                      <Bdi className="num block text-xs text-muted">{l.item.mrn}</Bdi>
                      {l.item.member_number && <Bdi className="num block text-xs text-muted">{t('claims.memberShort', { n: l.item.member_number })}</Bdi>}
                    </td>
                    <td className="num">{formatMoney(num(l.item.amount), locale)}</td>
                    <td className="num">{formatMoney(num(l.item.paid), locale)}</td>
                    <td>
                      <input className="h-8 w-28 rounded-lg border border-border bg-surface px-2 text-sm" value={l.paid} disabled={!open(l)} onChange={(e) => set(i, { paid: e.target.value })} inputMode="decimal" dir="ltr" aria-label={`${t('claims.paidAmount')} ${l.item.invoice ?? ''}`} />
                    </td>
                    <td>
                      {open(l) ? (
                        <input className="h-8 w-40 rounded-lg border border-border bg-surface px-2 text-sm" value={l.reason} onChange={(e) => set(i, { reason: e.target.value })} maxLength={300} dir="auto" aria-label={`${t('claims.rejection')} ${l.item.invoice ?? ''}`} placeholder={t('claims.rejectionPh')} />
                      ) : (
                        <span className="text-xs text-muted" dir="auto">
                          {l.item.rejection_reason ?? '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p className="text-sm">
            {t('claims.totalPaid')}: <strong className="num">{formatMoney(totalPaid, locale)}</strong>
          </p>
          <p className="text-xs text-muted">{t('claims.settleHint')}</p>
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={a.busy}>
              {t('claims.recordPayment')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
