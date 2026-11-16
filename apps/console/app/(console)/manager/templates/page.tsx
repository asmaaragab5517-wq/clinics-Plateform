'use client';

import { useState } from 'react';
import { smsSegments, templateVariables } from '@hf/shared';
import { Alert, Badge, Button, PageHeader, Select, Table, Textarea } from '@hf/ui';
import { Check, DataState, Section, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { patch } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Template {
  id: string;
  event: string;
  channel: string;
  locale: 'ar' | 'en';
  body: string;
  is_enabled: boolean;
  provider_template_id: string | null;
  preview: { encoding: string; units: number; segments: number; perSegment: number; variables: string[] };
}

/** FR-COM-2: template per event × channel × language with live SMS segment preview (GSM-7 160/153, UCS-2 70/67). */
export default function TemplatesPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<Template[]>('/message-templates');
  const [sel, setSel] = useState<Template | null>(null);
  const [body, setBody] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [filter, setFilter] = useState('');
  const a = useAction();
  const seg = smsSegments(body);
  const vars = templateVariables(body);
  const allowed = sel ? sel.preview.variables : [];
  const unknown = vars.filter((v) => !allowed.includes(v));
  const pick = (x: Template) => {
    setSel(x);
    setBody(x.body);
    setEnabled(x.is_enabled);
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.templates')} />
      <div className="grid gap-4 xl:grid-cols-5">
        <Section
          title={t('tpl.list')}
          className="xl:col-span-3"
          actions={
            <Select className="h-8 w-28" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('msg.channel')}>
              <option value="">{t('tpl.allChannels')}</option>
              {['sms', 'whatsapp', 'email', 'push'].map((c) => (
                <option key={c} value={c}>
                  {t(`chan.${c}`)}
                </option>
              ))}
            </Select>
          }
        >
          <DataState loading={q.loading} error={q.error} data={q.data?.filter((x) => !filter || x.channel === filter)} empty={(d) => d.length === 0}>
            {(rows) => (
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <thead>
                    <tr>
                      <th>{t('msg.event')}</th>
                      <th>{t('msg.channel')}</th>
                      <th>{t('tpl.lang')}</th>
                      <th>{t('msg.segments')}</th>
                      <th>{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((x) => (
                      <tr key={x.id} className={`cursor-pointer ${sel?.id === x.id ? 'bg-primary/10' : ''}`} onClick={() => pick(x)}>
                        <td>{t(`event.${x.event}`)}</td>
                        <td>{t(`chan.${x.channel}`)}</td>
                        <td>{x.locale.toUpperCase()}</td>
                        <td className="num">{x.channel === 'sms' ? x.preview.segments : '—'}</td>
                        <td>{x.is_enabled ? <Badge tone="success">{t('common.active')}</Badge> : <Badge>{t('common.inactive')}</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </DataState>
        </Section>
        <Section title={t('tpl.edit')} className="xl:col-span-2">
          {!sel ? (
            <p className="text-sm text-muted">{t('tpl.pick')}</p>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await a.run(() => patch(`/message-templates/${sel.id}`, { body, isEnabled: enabled }));
                if (r) {
                  toast(t('common.saved'));
                  q.reload();
                }
              }}
            >
              <p className="text-sm">
                {t(`event.${sel.event}`)} · {t(`chan.${sel.channel}`)} · {sel.locale.toUpperCase()}
              </p>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} dir={sel.locale === 'ar' ? 'rtl' : 'ltr'} rows={5} aria-label={t('tpl.body')} readOnly={!can('settings:edit')} />
              {sel.channel === 'sms' && (
                <div className="rounded-xl bg-bg p-3 text-sm" aria-live="polite">
                  <p>{t('tpl.segments', { n: seg.segments, encoding: seg.encoding, units: seg.units, per: seg.perSegment })}</p>
                </div>
              )}
              <p className="text-xs text-muted">
                {t('tpl.variables')}: <span dir="ltr">{allowed.map((v) => `{{${v}}}`).join(' ')}</span>
              </p>
              {unknown.length > 0 && <Alert tone="danger">{t('tpl.unknownVars', { vars: unknown.join(', ') })}</Alert>}
              <Check label={t('tpl.enabled')} checked={enabled} onChange={setEnabled} />
              {a.error && <Alert tone="danger">{a.error}</Alert>}
              {can('settings:edit') && (
                <Button type="submit" disabled={a.busy || unknown.length > 0}>
                  {t('common.save')}
                </Button>
              )}
            </form>
          )}
        </Section>
      </div>
    </div>
  );
}
