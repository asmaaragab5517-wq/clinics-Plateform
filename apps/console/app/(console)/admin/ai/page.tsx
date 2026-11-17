'use client';

import { useState } from 'react';
import { addDays } from '@hf/shared';
import { Alert, Badge, PageHeader, Stat, Table } from '@hf/ui';
import type { AiSettings } from '@/components/ai';
import { Check, DataState, Section, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { put, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { num, todayCairo } from '@/lib/format';

interface UsageRow {
  kind: string;
  status: string;
  drafts: number;
  input_tokens: number | null;
  output_tokens: number | null;
}

/** AI assistance governance (BR-19): organisation switch, model and prompt version in use, and draft/token usage. */
export default function AiSettingsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const s = useApi<AiSettings>('/ai/settings');
  const [from, setFrom] = useState(addDays(todayCairo(), -30));
  const usage = useApi<UsageRow[]>(`/ai/usage${qs({ from })}`);
  const a = useAction();
  const totals = (usage.data ?? []).reduce((acc, r) => ({ drafts: acc.drafts + num(r.drafts), input: acc.input + num(r.input_tokens), output: acc.output + num(r.output_tokens) }), { drafts: 0, input: 0, output: 0 });
  const approved = (usage.data ?? []).filter((r) => r.status === 'approved').reduce((x, r) => x + num(r.drafts), 0);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.ai')} subtitle={t('aiAdmin.subtitle')} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Section title={t('aiAdmin.settings')}>
          <DataState loading={s.loading} error={s.error} data={s.data}>
            {(d) => (
              <div className="flex flex-col gap-3">
                <Check
                  label={t('aiAdmin.enable')}
                  hint={t('aiAdmin.enableHint')}
                  checked={d.enabled}
                  disabled={!can('settings:edit') || a.busy}
                  onChange={async (v) => {
                    const r = await a.run(() => put<{ enabled: boolean }>('/ai/settings', { enabled: v }));
                    if (r) {
                      s.setData({ ...d, enabled: r.enabled });
                      toast(r.enabled ? t('aiAdmin.enabled') : t('aiAdmin.disabled'));
                    }
                  }}
                />
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted">{t('aiAdmin.model')}</dt>
                  <dd>
                    <bdi dir="ltr" className="font-mono">
                      {d.model}
                    </bdi>
                  </dd>
                  <dt className="text-muted">{t('aiAdmin.promptVersion')}</dt>
                  <dd>
                    <bdi dir="ltr" className="font-mono">
                      {d.promptVersion}
                    </bdi>
                  </dd>
                  <dt className="text-muted">{t('aiAdmin.mode')}</dt>
                  <dd>{d.mode === 'fake' ? <Badge tone="warning">{t('aiAdmin.modeFake')}</Badge> : <Badge tone="success">{d.mode}</Badge>}</dd>
                </dl>
                {a.error && <Alert tone="danger">{a.error}</Alert>}
                <Alert tone="info">{t('aiAdmin.governance')}</Alert>
              </div>
            )}
          </DataState>
        </Section>
        <Section title={t('aiAdmin.usage')} className="xl:col-span-2" actions={<div className="w-44"><TextField label={t('common.from')} type="date" value={from} max={todayCairo()} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>}>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t('aiAdmin.drafts')} value={totals.drafts} />
            <Stat label={t('aiAdmin.approvalRate')} value={totals.drafts ? `${Math.round((approved / totals.drafts) * 100)}%` : '—'} />
            <Stat label={t('aiAdmin.inputTokens')} value={totals.input.toLocaleString('en')} />
            <Stat label={t('aiAdmin.outputTokens')} value={totals.output.toLocaleString('en')} />
          </div>
          <DataState loading={usage.loading} error={usage.error} data={usage.data} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('aiAdmin.kind')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('aiAdmin.drafts')}</th>
                    <th>{t('aiAdmin.inputTokens')}</th>
                    <th>{t('aiAdmin.outputTokens')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.kind}-${r.status}`}>
                      <td>{t(`aiAdmin.kinds.${r.kind}`)}</td>
                      <td>
                        <Badge tone={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'neutral'}>{t(`aiAdmin.status.${r.status}`)}</Badge>
                      </td>
                      <td className="num">{num(r.drafts)}</td>
                      <td className="num">{num(r.input_tokens).toLocaleString('en')}</td>
                      <td className="num">{num(r.output_tokens).toLocaleString('en')}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </DataState>
        </Section>
      </div>
    </div>
  );
}
