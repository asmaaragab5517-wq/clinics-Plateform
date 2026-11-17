'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Bdi, Button, Card, EmptyState, Field, Select, Spinner, Textarea } from '@hf/ui';
import { bff, errorText, newIdempotencyKey } from '@/lib/bff';
import { dateOnly, nameOf } from '@/lib/format';
import { has, t, tDyn, type Locale } from '@/lib/i18n';
import { COMPLAINT_CATEGORIES, type Clinic, type ComplaintCategory, type PortalComplaint } from '@/lib/types';
import { NoPatients, PortalPage, usePatientName, usePortal } from './PortalShell';
import { patientName, useBffData } from './hooks';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN = 5;
const MAX = 5000;

/** Patient voice: complaints go to the clinic manager's task list (and the pseudonymised ITQAN feed with consent). */
export function ComplaintView() {
  const { locale, me } = usePortal();
  const clinics = useBffData<Clinic[]>('/api/public/clinics', locale, { redirectOn401: false });
  const history = useBffData<PortalComplaint[]>('/api/portal/complaints', locale);
  const [patientId, setPatientId] = useState(me.patients[0]?.id ?? '');
  const [clinicId, setClinicId] = useState('');
  const [category, setCategory] = useState<ComplaintCategory | ''>('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [idem, setIdem] = useState(newIdempotencyKey);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  // Deep link from an appointment: ?clinic=<id>&patient=<id>.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const c = q.get('clinic');
    const p = q.get('patient');
    if (c && UUID.test(c)) setClinicId(c);
    if (p && me.patients.some((x) => x.id === p)) setPatientId(p);
  }, [me.patients]);

  // One clinic: nothing to choose.
  useEffect(() => {
    if (!clinicId && clinics.data?.length === 1) setClinicId(clinics.data[0]!.id);
  }, [clinics.data, clinicId]);

  const len = description.trim().length;
  const valid = !!patientId && !!clinicId && !!category && len >= MIN && len <= MAX;

  return (
    <PortalPage title={t(locale, 'complaint.title')}>
      <p className="mb-4 max-w-2xl text-sm text-muted">{t(locale, 'complaint.intro')}</p>
      {me.patients.length === 0 ? (
        <NoPatients />
      ) : (
        <Card className="max-w-2xl">
          <form
            className="flex flex-col gap-3"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (!valid || busy) return;
              setBusy(true);
              setMsg(null);
              try {
                await bff('/api/portal/complaints', { json: { clinicId, patientId, category, description: description.trim(), channel: 'portal' }, idempotencyKey: idem });
                setMsg({ tone: 'success', text: t(locale, 'complaint.submitted') });
                setDescription('');
                setCategory('');
                setIdem(newIdempotencyKey());
                void history.reload();
              } catch (err) {
                setMsg({ tone: 'danger', text: errorText(locale, err) });
              } finally {
                setBusy(false);
              }
            }}
          >
            {me.patients.length > 1 && (
              <Field label={t(locale, 'complaint.patient')} htmlFor="cmp-patient">
                <Select id="cmp-patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                  {me.patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {patientName(p, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t(locale, 'complaint.clinic')} htmlFor="cmp-clinic">
              {clinics.loading && !clinics.data ? (
                <Spinner label={t(locale, 'common.loading')} />
              ) : clinics.error ? (
                <Alert>{errorText(locale, clinics.error)}</Alert>
              ) : (
                <Select id="cmp-clinic" required value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
                  <option value="">{t(locale, 'complaint.chooseClinic')}</option>
                  {(clinics.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {nameOf(locale, c)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t(locale, 'complaint.category')} htmlFor="cmp-category">
              <Select id="cmp-category" required value={category} onChange={(e) => setCategory(e.target.value as ComplaintCategory | '')}>
                <option value="">{t(locale, 'complaint.chooseCategory')}</option>
                {COMPLAINT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(locale, `complaint.category.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t(locale, 'complaint.description')} htmlFor="cmp-desc">
              <Textarea id="cmp-desc" dir="auto" required rows={6} minLength={MIN} maxLength={MAX} value={description} onChange={(e) => setDescription(e.target.value)} aria-describedby="cmp-count" />
            </Field>
            <p id="cmp-count" className="num -mt-2 text-xs text-muted">
              {t(locale, 'complaint.descriptionHint', { min: MIN })} · {t(locale, 'complaint.count', { count: len, max: MAX })}
            </p>
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <Button type="submit" disabled={busy || !valid} className="self-start">
              {busy ? t(locale, 'common.loading') : t(locale, 'complaint.submit')}
            </Button>
          </form>
        </Card>
      )}
      <ComplaintHistory state={history} clinics={clinics.data} />
    </PortalPage>
  );
}

const STATUS_TONE: Record<string, 'neutral' | 'primary' | 'success' | 'warning'> = { open: 'warning', in_progress: 'primary', resolved: 'success', closed: 'neutral' };

function statusLabel(locale: Locale, status: string): string {
  return has(`complaint.status.${status}`) ? tDyn(locale, `complaint.status.${status}`) : status;
}

/** The patient's own complaints with their status and the clinic's resolution (GET /v1/portal/complaints). */
function ComplaintHistory({ state, clinics }: { state: { data: PortalComplaint[] | null; loading: boolean; error: unknown }; clinics: Clinic[] | null }) {
  const { locale } = usePortal();
  const name = usePatientName();
  return (
    <section aria-labelledby="cmp-history" className="mt-8 max-w-2xl">
      <h2 id="cmp-history" className="mb-3 text-lg font-bold">
        {t(locale, 'complaint.history')}
      </h2>
      {state.loading && !state.data ? (
        <Spinner label={t(locale, 'common.loading')} />
      ) : state.error ? (
        <Alert>{errorText(locale, state.error)}</Alert>
      ) : !state.data?.length ? (
        <EmptyState title={t(locale, 'complaint.historyEmpty')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {state.data.map((c) => {
            const clinic = clinics?.find((x) => x.id === c.clinic_id);
            return (
              <li key={c.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-bold">{has(`complaint.category.${c.category}`) ? tDyn(locale, `complaint.category.${c.category}`) : c.category}</p>
                      <p className="text-sm text-muted">
                        <span className="num">{dateOnly(c.created_at)}</span>
                        {clinic && ` · ${nameOf(locale, clinic)}`}
                        {name(c.patient_id) && (
                          <>
                            {' · '}
                            <Bdi>{name(c.patient_id)}</Bdi>
                          </>
                        )}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{statusLabel(locale, c.status)}</Badge>
                  </div>
                  <p dir="auto" className="line-clamp-4 whitespace-pre-line text-sm">
                    {c.description}
                  </p>
                  {c.resolution && (
                    <div className="rounded-lg bg-bg p-3 text-sm">
                      <p className="mb-1 font-medium">
                        {t(locale, 'complaint.resolution')}
                        {c.resolved_at && (
                          <>
                            {' · '}
                            <span className="num text-muted">{dateOnly(c.resolved_at)}</span>
                          </>
                        )}
                      </p>
                      <p dir="auto" className="whitespace-pre-line">
                        {c.resolution}
                      </p>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
