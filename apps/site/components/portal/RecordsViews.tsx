'use client';

import { useState } from 'react';
import { Alert, Badge, Bdi, Button, Card, EmptyState, Field, Input, Spinner, Table } from '@hf/ui';
import { bff, errorText } from '@/lib/bff';
import { dateOnly, money, pick } from '@/lib/format';
import { has, t, tDyn, type Locale } from '@/lib/i18n';
import type { PortalDocument, PortalInvoice, PortalPackage, PortalPrescription, PortalVisit } from '@/lib/types';
import { NoPatients, PatientSelect, PortalPage, usePatientName, usePortal } from './PortalShell';
import { useBffData } from './hooks';

function Loader<T>({ state, empty, children }: { state: { data: T[] | null; loading: boolean; error: unknown }; empty: string; children: (rows: T[]) => React.ReactNode }) {
  const { locale } = usePortal();
  if (state.loading && !state.data) return <Spinner label={t(locale, 'common.loading')} />;
  if (state.error) return <Alert>{errorText(locale, state.error)}</Alert>;
  if (!state.data?.length) return <EmptyState title={empty} />;
  return <>{children(state.data)}</>;
}

/** Binary downloads go through the BFF proxy, which streams the PDF with Cache-Control: no-store. */
function DownloadLink({ href, label, filename }: { href: string; label: string; filename: string }) {
  return (
    <a href={href} download={filename} className="btn-secondary btn-sm">
      {label}
    </a>
  );
}

export function PrescriptionsView() {
  const { locale } = usePortal();
  const name = usePatientName();
  const state = useBffData<PortalPrescription[]>('/api/portal/prescriptions', locale);
  return (
    <PortalPage title={t(locale, 'portal.nav.prescriptions')}>
      <Loader state={state} empty={t(locale, 'rx.empty')}>
        {(rows) => (
          <ul className="flex flex-col gap-3">
            {rows.map((rx) => (
              <li key={rx.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="num font-bold">{dateOnly(rx.issued_at)}</p>
                      <p className="text-sm text-muted">
                        {t(locale, 'rx.issuedBy', { doctor: pick(locale, rx.doctor_name_ar, rx.doctor_name_en) })}
                        {name(rx.patient_id) && (
                          <>
                            {' · '}
                            <Bdi>{name(rx.patient_id)}</Bdi>
                          </>
                        )}
                      </p>
                    </div>
                    <DownloadLink href={`/api/portal/prescriptions/${rx.id}/pdf`} filename={`prescription-${rx.id.slice(0, 8)}.pdf`} label={t(locale, 'rx.download')} />
                  </div>
                  {!!rx.lines?.length && (
                    <ul className="list-disc ps-5 text-sm">
                      {rx.lines.map((l, i) => (
                        <li key={i}>
                          <Bdi className="font-medium">{l.drug ?? ''}</Bdi> {pick(locale, l.instructionsAr, l.instructionsEn)}
                          {l.durationDays ? ` · ${t(locale, 'rx.days', { days: l.durationDays })}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Loader>
    </PortalPage>
  );
}

function asText(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v))
    return v
      .map((x) => {
        if (typeof x === 'string') return x;
        const o = (x ?? {}) as { display?: string; label?: string; name?: string; description?: string; code?: string };
        return o.display ?? o.label ?? o.name ?? o.description ?? o.code ?? '';
      })
      .filter(Boolean)
      .join(' · ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return [o.date, o.notes, o.instructions, o.inDays ? `${o.inDays}` : null].filter((x) => typeof x === 'string' || typeof x === 'number').join(' · ');
  }
  return String(v);
}

export function VisitsView() {
  const { locale } = usePortal();
  const name = usePatientName();
  const state = useBffData<PortalVisit[]>('/api/portal/visits', locale);
  return (
    <PortalPage title={t(locale, 'portal.nav.visits')}>
      <Loader state={state} empty={t(locale, 'visits.empty')}>
        {(rows) => (
          <ul className="flex flex-col gap-3">
            {rows.map((v) => (
              <li key={v.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="num font-bold">{dateOnly(v.signed_at)}</p>
                    <p className="text-sm text-muted">
                      <Bdi>{v.doctor_name_ar}</Bdi> · {v.clinic_name_ar}
                      {name(v.patient_id) && (
                        <>
                          {' · '}
                          <Bdi>{name(v.patient_id)}</Bdi>
                        </>
                      )}
                    </p>
                  </div>
                  {asText(v.diagnoses) && (
                    <p className="text-sm">
                      <span className="text-muted">{t(locale, 'visits.diagnoses')}: </span>
                      <span dir="auto">{asText(v.diagnoses)}</span>
                    </p>
                  )}
                  {v.patient_summary && (
                    <p dir="auto" className="whitespace-pre-line text-sm">
                      {v.patient_summary}
                    </p>
                  )}
                  {asText(v.follow_up) && (
                    <p className="text-sm">
                      <span className="text-muted">{t(locale, 'visits.followUp')}: </span>
                      <span dir="auto">{asText(v.follow_up)}</span>
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Loader>
    </PortalPage>
  );
}

export function DocumentsView() {
  const { locale, me } = usePortal();
  const name = usePatientName();
  const state = useBffData<PortalDocument[]>('/api/portal/documents', locale);
  const [openError, setOpenError] = useState<string | null>(null);

  async function open(id: string) {
    setOpenError(null);
    // Open the window synchronously so popup blockers allow it, then point it at the short-lived signed URL.
    const w = window.open('', '_blank');
    try {
      const r = await bff<{ url: string }>(`/api/portal/documents/${id}/url`);
      const u = new URL(r.url, window.location.href);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad url');
      if (w) {
        w.opener = null;
        w.location.href = u.toString();
      } else window.location.assign(u.toString());
    } catch (e) {
      w?.close();
      setOpenError(errorText(locale, e));
    }
  }

  return (
    <PortalPage title={t(locale, 'portal.nav.documents')}>
      {me.patients.length > 0 ? <UploadForm locale={locale} onUploaded={() => void state.reload()} /> : <NoPatients />}
      {openError && (
        <div className="my-3">
          <Alert>{openError}</Alert>
        </div>
      )}
      <div className="mt-6">
        <Loader state={state} empty={t(locale, 'documents.empty')}>
          {(rows) => (
            <Table>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span dir="auto" className="font-medium">
                        {d.title}
                      </span>
                      <div className="flex flex-wrap gap-2 text-xs text-muted">
                        <span className="num">{dateOnly(d.created_at)}</span>
                        {name(d.patient_id) && <Bdi>{name(d.patient_id)}</Bdi>}
                        {d.patient_provided && <Badge>{t(locale, 'documents.patientProvided')}</Badge>}
                      </div>
                    </td>
                    <td className="text-end">
                      <Button size="sm" variant="secondary" onClick={() => void open(d.id)}>
                        {t(locale, 'documents.view')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Loader>
      </div>
    </PortalPage>
  );
}

function UploadForm({ locale, onUploaded }: { locale: Locale; onUploaded: () => void }) {
  const { me } = usePortal();
  const [patientId, setPatientId] = useState(me.patients[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  return (
    <Card>
      <h2 className="mb-3 font-bold">{t(locale, 'documents.upload')}</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file || !patientId) return;
          setBusy(true);
          setMsg(null);
          const form = new FormData();
          form.set('patientId', patientId);
          form.set('title', title.trim() || file.name);
          form.set('file', file);
          try {
            await bff('/api/portal/documents', { form });
            setMsg({ tone: 'success', text: t(locale, 'documents.uploaded') });
            setTitle('');
            setFile(null);
            (e.target as HTMLFormElement).reset();
            onUploaded();
          } catch (err) {
            setMsg({ tone: 'danger', text: errorText(locale, err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <PatientSelect id="up-patient" value={patientId} onChange={setPatientId} />
        <Field label={t(locale, 'documents.title')} htmlFor="up-title">
          <Input id="up-title" dir="auto" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t(locale, 'documents.file')} htmlFor="up-file">
          <input id="up-file" type="file" required accept="application/pdf,image/jpeg,image/png,image/heic" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        </Field>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Button type="submit" disabled={busy || !file} className="self-start">
          {busy ? t(locale, 'common.loading') : t(locale, 'documents.upload')}
        </Button>
      </form>
    </Card>
  );
}

export function InvoicesView() {
  const { locale } = usePortal();
  const name = usePatientName();
  const state = useBffData<PortalInvoice[]>('/api/portal/invoices', locale);
  return (
    <PortalPage title={t(locale, 'portal.nav.invoices')}>
      <Loader state={state} empty={t(locale, 'invoices.empty')}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <th scope="col">{t(locale, 'invoices.number')}</th>
                <th scope="col">{t(locale, 'invoices.date')}</th>
                <th scope="col">{t(locale, 'common.total')}</th>
                <th scope="col">{t(locale, 'common.status')}</th>
                <th scope="col">
                  <span className="sr-only">{t(locale, 'common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Bdi className="num font-medium">{b.number}</Bdi>
                    <div className="text-xs text-muted">
                      {b.clinic_name_ar}
                      {name(b.patient_id) && (
                        <>
                          {' · '}
                          <Bdi>{name(b.patient_id)}</Bdi>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="num">{dateOnly(b.issued_at)}</td>
                  <td>
                    <span className="num font-bold">{money(b.total, locale)}</span>
                    <div className="text-xs text-muted">
                      {t(locale, 'invoices.paid')}: <span className="num">{money(b.paid, locale)}</span>
                    </div>
                  </td>
                  <td>
                    <Badge tone={b.status === 'paid' ? 'success' : b.status === 'partially_paid' || b.status === 'issued' ? 'warning' : 'neutral'}>{has(`billStatus.${b.status}`) ? tDyn(locale, `billStatus.${b.status}`) : b.status}</Badge>
                  </td>
                  <td className="text-end">
                    <DownloadLink href={`/api/portal/invoices/${b.id}/pdf`} filename={`invoice-${b.number}.pdf`} label={t(locale, 'invoices.download')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Loader>
    </PortalPage>
  );
}

export function PackagesView() {
  const { locale } = usePortal();
  const name = usePatientName();
  const state = useBffData<PortalPackage[]>('/api/portal/packages', locale);
  return (
    <PortalPage title={t(locale, 'portal.nav.packages')}>
      <Loader state={state} empty={t(locale, 'packages.empty')}>
        {(rows) => (
          <ul className="grid gap-3 sm:grid-cols-2">
            {rows.map((p) => {
              const pct = p.sessions_total ? Math.round((p.sessions_used / p.sessions_total) * 100) : 0;
              return (
                <li key={p.id}>
                  <Card className="flex flex-col gap-2">
                    <h2 className="font-bold">{pick(locale, p.name_ar, p.name_en)}</h2>
                    {name(p.patient_id) && <Bdi className="text-sm text-muted">{name(p.patient_id)}</Bdi>}
                    <div className="h-2 overflow-hidden rounded-full bg-bg" role="progressbar" aria-valuemin={0} aria-valuemax={p.sessions_total} aria-valuenow={p.sessions_used} aria-label={t(locale, 'packages.usage', { used: p.sessions_used, total: p.sessions_total })}>
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-sm">{t(locale, 'packages.usage', { used: p.sessions_used, total: p.sessions_total })}</p>
                    <p className="text-sm text-muted">
                      {t(locale, 'packages.expires')}: <span className="num">{dateOnly(p.expires_on)}</span>
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Loader>
    </PortalPage>
  );
}
