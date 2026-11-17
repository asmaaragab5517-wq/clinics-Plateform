'use client';

import { useEffect, useState } from 'react';
import { addDays, formatMoney } from '@hf/shared';
import { Alert, Badge, Bdi, Button, DateText, PageHeader, Table } from '@hf/ui';
import { DataState, FileLink, Section, SelectField, TextField, useAction } from '@/components/common';
import { Dialog } from '@/components/dialog';
import { useI18n } from '@/components/i18n';
import type { Payer } from '@/components/insurance';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { ApiError, get, post, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName, egpInput, isoDate, num, parseEgp, todayCairo } from '@/lib/format';
import type { BillRow } from '@/lib/types';

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

interface ClaimLine {
  billId: string | null;
  invoice: string;
  date: string;
  patient: string;
  member: string;
  claimed: number;
  paid: string;
  reason: string;
}

/** Minimal RFC 4180 reader for the claim export (UTF-8 BOM, CRLF, quoted cells). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x !== ''));
}

const unquote = (v: string) => (v.startsWith("'") && /^'[=+\-@]/.test(v) ? v.slice(1) : v);

/**
 * The API has no "items of a batch" endpoint, so the settlement form reads the batch's own CSV export
 * (invoice number and claimed amount per bill) and resolves invoice numbers to bill ids through the bills list.
 */
async function loadClaimLines(b: Batch): Promise<ClaimLine[]> {
  const r = await fetch(`/api/v1/insurance/claim-batches/${b.id}/export.csv`, { credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(r.status, j.error ?? `http_${r.status}`);
  }
  const [header, ...rows] = parseCsv(await r.text());
  const col = (name: string) => header!.indexOf(name);
  const bills = await get<BillRow[]>(`/bills${qs({ status: 'issued,partially_paid,paid', from: addDays(isoDate(b.period_from), -60), to: isoDate(b.period_to) })}`);
  const byNumber = new Map(bills.filter((x) => x.number).map((x) => [x.number!, x.id]));
  return rows.map((cells) => {
    const invoice = unquote(cells[col('invoice')] ?? '');
    const claimed = parseEgp(cells[col('claimed_egp')] ?? '0') ?? 0;
    return {
      billId: byNumber.get(invoice) ?? null,
      invoice,
      date: cells[col('date')] ?? '',
      patient: unquote(cells[col('patient')] ?? ''),
      member: unquote(cells[col('member_number')] ?? ''),
      claimed,
      paid: egpInput(claimed),
      reason: '',
    };
  });
}

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
    loadClaimLines(batch).then(
      (l) => live && setLines(l),
      (e: unknown) => live && setLoadErr(err(e)),
    );
    return () => {
      live = false;
    };
  }, [batch?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, p: Partial<ClaimLine>) => setLines((ls) => ls?.map((l, j) => (j === i ? { ...l, ...p } : l)) ?? null);
  const unresolved = lines?.filter((l) => !l.billId).length ?? 0;
  const totalPaid = (lines ?? []).reduce((s, l) => s + (parseEgp(l.paid) ?? 0), 0);

  return (
    <Dialog
      open={!!batch}
      onClose={onClose}
      title={batch ? t('claims.settleTitle', { n: batch.number }) : ''}
      wide
    >
      {loadErr && <Alert tone="danger">{loadErr}</Alert>}
      {!lines && !loadErr && <p className="text-sm text-muted">{t('common.loading')}</p>}
      {lines && batch && (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const items = [];
            for (const l of lines) {
              if (!l.billId) continue;
              const p = parseEgp(l.paid || '0');
              if (p === null || p > l.claimed) return a.setError(t('claims.paidRule', { invoice: l.invoice }));
              items.push({ billId: l.billId, paidAmount: p, rejectionReason: l.reason.trim() || undefined });
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
          {unresolved > 0 && <Alert tone="warning">{t('claims.unresolved', { n: unresolved })}</Alert>}
          <div className="max-h-[50vh] overflow-y-auto">
            <Table>
              <thead>
                <tr>
                  <th>{t('bill.number')}</th>
                  <th>{t('rec.patient')}</th>
                  <th>{t('claims.claimed')}</th>
                  <th>{t('claims.paidAmount')}</th>
                  <th>{t('claims.rejection')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={`${l.invoice}-${i}`}>
                    <td>
                      <Bdi className="num">{l.invoice}</Bdi>
                      <span className="num block text-xs text-muted">{l.date}</span>
                    </td>
                    <td>
                      <Bdi>{l.patient}</Bdi>
                      <Bdi className="num block text-xs text-muted">{l.member}</Bdi>
                    </td>
                    <td className="num">{formatMoney(l.claimed, locale)}</td>
                    <td>
                      <input className="h-8 w-28 rounded-lg border border-border bg-surface px-2 text-sm" value={l.paid} disabled={!l.billId} onChange={(e) => set(i, { paid: e.target.value })} inputMode="decimal" dir="ltr" aria-label={`${t('claims.paidAmount')} ${l.invoice}`} />
                    </td>
                    <td>
                      <input className="h-8 w-40 rounded-lg border border-border bg-surface px-2 text-sm" value={l.reason} disabled={!l.billId} onChange={(e) => set(i, { reason: e.target.value })} maxLength={300} dir="auto" aria-label={`${t('claims.rejection')} ${l.invoice}`} placeholder={t('claims.rejectionPh')} />
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
