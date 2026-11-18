'use client';

import { Fragment, useState } from 'react';
import { Badge, Button, Money, PageHeader, Table } from '@hf/ui';
import { DataState, FileLink, Section } from '@/components/common';
import { PayslipLines } from '@/components/hr';
import { useI18n } from '@/components/i18n';
import { useApi } from '@/lib/hooks';
import { num } from '@/lib/format';
import { RUN_TONE, fmtMonth, type PayslipLine } from '@/lib/hr';

interface MyPayslip {
  id: string;
  month: string;
  status: 'approved' | 'paid';
  gross: number;
  deductions: number;
  net: number;
  lines: PayslipLine[];
}

/** Every staff member's own payslips from approved or paid payroll runs. */
export default function MyPayslipsPage() {
  const { t, locale } = useI18n();
  const q = useApi<MyPayslip[]>('/payroll/me/payslips');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.myPayslips')} subtitle={t('pay.my.subtitle')} />
      <Section title={t('nav.myPayslips')}>
        <DataState loading={q.loading} error={q.error} data={q.data}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-sm text-muted">{t('pay.my.none')}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>{t('hr.month')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('pay.gross')}</th>
                    <th>{t('pay.deductions')}</th>
                    <th>{t('pay.net')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <Fragment key={p.id}>
                      <tr>
                        <td className="num font-medium">{fmtMonth(p.month)}</td>
                        <td>
                          <Badge tone={RUN_TONE[p.status]}>{t(`pay.my.status.${p.status}`)}</Badge>
                        </td>
                        <td>
                          <Money value={num(p.gross)} locale={locale} />
                        </td>
                        <td>
                          <Money value={num(p.deductions)} locale={locale} />
                        </td>
                        <td className="font-bold">
                          <Money value={num(p.net)} locale={locale} />
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="ghost" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                              {open === p.id ? t('pay.hideDetails') : t('pay.showDetails')}
                            </Button>
                            <FileLink href={`/payroll/payslips/${p.id}/pdf`}>{t('pay.pdf')}</FileLink>
                          </div>
                        </td>
                      </tr>
                      {open === p.id && (
                        <tr>
                          <td colSpan={6} className="bg-bg/50">
                            <PayslipLines lines={p.lines} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </Table>
            )
          }
        </DataState>
      </Section>
    </div>
  );
}
