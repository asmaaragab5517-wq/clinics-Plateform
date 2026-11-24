'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { type PaymentMethod } from '@hf/shared/enums';
import { formatMoney } from '@hf/shared/money';
import { Alert, Badge, Bdi, Button, DateText, Money, PageHeader, Table } from '@hf/ui';
import { Dialog } from '@/components/dialog';
import { DataState, FileLink, ReasonDialog, Section, SelectField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession, useShortcuts } from '@/components/session';
import { useToast } from '@/components/toast';
import { newKey, post, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { egpInput, isoDate, num, parseEgp } from '@/lib/format';
import type { BillRow } from '@/lib/types';

interface BillDetail extends BillRow {
  credited: number;
  balance: number;
  insurer_share: number;
  coverage_id: string | null;
  approval_number: string | null;
  void_reason: string | null;
  lines: { id: string; description: string; qty: number; unit_price: number; discount: number; vat: number; total: number; vat_status: string }[];
  payments: { id: string; method: PaymentMethod; amount: number; refunded: number; reference: string | null; card_last4: string | null; receipt_number: string | null; status: string; created_at: string }[];
  creditNotes: { id: string; amount: number; reason: string; created_at: string; number?: string }[];
  refunds: { id: string; amount: number; status: string; reason: string; created_at: string }[];
}

export default function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { can, clinicId } = useSession();
  const toast = useToast();
  const q = useApi<BillDetail>(`/bills/${id}`);
  const shift = useApi<{ id: string } | null>(can('shift:view') ? `/shifts/current${qs({ clinicId })}` : null);
  const [dialog, setDialog] = useState<'pay' | 'void' | 'credit' | null>(null);
  const [refundFor, setRefundFor] = useState<BillDetail['payments'][number] | null>(null);
  const a = useAction();
  const b = q.data;
  const payable = !!b && ['issued', 'partially_paid'].includes(b.status) && num(b.balance) > 0;
  useShortcuts({ p: () => payable && can('payment:create') && setDialog('pay') });

  return (
    <DataState loading={q.loading} error={q.error} data={b}>
      {(bill) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={`${t('bill.invoice')} ${bill.number ?? t('bill.draft')}`}
            subtitle={`${bill.patient_name ?? ''}`}
            actions={
              <>
                <Link href={`/patients/${bill.patient_id}`} className="inline-flex h-10 items-center rounded-xl border border-border px-4 hover:bg-bg">
                  {t('rec.openRecord')}
                </Link>
                {bill.status === 'draft' && can('bill:create') && (
                  <Button
                    disabled={a.busy}
                    onClick={async () => {
                      const r = await a.run(() => post(`/bills/${bill.id}/issue`));
                      if (r) {
                        toast(t('cash.issued'));
                        q.reload();
                      }
                    }}
                  >
                    {t('cash.issue')}
                  </Button>
                )}
                {payable && can('payment:create') && <Button onClick={() => setDialog('pay')}>{t('cash.takePayment')}</Button>}
                {bill.number && (
                  <>
                    <FileLink href={`/bills/${bill.id}/invoice.pdf?kind=invoice`}>{t('bill.invoice')}</FileLink>
                    <FileLink href={`/bills/${bill.id}/invoice.pdf?kind=receipt`}>{t('bill.receipt')}</FileLink>
                  </>
                )}
                {bill.status === 'issued' && num(bill.paid) === 0 && can('bill:edit') && (
                  <Button variant="ghost" onClick={() => setDialog('void')}>
                    {t('cash.requestVoid')}
                  </Button>
                )}
                {['issued', 'partially_paid', 'paid'].includes(bill.status) && can('bill:approve') && (
                  <Button variant="ghost" onClick={() => setDialog('credit')}>
                    {t('cash.creditNote')}
                  </Button>
                )}
              </>
            }
          />
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          {bill.status === 'void' && <Alert tone="warning">{t('cash.voided', { reason: bill.void_reason ?? '' })}</Alert>}
          {can('payment:create') && shift.data === null && payable && <Alert tone="warning">{t('cash.noShiftCash')}</Alert>}
          <div className="grid gap-4 xl:grid-cols-3">
            <Section title={t('cash.lines')} className="xl:col-span-2">
              <Table>
                <thead>
                  <tr>
                    <th>{t('cash.description')}</th>
                    <th>{t('cash.qty')}</th>
                    <th>{t('cash.unitPrice')}</th>
                    <th>{t('bill.discount')}</th>
                    <th>{t('bill.vat')}</th>
                    <th>{t('common.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.lines.map((l) => (
                    <tr key={l.id}>
                      <td dir="auto">{l.description}</td>
                      <td className="num">{l.qty}</td>
                      <td>
                        <Money value={num(l.unit_price)} locale={locale} />
                      </td>
                      <td>
                        <Money value={num(l.discount)} locale={locale} />
                      </td>
                      <td>
                        <Money value={num(l.vat)} locale={locale} />
                      </td>
                      <td>
                        <Money value={num(l.total)} locale={locale} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Section>
            <Section title={t('cash.totals')}>
              <dl className="flex flex-col gap-1 text-sm">
                {(
                  [
                    ['common.status', <Badge key="s">{t(`billStatus.${bill.status}`)}</Badge>],
                    ['bill.subtotal', formatMoney(num(bill.subtotal), locale)],
                    ['bill.discount', formatMoney(num(bill.discount), locale)],
                    ['bill.vat', formatMoney(num(bill.vat), locale)],
                    ['common.total', formatMoney(num(bill.total), locale)],
                    ['cash.credited', formatMoney(num(bill.credited), locale)],
                    ['bill.paid', formatMoney(num(bill.paid) - num(bill.refunded), locale)],
                    ['bill.balance', formatMoney(num(bill.balance), locale)],
                    ...(num(bill.insurer_share) > 0 || bill.coverage_id
                      ? ([
                          ['ins.insurerShare', formatMoney(num(bill.insurer_share), locale)],
                          ['ins.patientDue', formatMoney(patientDue(bill), locale)],
                          ['ins.approvalNumber', bill.approval_number ?? '—'],
                        ] as const)
                      : []),
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-muted">{t(k)}</dt>
                    <dd className="num font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          </div>
          <Section title={t('cash.payments')}>
            {bill.payments.length === 0 ? (
              <p className="text-sm text-muted">{t('common.empty')}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>{t('cash.receiptNo')}</th>
                    <th>{t('common.date')}</th>
                    <th>{t('cash.method')}</th>
                    <th>{t('cash.amount')}</th>
                    <th>{t('cash.reference')}</th>
                    <th>{t('cash.refunded')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {bill.payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Bdi className="num">{p.receipt_number ?? '—'}</Bdi>
                      </td>
                      <td>
                        <DateText value={p.created_at} locale={locale} withTime />
                      </td>
                      <td>{t(`method.${p.method}`)}</td>
                      <td>
                        <Money value={num(p.amount)} locale={locale} />
                      </td>
                      <td>
                        <Bdi className="num">{[p.reference, p.card_last4 && `•••• ${p.card_last4}`].filter(Boolean).join(' ')}</Bdi>
                      </td>
                      <td>
                        <Money value={num(p.refunded)} locale={locale} />
                      </td>
                      <td>
                        {can('refund:create') && num(p.amount) > num(p.refunded) && (
                          <Button size="sm" variant="ghost" onClick={() => setRefundFor(p)}>
                            {t('cash.requestRefund')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {bill.refunds.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {bill.refunds.map((r) => (
                  <li key={r.id} className="flex justify-between">
                    <span>
                      {t('cash.refund')} · <Money value={num(r.amount)} locale={locale} /> · <span dir="auto">{r.reason}</span>
                    </span>
                    <Badge>{t(`refundStatus.${r.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {bill.creditNotes.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {bill.creditNotes.map((c) => (
                  <li key={c.id}>
                    {t('cash.creditNote')} · <Money value={num(c.amount)} locale={locale} /> · <span dir="auto">{c.reason}</span> · <span className="num">{isoDate(c.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <PaymentDialog open={dialog === 'pay'} bill={bill} onClose={() => setDialog(null)} onPaid={q.reload} />
          <ReasonDialog
            open={dialog === 'void'}
            title={t('cash.requestVoid')}
            onClose={() => setDialog(null)}
            onSubmit={async (reason) => {
              await post(`/bills/${bill.id}/void`, { reason });
              toast(t('cash.voidRequested'));
              q.reload();
            }}
          />
          <CreditDialog open={dialog === 'credit'} billId={bill.id} onClose={() => setDialog(null)} onDone={q.reload} />
          <RefundDialog payment={refundFor} onClose={() => setRefundFor(null)} onDone={q.reload} />
        </div>
      )}
    </DataState>
  );
}

/** What the patient still owes: the insurer share is collected through claims (FR-BIL-11). Mirrors the API's check. */
function patientDue(b: BillDetail): number {
  const share = num(b.insurer_share);
  if (share <= 0) return num(b.balance);
  const patientPaid = b.payments.filter((p) => (p.method as string) !== 'insurance' && p.status === 'captured').reduce((a, p) => a + num(p.amount) - num(p.refunded), 0);
  return Math.max(0, Math.min(num(b.balance), num(b.total) - num(b.credited) - share - patientPaid));
}

function PaymentDialog({ open, bill, onClose, onPaid }: { open: boolean; bill: BillDetail; onClose: () => void; onPaid: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [method, setMethod] = useState<Exclude<PaymentMethod, 'healthpay'>>('cash');
  const [amount, setAmount] = useState(egpInput(patientDue(bill)));
  const [reference, setReference] = useState('');
  const [last4, setLast4] = useState('');
  const [pkg, setPkg] = useState('');
  const [key, setKey] = useState(newKey());
  const pkgs = useApi<{ id: string; name_ar: string; name_en: string; sessions_total: number; sessions_used: number; expires_on: string }[]>(open && method === 'package_balance' ? `/patients/${bill.patient_id}/packages` : null);
  const a = useAction();
  return (
    <Dialog open={open} onClose={onClose} title={t('cash.takePayment')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const p = parseEgp(amount);
          if (!p) return a.setError(t('form.invalidAmount'));
          const r = await a.run(() =>
            post(
              `/bills/${bill.id}/payments`,
              {
                method,
                amount: p,
                reference: method === 'card_at_clinic' || method === 'bank_transfer' ? reference : undefined,
                cardLast4: method === 'card_at_clinic' && last4 ? last4 : undefined,
                packageBalanceId: method === 'package_balance' ? pkg : undefined,
              },
              key,
            ),
          );
          if (r) {
            toast(t('cash.paid'));
            setKey(newKey());
            onPaid();
            onClose();
          }
        }}
      >
        <p className="text-sm">
          {t('bill.balance')}: <strong className="num">{formatMoney(num(bill.balance), locale)}</strong>
          {num(bill.insurer_share) > 0 && (
            <>
              {' · '}
              {t('ins.patientDue')}: <strong className="num">{formatMoney(patientDue(bill), locale)}</strong>
            </>
          )}
        </p>
        {num(bill.insurer_share) > 0 && <p className="text-xs text-muted">{t('ins.payPatientShareOnly')}</p>}
        <SelectField label={t('cash.method')} value={method} onChange={(e) => setMethod(e.target.value as typeof method)} options={(['cash', 'card_at_clinic', 'bank_transfer', 'package_balance'] as const).map((m) => ({ value: m, label: t(`method.${m}`) }))} />
        <TextField label={t('cash.amount')} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" required autoFocus />
        {method === 'card_at_clinic' && (
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t('cash.posRef')} value={reference} onChange={(e) => setReference(e.target.value)} required dir="ltr" />
            <TextField label={t('cash.last4')} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" pattern="\d{4}" dir="ltr" />
          </div>
        )}
        {method === 'bank_transfer' && <TextField label={t('cash.transferRef')} value={reference} onChange={(e) => setReference(e.target.value)} required dir="ltr" />}
        {method === 'package_balance' && (
          <SelectField
            label={t('cash.package')}
            value={pkg}
            onChange={(e) => setPkg(e.target.value)}
            placeholder={t('form.choose')}
            options={(pkgs.data ?? []).filter((p) => p.sessions_used < p.sessions_total).map((p) => ({ value: p.id, label: `${locale === 'en' ? p.name_en || p.name_ar : p.name_ar} · ${t('pat.sessionsLeft', { n: p.sessions_total - p.sessions_used, total: p.sessions_total })} · ${isoDate(p.expires_on)}` }))}
          />
        )}
        {method === 'cash' && <p className="text-xs text-muted">{t('cash.cashNeedsShift')}</p>}
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={a.busy}>
            {t('cash.confirmPayment')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CreditDialog({ open, billId, onClose, onDone }: { open: boolean; billId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const a = useAction();
  return (
    <Dialog open={open} onClose={onClose} title={t('cash.creditNote')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const p = parseEgp(amount);
          if (!p) return a.setError(t('form.invalidAmount'));
          const r = await a.run(() => post(`/bills/${billId}/credit-notes`, { amount: p, reason }));
          if (r) {
            onDone();
            onClose();
          }
        }}
      >
        <TextField label={t('cash.amount')} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" required />
        <TextField label={t('form.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy}>
          {t('common.confirm')}
        </Button>
      </form>
    </Dialog>
  );
}

function RefundDialog({ payment, onClose, onDone }: { payment: BillDetail['payments'][number] | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const a = useAction();
  return (
    <Dialog open={!!payment} onClose={onClose} title={t('cash.requestRefund')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!payment) return;
          const p = parseEgp(amount);
          if (!p) return a.setError(t('form.invalidAmount'));
          const r = await a.run(() => post('/refunds', { paymentId: payment.id, amount: p, reason }));
          if (r) {
            toast(t('cash.refundRequested'));
            onDone();
            onClose();
          }
        }}
      >
        {payment && <p className="text-sm text-muted">{t('cash.refundMax', { amount: egpInput(num(payment.amount) - num(payment.refunded)) })}</p>}
        <TextField label={t('cash.amount')} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" required />
        <TextField label={t('form.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy}>
          {t('cash.requestRefund')}
        </Button>
      </form>
    </Dialog>
  );
}
