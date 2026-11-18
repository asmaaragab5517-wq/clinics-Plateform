'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Bdi, Input, Money, PageHeader, Table } from '@hf/ui';
import { DataState, Section } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useApi } from '@/lib/hooks';
import { biName, num } from '@/lib/format';
import { fmtDay, patternDays, type HrStaffRow } from '@/lib/hr';


/** Staff with their employment contract summary (hr:view); pay columns appear only when the API returns them. */
export default function HrStaffPage() {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const q = useApi<HrStaffRow[]>('/hr/staff');
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const withPay = (q.data ?? []).some((r) => r.contract && r.contract.base_salary !== undefined);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.hrStaff')} subtitle={t('hr.staff.subtitle')} />
      <Section
        title={t('hr.staff.list')}
        actions={
          <>
            <div className="w-56">
              <Input className="!h-8 text-sm" placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('common.search')} />
            </div>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
              {t('hr.staff.onlyMissing')}
            </label>
          </>
        }
      >
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => {
            const s = search.trim().toLowerCase();
            const list = rows.filter((r) => (!onlyMissing || !r.contract) && (!s || `${r.name_ar} ${r.name_en} ${r.email ?? ''}`.toLowerCase().includes(s)));
            return (
              <Table>
                <thead>
                  <tr>
                    <th>{t('hr.person')}</th>
                    <th>{t('hr.jobTitle')}</th>
                    <th>{t('shell.clinic')}</th>
                    <th>{t('hr.contract.type')}</th>
                    <th>{t('hr.workPattern')}</th>
                    <th>{t('hr.contract.start')}</th>
                    {withPay && <th>{t('hr.contract.salary')}</th>}
                    <th>{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const c = r.contract;
                    return (
                      <tr key={r.id}>
                        <td>
                          <Link href={`/hr/staff/${r.id}`} className="font-medium text-primary hover:underline">
                            <Bdi>{biName(r, locale)}</Bdi>
                          </Link>
                          <span className="block text-xs text-muted">{r.roles.map((x) => t(`role.${x}`)).join(t('common.listSep'))}</span>
                        </td>
                        <td>{c ? (locale === 'en' ? c.job_title_en || c.job_title_ar : c.job_title_ar) : '—'}</td>
                        <td>{c ? biName(me.clinics.find((x) => x.id === c.clinic_id), locale) : '—'}</td>
                        <td className="text-xs">{c ? `${t(`hr.emp.${c.employment_type}`)} · ${t(`hr.basis.${c.pay_basis}`)}` : '—'}</td>
                        <td className="text-xs">{c ? `${patternDays(t, c.work_pattern)} · ${c.work_pattern.start}–${c.work_pattern.end}` : '—'}</td>
                        <td className="num">{c ? fmtDay(c.start_date) : '—'}</td>
                        {withPay && <td>{c?.base_salary !== undefined ? <Money value={num(c.base_salary)} locale={locale} /> : '—'}</td>}
                        <td>{c ? <Badge tone="success" className="whitespace-nowrap">{t('hr.contract.active')}</Badge> : <Badge tone="warning" className="whitespace-nowrap">{t('hr.contract.none')}</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            );
          }}
        </DataState>
      </Section>
    </div>
  );
}
