'use client';

import { useState } from 'react';
import { Alert, Badge, Bdi, Button, Dialog, Input, Select } from '@hf/ui';
import { ApiError, post, qs, reauthenticate } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import { translate } from '@/lib/i18n';
import { Check, FileLink, Section, TextField, useAction } from './common';
import { useI18n } from './i18n';
import { useToast } from './toast';

interface Drug {
  id: string;
  trade_name_en: string;
  trade_name_ar: string | null;
  active_ingredients: string[];
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
}

interface Line {
  drugId?: string;
  drugLabel?: string;
  freeText?: string;
  dose: string;
  route: string;
  frequency: string;
  durationDays?: number;
  quantity?: string;
  instructionsAr: string;
  instructionsEn: string;
}

interface Warning {
  line: number;
  kind: 'allergy' | 'duplicate_ingredient' | 'free_text';
  detail: string;
}

export interface RxSummary {
  id: string;
  status: 'draft' | 'issued' | 'revoked';
  verify_code: string;
  issued_at: string | null;
}

/** Arabic frequency presets (FR-RX-2) live in the catalogue; the Arabic wording is what prints on the prescription. */
export const FREQ_PRESETS = ['rx.freq.once', 'rx.freq.twiceAfterMeals', 'rx.freq.thriceAfterMeals', 'rx.freq.every8h', 'rx.freq.every12h', 'rx.freq.beforeBreakfast', 'rx.freq.atBedtime', 'rx.freq.asNeeded', 'rx.freq.weekly'];
const ROUTES = ['oral', 'topical', 'inhalation', 'injection_im', 'injection_iv', 'subcutaneous', 'eye', 'ear', 'nasal', 'rectal', 'vaginal'];

const blank = (): Line => ({ dose: '', route: 'oral', frequency: translate('ar', 'rx.freq.twiceAfterMeals'), instructionsAr: '', instructionsEn: '' });

function DrugPicker({ onPick }: { onPick: (d: Drug) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const r = useApi<Drug[]>(term.length >= 2 ? `/drugs${qs({ q: term })}` : null);
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('rx.searchDrug')} aria-label={t('rx.searchDrug')} dir="auto" />
      {term.length >= 2 && (r.data?.length ?? 0) > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-surface shadow-lg" role="listbox">
          {r.data!.map((d) => (
            <li key={d.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="w-full px-3 py-2 text-start text-sm hover:bg-bg"
                onClick={() => {
                  onPick(d);
                  setQ('');
                }}
              >
                <Bdi className="font-medium">{`${d.trade_name_en} ${d.strength ?? ''}`}</Bdi>
                {d.trade_name_ar && <Bdi className="ms-2 text-muted">{d.trade_name_ar}</Bdi>}
                <span className="block text-xs text-muted" dir="ltr">
                  {d.active_ingredients.join(' + ')} · {d.form}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PrescriptionBuilder({ encounterId, prescriptions, onChanged, editable, returnTo }: { encounterId: string; prescriptions: RxSummary[]; onChanged: () => void; editable: boolean; returnTo: string }) {
  const { t, locale, err } = useI18n();
  const toast = useToast();
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<{ id: string; warnings: Warning[] } | null>(null);
  const [ack, setAck] = useState(false);
  const [reauth, setReauth] = useState<null | (() => Promise<void>)>(null);
  const [tplName, setTplName] = useState('');
  const templates = useApi<{ id: string; name: string; lines: Line[] }[]>(editable ? '/prescription-templates' : null);
  const a = useAction();

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const payload = () => ({
    notes: notes.trim() || undefined,
    lines: lines
      .filter((l) => l.drugId || l.freeText?.trim())
      .map((l) => ({ drugId: l.drugId, freeText: l.drugId ? undefined : l.freeText?.trim(), dose: l.dose, route: l.route, frequency: l.frequency, durationDays: l.durationDays || undefined, quantity: l.quantity || undefined, instructionsAr: l.instructionsAr, instructionsEn: l.instructionsEn })),
  });

  async function issue(id: string, acknowledge: boolean) {
    try {
      await post(`/prescriptions/${id}/issue`, { acknowledgeWarnings: acknowledge });
      toast(t('rx.issued'));
      setDraft(null);
      setLines([blank()]);
      setNotes('');
      setAck(false);
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'reauthentication_required') {
        setReauth(() => async () => {
          if (await reauthenticate(returnTo)) await issue(id, acknowledge);
        });
        return;
      }
      if (e instanceof ApiError && e.code === 'warnings_not_acknowledged') {
        setDraft({ id, warnings: draft?.warnings ?? [{ line: 0, kind: 'allergy', detail: t('rx.reviewWarnings') }] });
      }
      toast(err(e), 'danger');
    }
  }

  return (
    <Section title={t('rx.title')}>
      <div className="flex flex-col gap-4">
        {prescriptions.length > 0 && (
          <ul className="flex flex-col gap-2">
            {prescriptions.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                <span className="flex items-center gap-2">
                  <Badge tone={p.status === 'issued' ? 'success' : p.status === 'revoked' ? 'danger' : 'warning'}>{t(`rx.status.${p.status}`)}</Badge>
                  <Bdi className="num text-xs text-muted">{p.verify_code.slice(0, 8)}</Bdi>
                </span>
                <span className="flex gap-2">
                  {p.status === 'issued' && (
                    <>
                      <FileLink href={`/prescriptions/${p.id}/pdf?size=A5`}>{t('rx.printA5')}</FileLink>
                      <FileLink href={`/prescriptions/${p.id}/pdf?size=A4`}>{t('rx.printA4')}</FileLink>
                    </>
                  )}
                  {p.status === 'draft' && editable && (
                    <Button size="sm" onClick={() => void issue(p.id, false)}>
                      {t('rx.issue')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {editable && !draft && (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const body = payload();
              if (!body.lines.length) {
                a.setError(t('rx.noLines'));
                return;
              }
              const r = await a.run(() => post<{ id: string; warnings: Warning[] }>(`/encounters/${encounterId}/prescriptions`, body));
              if (r) {
                setDraft(r);
                onChanged();
                if (!r.warnings.some((w) => w.kind !== 'free_text')) void issue(r.id, false);
              }
            }}
          >
            {(templates.data?.length ?? 0) > 0 && (
              <label className="flex items-center gap-2 text-sm">
                {t('rx.template')}
                <Select
                  className="h-8 w-64"
                  value=""
                  onChange={(e) => {
                    const tpl = templates.data?.find((x) => x.id === e.target.value);
                    if (tpl) setLines(tpl.lines.map((l) => ({ ...blank(), ...l })));
                  }}
                >
                  <option value="">{t('form.choose')}</option>
                  {templates.data!.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {lines.map((l, i) => (
              <fieldset key={i} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                <legend className="px-1 text-sm font-medium">{t('rx.line', { n: i + 1 })}</legend>
                {l.drugId ? (
                  <div className="flex items-center justify-between text-sm">
                    <Bdi className="font-medium">{l.drugLabel}</Bdi>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setLine(i, { drugId: undefined, drugLabel: undefined })}>
                      {t('common.change')}
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    <DrugPicker onPick={(d) => setLine(i, { drugId: d.id, drugLabel: `${d.trade_name_en} ${d.strength ?? ''}`.trim(), freeText: undefined })} />
                    <Input value={l.freeText ?? ''} onChange={(e) => setLine(i, { freeText: e.target.value })} placeholder={t('rx.freeText')} aria-label={t('rx.freeText')} dir="auto" />
                  </div>
                )}
                <div className="grid gap-2 md:grid-cols-4">
                  <TextField label={t('rx.dose')} value={l.dose} onChange={(e) => setLine(i, { dose: e.target.value })} required dir="auto" />
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {t('rx.route')}
                    <Select value={l.route} onChange={(e) => setLine(i, { route: e.target.value })}>
                      {ROUTES.map((r) => (
                        <option key={r} value={r}>
                          {t(`rx.routes.${r}`)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <TextField label={t('rx.duration')} type="number" min={1} max={365} value={l.durationDays ?? ''} onChange={(e) => setLine(i, { durationDays: e.target.value ? Number(e.target.value) : undefined })} />
                  <TextField label={t('rx.quantity')} value={l.quantity ?? ''} onChange={(e) => setLine(i, { quantity: e.target.value })} dir="auto" />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {t('rx.frequencyPreset')}
                    <Select value={FREQ_PRESETS.find((k) => translate('ar', k) === l.frequency) ?? ''} onChange={(e) => e.target.value && setLine(i, { frequency: translate('ar', e.target.value) })}>
                      <option value="">{t('rx.custom')}</option>
                      {FREQ_PRESETS.map((k) => (
                        <option key={k} value={k}>
                          {t(k)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <TextField label={t('rx.frequency')} value={l.frequency} onChange={(e) => setLine(i, { frequency: e.target.value })} required dir="rtl" lang="ar" />
                  <TextField label={t('rx.instructionsAr')} value={l.instructionsAr} onChange={(e) => setLine(i, { instructionsAr: e.target.value })} dir="rtl" lang="ar" />
                  <TextField label={t('rx.instructionsEn')} value={l.instructionsEn} onChange={(e) => setLine(i, { instructionsEn: e.target.value })} dir="ltr" lang="en" />
                </div>
                {lines.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" className="self-end" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    {t('common.remove')}
                  </Button>
                )}
              </fieldset>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => setLines([...lines, blank()])}>
                {t('rx.addLine')}
              </Button>
              <Input className="h-10 w-48" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder={t('rx.templateName')} aria-label={t('rx.templateName')} />
              <Button
                type="button"
                variant="ghost"
                disabled={tplName.trim().length < 2}
                onClick={async () => {
                  const r = await a.run(() => post('/prescription-templates', { name: tplName.trim(), lines: payload().lines }));
                  if (r) {
                    toast(t('rx.templateSaved'));
                    setTplName('');
                    templates.reload();
                  }
                }}
              >
                {t('rx.saveTemplate')}
              </Button>
            </div>
            <TextField label={t('rx.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" />
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy} className="self-start">
              {t('rx.createAndIssue')}
            </Button>
          </form>
        )}
        {draft && (
          <div className="flex flex-col gap-3 rounded-xl border border-warning/40 p-3">
            <Alert tone="warning">{t('rx.warningsTitle')}</Alert>
            <ul className="flex flex-col gap-1 text-sm">
              {draft.warnings.map((w, i) => (
                <li key={i}>
                  <Badge tone={w.kind === 'allergy' ? 'danger' : 'warning'}>{t(`rx.warn.${w.kind}`)}</Badge> {t('rx.line', { n: w.line + 1 })}: <bdi dir="ltr">{w.detail}</bdi>
                </li>
              ))}
            </ul>
            <Check label={t('rx.acknowledge')} checked={ack} onChange={setAck} />
            <div className="flex gap-2">
              <Button disabled={!ack} onClick={() => void issue(draft.id, true)}>
                {t('rx.issue')}
              </Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>
                {t('rx.keepDraft')}
              </Button>
            </div>
          </div>
        )}
        <p className="text-xs text-muted">{t('rx.interactionsNote', { locale })}</p>
      </div>
      <ReauthDialog action={reauth} onClose={() => setReauth(null)} />
    </Section>
  );
}

export function ReauthDialog({ action, onClose }: { action: null | (() => Promise<void>); onClose: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={!!action} onClose={onClose} title={t('reauth.title')}>
      <div className="flex flex-col gap-3">
        <p className="text-sm">{t('reauth.body')}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (!action) return;
              setBusy(true);
              try {
                await action();
              } finally {
                setBusy(false);
                onClose();
              }
            }}
          >
            {t('reauth.continue')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
