'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, DateText, PageHeader, Select, Table } from '@hf/ui';
import { DataState, Section, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { post, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';

/** Where to act on tasks raised by other modules. */
const TASK_LINKS: Record<string, string> = { complaint: '/quality/complaints', incident: '/quality/incidents', support_access: '/admin/support', coverage_verify: '/finance/insurance#pending-verification' };

/** Service-recovery tasks (low ratings), break-glass notices and shift variances for the manager. */
export default function TasksPage() {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState('open');
  const q = useApi<{ id: string; kind: string; title: string; status: string; created_at: string; assignee_role: string | null }[]>(`/tasks${qs({ status })}`);
  const a = useAction();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.tasks')} />
      <Section
        title={t('nav.tasks')}
        actions={
          <Select className="h-8 w-32" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')}>
            <option value="open">{t('task.open')}</option>
            <option value="done">{t('task.done')}</option>
          </Select>
        }
      >
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('task.kind')}</th>
                  <th>{t('task.title')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <DateText value={x.created_at} locale={locale} withTime />
                    </td>
                    <td>
                      <Badge tone={x.kind === 'break_glass' ? 'danger' : 'warning'}>{t(`task.kinds.${x.kind}`)}</Badge>
                    </td>
                    <td dir="auto">
                      {x.title}
                      {TASK_LINKS[x.kind] && (
                        <Link className="ms-2 text-xs underline" href={TASK_LINKS[x.kind]!}>
                          {t('task.open')}
                        </Link>
                      )}
                    </td>
                    <td>
                      {x.status === 'open' && (
                        <Button size="sm" variant="secondary" onClick={() => void a.run(() => post(`/tasks/${x.id}/done`)).then((r) => r && q.reload())}>
                          {t('task.markDone')}
                        </Button>
                      )}
                    </td>
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
