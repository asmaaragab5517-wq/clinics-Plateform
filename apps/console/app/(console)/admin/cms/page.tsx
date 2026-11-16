'use client';

import { useState } from 'react';
import { Alert, Badge, Bdi, Button, DateText, PageHeader, Table } from '@hf/ui';
import { Check, DataState, Section, SelectField, TextAreaField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useToast } from '@/components/toast';
import { patch, post } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Article {
  id: string;
  kind: 'article' | 'news' | 'page';
  slug: string;
  title_ar: string;
  title_en: string;
  body_ar: string;
  body_en: string;
  status: 'draft' | 'published';
  published_at: string | null;
  updated_at: string;
}

const blank = { kind: 'article', slug: '', titleAr: '', titleEn: '', bodyAr: '', bodyEn: '', publish: false };

/** FR-WEB-5: articles, news and static pages with ar/en versions and draft/publish. */
export default function CmsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const q = useApi<Article[]>('/articles');
  const [editing, setEditing] = useState<Article | null>(null);
  const [f, setF] = useState(blank);
  const a = useAction();
  const start = (x: Article | null) => {
    setEditing(x);
    setF(x ? { kind: x.kind, slug: x.slug, titleAr: x.title_ar, titleEn: x.title_en, bodyAr: x.body_ar, bodyEn: x.body_en, publish: x.status === 'published' } : blank);
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.cms')} actions={<Button onClick={() => start(null)}>{t('cms.new')}</Button>} />
      <div className="grid gap-4 xl:grid-cols-5">
        <Section title={t('nav.cms')} className="xl:col-span-2">
          <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('cms.title')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('cms.updated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.id} className="cursor-pointer" onClick={() => start(x)}>
                      <td>
                        {locale === 'en' ? x.title_en || x.title_ar : x.title_ar}
                        <Bdi className="block text-xs text-muted">{`${t(`cms.kind.${x.kind}`)} · /${x.slug}`}</Bdi>
                      </td>
                      <td>
                        <Badge tone={x.status === 'published' ? 'success' : 'neutral'}>{t(`cms.status.${x.status}`)}</Badge>
                      </td>
                      <td>
                        <DateText value={x.updated_at} locale={locale} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </DataState>
        </Section>
        <Section title={editing ? t('cms.edit') : t('cms.new')} className="xl:col-span-3">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await a.run(() =>
                editing
                  ? patch(`/articles/${editing.id}`, { titleAr: f.titleAr, titleEn: f.titleEn, bodyAr: f.bodyAr, bodyEn: f.bodyEn, status: f.publish ? 'published' : 'draft' })
                  : post('/articles', f),
              );
              if (r) {
                toast(t('common.saved'));
                q.reload();
              }
            }}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField label={t('cms.kindLabel')} value={f.kind} disabled={!!editing} onChange={(e) => setF({ ...f, kind: e.target.value })} options={['article', 'news', 'page'].map((k) => ({ value: k, label: t(`cms.kind.${k}`) }))} />
              <TextField label={t('staff.slug')} value={f.slug} disabled={!!editing} onChange={(e) => setF({ ...f, slug: e.target.value })} pattern="[a-z0-9-]{2,120}" required dir="ltr" />
              <TextField label={t('cms.titleAr')} value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} required dir="rtl" />
              <TextField label={t('cms.titleEn')} value={f.titleEn} onChange={(e) => setF({ ...f, titleEn: e.target.value })} dir="ltr" />
            </div>
            <TextAreaField label={t('cms.bodyAr')} value={f.bodyAr} onChange={(e) => setF({ ...f, bodyAr: e.target.value })} rows={10} dir="rtl" hint={t('cms.markdownHint')} />
            <TextAreaField label={t('cms.bodyEn')} value={f.bodyEn} onChange={(e) => setF({ ...f, bodyEn: e.target.value })} rows={6} dir="ltr" />
            <Check label={t('cms.publish')} checked={f.publish} onChange={(v) => setF({ ...f, publish: v })} />
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy} className="self-start">
              {t('common.save')}
            </Button>
          </form>
        </Section>
      </div>
    </div>
  );
}
