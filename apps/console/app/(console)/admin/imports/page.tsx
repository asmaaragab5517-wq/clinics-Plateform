'use client';

import { useState } from 'react';
import { Alert, Badge, Button, DateText, PageHeader, Stat, Table } from '@hf/ui';
import { FileLink, Section, SelectField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { get, post, upload } from '@/lib/api';
import { useLocalState } from '@/lib/hooks';

const FIELDS: Record<string, string[]> = {
  patients: ['first_name_ar', 'father_name_ar', 'grandfather_name_ar', 'family_name_ar', 'name_en', 'national_id', 'date_of_birth', 'gender', 'phone', 'governorate', 'city', 'address'],
  services: ['code', 'name_ar', 'name_en', 'duration_minutes', 'type', 'vat'],
  prices: ['clinic_slug', 'service_code', 'price_egp', 'effective_from'],
};

interface Batch {
  id: string;
  entity: string;
  status: string;
  row_count: number;
  error_count: number;
  dry_run_report: { rows: number; valid: number; errors: number } | null;
  committed_at: string | null;
  created_at: string;
  rows: { row_number: number; errors: string[]; created_entity_id: string | null }[];
}

/** FR-IMP-2: template → upload with column mapping → validation preview (errors per row) → commit → rollback within 24 h. */
export default function ImportsPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const [entity, setEntity] = useState('patients');
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<Batch | null>(null);
  const [recent, setRecent] = useLocalState<{ id: string; entity: string; at: string }[]>('hf_imports', []);
  const a = useAction();

  async function load(id: string) {
    const b = await a.run(() => get<Batch>(`/imports/${id}`));
    if (b) setBatch(b);
  }

  const step = !batch ? 1 : batch.status === 'validated' ? 2 : 3;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.imports')} />
      <ol className="flex flex-wrap gap-2 text-sm" aria-label={t('imp.steps')}>
        {['imp.step.upload', 'imp.step.validate', 'imp.step.commit'].map((k, i) => (
          <li key={k} className={`rounded-full px-3 py-1 ${step === i + 1 ? 'bg-primary text-primary-fg' : 'bg-bg text-muted'}`} aria-current={step === i + 1 ? 'step' : undefined}>
            {i + 1}. {t(k)}
          </li>
        ))}
      </ol>
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      <div className="grid gap-4 xl:grid-cols-3">
        <Section title={t('imp.step.upload')} className="xl:col-span-1">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!file) return;
              const fd = new FormData();
              fd.set('file', file);
              fd.set('entity', entity);
              const m = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v.trim()));
              if (Object.keys(m).length) fd.set('mapping', JSON.stringify(m));
              const r = await a.run(() => upload<{ id: string; rows: number; valid: number; errors: number }>('/imports', fd));
              if (r) {
                setRecent([{ id: r.id, entity, at: new Date().toISOString() }, ...recent].slice(0, 10));
                toast(t('imp.validated', { valid: r.valid, rows: r.rows }));
                await load(r.id);
              }
            }}
          >
            <SelectField label={t('imp.entity')} value={entity} onChange={(e) => (setEntity(e.target.value), setMapping({}))} options={Object.keys(FIELDS).map((k) => ({ value: k, label: t(`imp.entities.${k}`) }))} />
            <FileLink href={`/imports/templates/${entity}`}>{t('imp.template')}</FileLink>
            <TextField label={t('imp.file')} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required hint={t('imp.fileHint')} />
            <details className="rounded-xl border border-border p-2">
              <summary className="cursor-pointer text-sm font-medium">{t('imp.mapping')}</summary>
              <p className="my-2 text-xs text-muted">{t('imp.mappingHint')}</p>
              <div className="flex flex-col gap-2">
                {FIELDS[entity]!.map((f) => (
                  <TextField key={f} label={f} value={mapping[f] ?? ''} placeholder={f} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })} dir="auto" />
                ))}
              </div>
            </details>
            <p className="text-xs text-muted">{t('imp.noUrls')}</p>
            <Button type="submit" disabled={a.busy || !file || !can('import:create')}>
              {t('imp.validate')}
            </Button>
          </form>
          {recent.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-1 text-sm font-medium">{t('imp.recent')}</p>
              <ul className="flex flex-col gap-1 text-sm">
                {recent.map((r) => (
                  <li key={r.id}>
                    <button className="underline" onClick={() => void load(r.id)}>
                      {t(`imp.entities.${r.entity}`)} · <DateText value={r.at} locale={locale} withTime />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
        <Section title={t('imp.preview')} className="xl:col-span-2">
          {!batch ? (
            <p className="text-sm text-muted">{t('imp.noBatch')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label={t('imp.rows')} value={batch.row_count} />
                <Stat label={t('imp.valid')} value={batch.dry_run_report?.valid ?? batch.row_count - batch.error_count} />
                <Stat label={t('imp.errors')} value={batch.error_count} />
                <Stat label={t('common.status')} value={<Badge tone={batch.status === 'committed' ? 'success' : batch.status === 'rolled_back' ? 'neutral' : 'warning'}>{t(`imp.status.${batch.status}`)}</Badge>} />
              </div>
              {batch.rows.filter((r) => r.errors.length).length > 0 && (
                <div className="max-h-80 overflow-y-auto">
                  <Table>
                    <thead>
                      <tr>
                        <th>{t('imp.rowNo')}</th>
                        <th>{t('imp.errors')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.rows
                        .filter((r) => r.errors.length)
                        .map((r) => (
                          <tr key={r.row_number}>
                            <td className="num">{r.row_number}</td>
                            <td className="text-xs" dir="ltr">
                              {r.errors.map((e) => t(`imp.err.${e}`) === `imp.err.${e}` ? e : t(`imp.err.${e}`)).join(' · ')}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </Table>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {batch.status === 'validated' && can('import:approve') && (
                  <Button
                    disabled={a.busy}
                    onClick={async () => {
                      const r = await a.run(() => post<{ created: number }>(`/imports/${batch.id}/commit`));
                      if (r) {
                        toast(t('imp.committed', { n: r.created }));
                        await load(batch.id);
                      }
                    }}
                  >
                    {t('imp.commit', { n: batch.row_count - batch.error_count })}
                  </Button>
                )}
                {batch.status === 'committed' && can('import:approve') && (
                  <Button
                    variant="danger"
                    disabled={a.busy}
                    onClick={async () => {
                      if (!window.confirm(t('imp.confirmRollback'))) return;
                      const r = await a.run(() => post<{ rolledBack: number }>(`/imports/${batch.id}/rollback`));
                      if (r) {
                        toast(t('imp.rolledBack', { n: r.rolledBack }));
                        await load(batch.id);
                      }
                    }}
                  >
                    {t('imp.rollback')}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setBatch(null)}>
                  {t('imp.newImport')}
                </Button>
              </div>
              {batch.status === 'committed' && <p className="text-xs text-muted">{t('imp.rollbackWindow')}</p>}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
