'use client';

import Link from 'next/link';
import { Fragment, use, useState } from 'react';
import { Alert, Badge, Bdi, Button, DateText, Money, PageHeader, Stat, Table } from '@hf/ui';
import { ConfirmDialog, DataState, FileLink, ReasonDialog, Section } from '@/components/common';
import { PayslipLines } from '@/components/hr';
import { Adjustments, runPerson, type PayrollRun, type Payslip } from '@/components/payroll';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { ApiError, post } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName, num } from '@/lib/format';
import { RUN_TONE, duration, fmtMonth } from '@/lib/hr';

type RunDetail = PayrollRun & { payslips: Payslip[] };
type Pending = 'approve' | 'paid' | 'recalc' | null;

/** Payroll run: totals, warnings in plain words, payslips with line breakdown, and status actions. */
export default function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { can, me, hasRole } = useSession();
  const toast = useToast();
  const q = useApi<RunDetail>(`/payroll/runs/${id}`);
  const [pending, setPending] = useState<Pending>(null);
  const [cancelling, setCancelling] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  // Errors surface inside the confirm dialog; the four-eyes refusal gets payroll wording.
  const act = async (path: string, done: string) => {
    try {
      const r = await post<RunDetail>(path);
      q.setData(r);
      toast(t(done));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'four_eyes_required') throw new ApiError(e.status, 'payroll_four_eyes_required');
      throw e;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <DataState loading={q.loading} error={q.error} data={q.data}>
        {(r) => {
          const totals = r.totals;
          const own = r.created_by === me.userId && !hasRole('owner');
          const exportable = (r.status === 'approved' || r.status === 'paid') && can('payroll:export');
          const slips = r.payslips.filter((p) => !onlyWarnings || p.warnings.length > 0);
          const slipWarnings = [...new Set(r.payslips.flatMap((p) => p.warnings))];
          return (
            <>
              <PageHeader
                title={t('pay.runTitle', { month: fmtMonth(r.month) })}
                actions={
                  <>
                    <Link href="/payroll" className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 hover:bg-bg">
                      {t('common.back')}
                    </Link>
                    {r.status === 'draft' && can('payroll:edit') && (
                      <Button variant="secondary" onClick={() => setPending('recalc')}>
                        {t('pay.recalc')}
                      </Button>
                    )}
                    {r.status === 'draft' && can('payroll:approve') && (
                      <Button onClick={() => setPending('approve')} disabled={own} title={own ? t('pay.fourEyesHint') : undefined}>
                        {t('common.approve')}
                      </Button>
                    )}
                    {r.status === 'approved' && can('payroll:approve') && <Button onClick={() => setPending('paid')}>{t('pay.markPaid')}</Button>}
                    {(r.status === 'draft' || r.status === 'approved') && can('payroll:approve') && (
                      <Button variant="danger" onClick={() => setCancelling(true)}>
                        {t('pay.cancelRun')}
                      </Button>
                    )}
                  </>
                }
              />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={RUN_TONE[r.status]}>{t(`pay.status.${r.status}`)}</Badge>
                {runPerson(r, 'created_by', locale) && (
                  <span className="text-muted">
                    {t('pay.preparedBy')} <Bdi>{runPerson(r, 'created_by', locale)}</Bdi>
                    {r.created_by === me.userId && <> ({t('pay.you')})</>} ·
                  </span>
                )}
                {r.calculated_at && (
                  <span className="text-muted">
                    {t('pay.calculated')} <DateText value={r.calculated_at} locale={locale} withTime />
                  </span>
                )}
                {r.approved_at && (
                  <span className="text-muted">
                    · {t('pay.approvedOn')} <DateText value={r.approved_at} locale={locale} withTime />
                    {runPerson(r, 'approved_by', locale) && (
                      <>
                        {' '}
                        {t('pay.byName')} <Bdi>{runPerson(r, 'approved_by', locale)}</Bdi>
                      </>
                    )}
                  </span>
                )}
                {r.paid_at && (
                  <span className="text-muted">
                    · {t('pay.paidOn')} <DateText value={r.paid_at} locale={locale} withTime />
                  </span>
                )}
                {r.created_by === me.userId && !runPerson(r, 'created_by', locale) && <span className="text-muted">· {t('pay.createdByYou')}</span>}
              </div>
              {own && r.status === 'draft' && can('payroll:approve') && <Alert tone="info">{t('pay.fourEyesHint')}</Alert>}
              {r.status === 'draft' && <p className="text-xs text-muted">{t('pay.draftHint')}</p>}
              {r.status !== 'draft' && r.status !== 'cancelled' && <p className="text-xs text-muted">{t('pay.frozenHint')}</p>}

              {((r.warnings ?? []).length > 0 || slipWarnings.length > 0) && (
                <Section title={t('pay.warnings')}>
                  <ul className="flex flex-col gap-2 text-sm">
                    {(r.warnings ?? []).map((w) => (
                      <li key={w}>
                        <Alert tone="warning">
                          <strong>{t(`pay.warnShort.${w}`)}</strong> — {t(`pay.warn.${w}`)}
                        </Alert>
                      </li>
                    ))}
                    {slipWarnings.map((w) => (
                      <li key={`slip-${w}`}>
                        <Alert tone={w === 'negative_net_pay' ? 'danger' : 'info'}>
                          <strong>{t(`pay.warnShort.${w}`)}</strong> ({t('pay.warnPeople', { n: r.payslips.filter((p) => p.warnings.includes(w)).length })}) — {t(`pay.warn.${w}`)}
                        </Alert>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {totals && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                  <Stat label={t('pay.people')} value={num(totals.people)} />
                  <Stat label={t('pay.gross')} value={<Money value={num(totals.gross)} locale={locale} />} />
                  <Stat label={t('pay.deductions')} value={<Money value={num(totals.deductions)} locale={locale} />} />
                  <Stat label={t('pay.net')} value={<Money value={num(totals.net)} locale={locale} />} />
                  <Stat label={t('pay.employerCost')} value={<Money value={num(totals.employerCost)} locale={locale} />} />
                  <Stat label={t('pay.employeeSi')} value={<Money value={num(totals.employeeInsurance)} locale={locale} />} />
                  <Stat label={t('pay.employerSi')} value={<Money value={num(totals.employerInsurance)} locale={locale} />} />
                  <Stat label={t('pay.incomeTax')} value={<Money value={num(totals.incomeTax)} locale={locale} />} />
                  <Stat label={t('pay.martyrs')} value={<Money value={num(totals.martyrsFund)} locale={locale} />} />
                </div>
              )}

              {exportable && (
                <Section title={t('pay.downloads')}>
                  <div className="flex flex-wrap gap-2">
                    <FileLink href={`/payroll/runs/${r.id}/bank-file.csv`}>{t('pay.bankFile')}</FileLink>
                    <FileLink href={`/payroll/runs/${r.id}/insurance.csv`}>{t('pay.siFile')}</FileLink>
                  </div>
                  <p className="mt-2 text-xs text-muted">{t('pay.downloadsHint')}</p>
                </Section>
              )}

              <Section
                title={t('pay.payslips')}
                actions={
                  <>
                    <label className="flex items-center gap-1 text-sm">
                      <input type="checkbox" className="h-4 w-4" checked={onlyWarnings} onChange={(e) => setOnlyWarnings(e.target.checked)} />
                      {t('pay.onlyWarnings')}
                    </label>
                    <Button size="sm" variant="ghost" onClick={() => setOpen(open.size ? new Set() : new Set(r.payslips.map((p) => p.id)))}>
                      {open.size ? t('pay.collapseAll') : t('pay.expandAll')}
                    </Button>
                  </>
                }
              >
                <Table>
                  <thead>
                    <tr>
                      <th>{t('hr.person')}</th>
                      <th>{t('pay.gross')}</th>
                      <th>{t('pay.deductions')}</th>
                      <th>{t('pay.net')}</th>
                      <th>{t('pay.employerCost')}</th>
                      <th>{t('pay.warnings')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {slips.map((p) => {
                      const expanded = open.has(p.id);
                      return (
                        <Fragment key={p.id}>
                          <tr>
                            <td>
                              <button
                                type="button"
                                className="text-start"
                                aria-expanded={expanded}
                                onClick={() => {
                                  const n = new Set(open);
                                  if (expanded) n.delete(p.id);
                                  else n.add(p.id);
                                  setOpen(n);
                                }}
                              >
                                <span aria-hidden="true" className="me-1 inline-block w-3 text-muted">
                                  {expanded ? '▾' : '▸'}
                                </span>
                                <Bdi className="font-medium">{biName(p, locale)}</Bdi>
                                <span className="block ps-4 text-xs text-muted">
                                  {locale === 'en' ? p.job_title_en || p.job_title_ar : p.job_title_ar} · {t(`hr.basis.${p.pay_basis}`)}
                                </span>
                              </button>
                            </td>
                            <td>
                              <Money value={num(p.gross)} locale={locale} />
                            </td>
                            <td>
                              <Money value={num(p.deductions)} locale={locale} />
                            </td>
                            <td className={num(p.net) < 0 ? 'font-bold text-danger' : 'font-bold'}>
                              <Money value={num(p.net)} locale={locale} />
                            </td>
                            <td>
                              <Money value={num(p.employer_cost)} locale={locale} />
                            </td>
                            <td>
                              <div className="flex flex-wrap gap-1">
                                {p.warnings.map((w) => (
                                  <Badge key={w} tone={w === 'negative_net_pay' ? 'danger' : 'warning'} title={t(`pay.warn.${w}`)}>
                                    {t(`pay.warnShort.${w}`)}
                                  </Badge>
                                ))}
                              </div>
                            </td>
                            <td>
                              <FileLink href={`/payroll/payslips/${p.id}/pdf`} variant="ghost">
                                {t('pay.pdf')}
                              </FileLink>
                            </td>
                          </tr>
                          {expanded && (
                            <tr>
                              <td colSpan={7} className="bg-bg/50">
                                <div className="flex flex-col gap-3 py-2">
                                  <PayslipLines lines={p.lines} />
                                  <Inputs inputs={p.inputs} />
                                  {p.warnings.map((w) => (
                                    <p key={w} className="text-xs text-warning">
                                      {t(`pay.warn.${w}`)}
                                    </p>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </Table>
              </Section>

              <Adjustments month={r.month} closed={r.status === 'approved' || r.status === 'paid'} />

              <ConfirmDialog
                open={pending !== null}
                title={pending === 'approve' ? t('pay.approveTitle') : pending === 'paid' ? t('pay.paidTitle') : t('pay.recalcTitle')}
                message={pending === 'approve' ? t('pay.approveConfirm', { month: fmtMonth(r.month) }) : pending === 'paid' ? t('pay.paidConfirm') : t('pay.recalcConfirm')}
                confirmLabel={pending === 'approve' ? t('common.approve') : pending === 'paid' ? t('pay.markPaid') : t('pay.recalc')}
                onClose={() => setPending(null)}
                onConfirm={() =>
                  pending === 'approve'
                    ? act(`/payroll/runs/${r.id}/approve`, 'pay.approved')
                    : pending === 'paid'
                      ? act(`/payroll/runs/${r.id}/paid`, 'pay.paid')
                      : act(`/payroll/runs/${r.id}/calculate`, 'pay.recalculated')
                }
              />
              <ReasonDialog
                open={cancelling}
                title={t('pay.cancelTitle')}
                confirmLabel={t('pay.cancelRun')}
                onClose={() => setCancelling(false)}
                onSubmit={async (reason) => {
                  await post(`/payroll/runs/${r.id}/cancel`, { reason });
                  toast(t('pay.cancelled'));
                  q.reload();
                }}
              />
            </>
          );
        }}
      </DataState>
    </div>
  );
}

function Inputs({ inputs }: { inputs: Record<string, number> }) {
  const { t } = useI18n();
  const items: [string, string][] = [
    ['pay.in.employed', t('pay.in.employedVal', { a: num(inputs.employedDays), b: num(inputs.periodDays) })],
    ['pay.in.scheduled', String(num(inputs.scheduledDays))],
    ['pay.in.worked', String(num(inputs.workedDays))],
    ['pay.in.absent', String(num(inputs.absentDays))],
    ['pay.in.leave', String(num(inputs.leaveDays))],
    ['pay.in.unpaid', String(num(inputs.unpaidLeaveDays))],
    ['pay.in.lateness', duration(t, inputs.latenessMinutes)],
    ['pay.in.overtime', duration(t, num(inputs.overtimeMinutes) + num(inputs.restDayOvertimeMinutes))],
    ['pay.in.pendingOt', duration(t, inputs.pendingOvertimeMinutes)],
  ];
  return (
    <dl className="grid grid-cols-3 gap-2 text-xs md:grid-cols-9">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-muted">{t(k)}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
