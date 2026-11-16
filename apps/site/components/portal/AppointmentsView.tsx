'use client';

import { useState } from 'react';
import { Alert, Bdi, Button, Card, Dialog, EmptyState, Field, Spinner, StatusBadge, Tabs, Textarea } from '@hf/ui';
import { BffError, bff, errorText } from '@/lib/bff';
import { dateTime, pick } from '@/lib/format';
import { t, type Locale } from '@/lib/i18n';
import type { PortalAppointment, QueueInfo, Slot } from '@/lib/types';
import { SlotPicker } from './SlotPicker';
import { NoPatients, PortalPage, usePatientName, usePortal } from './PortalShell';
import { mmss, useBffData, useNow } from './hooks';

type Scope = 'upcoming' | 'past';
type DialogState = { kind: 'cancel' | 'reschedule' | 'rate'; appt: PortalAppointment } | null;

function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) ? u.toString() : null;
  } catch {
    return null;
  }
}

export function AppointmentsView() {
  const { locale, me } = usePortal();
  const [scope, setScope] = useState<Scope>('upcoming');
  const { data, loading, error, reload } = useBffData<PortalAppointment[]>(`/api/portal/appointments?scope=${scope}`, locale);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rated, setRated] = useState<Set<string>>(new Set());

  const done = (msg: string) => {
    setDialog(null);
    setNotice(msg);
    void reload();
  };

  return (
    <PortalPage
      title={t(locale, 'portal.nav.appointments')}
      actions={
        <a href={`/${locale}/book`} className="btn-primary btn-sm">
          {t(locale, 'nav.book')}
        </a>
      }
    >
      {me.patients.length === 0 && (
        <div className="mb-4">
          <NoPatients />
        </div>
      )}
      <Tabs<Scope>
        value={scope}
        onChange={(v) => {
          setNotice(null);
          setScope(v);
        }}
        items={[
          { value: 'upcoming', label: t(locale, 'appt.upcoming') },
          { value: 'past', label: t(locale, 'appt.past') },
        ]}
      />
      <div role="tabpanel" className="mt-4 flex flex-col gap-3">
        {notice && <Alert tone="success">{notice}</Alert>}
        {loading && !data ? (
          <Spinner label={t(locale, 'common.loading')} />
        ) : error ? (
          <Alert>{errorText(locale, error)}</Alert>
        ) : !data?.length ? (
          <EmptyState title={t(locale, scope === 'upcoming' ? 'appt.noUpcoming' : 'appt.noPast')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {data.map((a) => (
              <li key={a.id}>
                <AppointmentCard locale={locale} a={a} past={scope === 'past'} rated={rated.has(a.id)} onAction={(kind) => setDialog({ kind, appt: a })} onDone={done} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={dialog?.kind === 'cancel'} onClose={() => setDialog(null)} title={t(locale, 'appt.cancelTitle')}>
        {dialog?.kind === 'cancel' && <CancelForm locale={locale} a={dialog.appt} onDone={() => done(t(locale, 'appt.cancelled'))} />}
      </Dialog>
      <Dialog open={dialog?.kind === 'reschedule'} onClose={() => setDialog(null)} title={t(locale, 'appt.rescheduleTitle')}>
        {dialog?.kind === 'reschedule' && <RescheduleForm locale={locale} a={dialog.appt} onDone={() => done(t(locale, 'appt.rescheduled'))} />}
      </Dialog>
      <Dialog open={dialog?.kind === 'rate'} onClose={() => setDialog(null)} title={t(locale, 'review.title')}>
        {dialog?.kind === 'rate' && (
          <RateForm
            locale={locale}
            a={dialog.appt}
            onDone={() => {
              setRated((s) => new Set(s).add(dialog.appt.id));
              done(t(locale, 'review.thanks'));
            }}
          />
        )}
      </Dialog>
    </PortalPage>
  );
}

function AppointmentCard({ locale, a, past, rated, onAction, onDone }: { locale: Locale; a: PortalAppointment; past: boolean; rated: boolean; onAction: (k: 'cancel' | 'reschedule' | 'rate') => void; onDone: (msg: string) => void }) {
  const patientName = usePatientName();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkout = safeUrl(a.checkout_url);
  const holdLeft = a.hold_expires_at ? new Date(a.hold_expires_at).getTime() - now : 0;
  const active = !past && !['cancelled', 'completed', 'no_show'].includes(a.status);
  const inClinic = a.status === 'checked_in' || a.status === 'in_consultation';

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await bff(`/api/portal/appointments/${a.id}/confirm`, { method: 'POST', json: {} });
      onDone(t(locale, 'appt.confirmed'));
    } catch (e) {
      setError(errorText(locale, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold">
            <Bdi>{pick(locale, a.doctor_name_ar, a.doctor_name_en)}</Bdi>
          </p>
          <p className="text-sm text-muted">{pick(locale, a.clinic_name_ar, a.clinic_name_en)}</p>
          <p className="num mt-1 font-medium">{dateTime(a.start_at, locale)}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm">
          <StatusBadge status={a.status} locale={locale} />
          <span className="text-muted">
            {t(locale, 'appt.ref')}: <Bdi className="num">{a.ref}</Bdi>
          </span>
          {patientName(a.patient_id) && <Bdi className="text-muted">{patientName(a.patient_id)}</Bdi>}
        </div>
      </div>

      {active && a.status === 'requested' && checkout && holdLeft > 0 && (
        <Alert tone="warning">
          {t(locale, 'booking.holdCountdown', { time: '' })}
          <span className="num font-bold">{mmss(holdLeft)}</span>
        </Alert>
      )}
      {inClinic && <QueueStatus locale={locale} a={a} />}
      {error && <Alert>{error}</Alert>}

      <div className="flex flex-wrap gap-2">
        {active && a.status === 'requested' && checkout && holdLeft > 0 && (
          <a href={checkout} className="btn-primary btn-sm">
            {t(locale, 'appt.payNow')}
          </a>
        )}
        {active && a.status === 'booked' && (
          <Button size="sm" onClick={() => void confirm()} disabled={busy}>
            {t(locale, 'appt.confirm')}
          </Button>
        )}
        {active && !inClinic && (
          <>
            <Button size="sm" variant="secondary" onClick={() => onAction('reschedule')}>
              {t(locale, 'appt.reschedule')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onAction('cancel')}>
              {t(locale, 'appt.cancel')}
            </Button>
          </>
        )}
        {active && a.status !== 'requested' && (
          <a href={`/api/portal/appointments/${a.id}/calendar.ics`} download={`${a.ref}.ics`} className="btn-secondary btn-sm">
            {t(locale, 'appt.calendar')}
          </a>
        )}
        {past && a.status === 'completed' && !rated && (
          <Button size="sm" variant="secondary" onClick={() => onAction('rate')}>
            {t(locale, 'appt.rate')}
          </Button>
        )}
      </div>
    </Card>
  );
}

function QueueStatus({ locale, a }: { locale: Locale; a: PortalAppointment }) {
  const { data, loading, reload } = useBffData<QueueInfo>(`/api/portal/appointments/${a.id}/queue`, locale);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-bg p-3 text-sm" aria-live="polite">
      {loading && !data ? (
        <Spinner label={t(locale, 'common.loading')} />
      ) : data ? (
        <>
          <span className="font-bold">{t(locale, 'appt.ticket', { ticket: data.ticketNumber })}</span>
          {data.position !== null && <span>{t(locale, 'appt.queuePosition', { position: data.position })}</span>}
          {data.nowServing !== null && <span className="text-muted">{t(locale, 'appt.nowServing', { ticket: data.nowServing })}</span>}
        </>
      ) : a.ticket_number !== null ? (
        <span className="font-bold">{t(locale, 'appt.ticket', { ticket: a.ticket_number })}</span>
      ) : null}
      <button type="button" className="link" onClick={() => void reload()}>
        {t(locale, 'appt.refreshQueue')}
      </button>
    </div>
  );
}

function CancelForm({ locale, a, onDone }: { locale: Locale; a: PortalAppointment; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await bff(`/api/portal/appointments/${a.id}/cancel`, { json: { reason: reason.trim() } });
          onDone();
        } catch (err) {
          setError(errorText(locale, err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm">
        <Bdi>{pick(locale, a.doctor_name_ar, a.doctor_name_en)}</Bdi> · <span className="num">{dateTime(a.start_at, locale)}</span>
      </p>
      <Field label={t(locale, 'appt.cancelReason')} htmlFor="cancel-reason">
        <Textarea id="cancel-reason" required minLength={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" variant="danger" disabled={busy || reason.trim().length < 2}>
        {t(locale, 'appt.cancelSubmit')}
      </Button>
    </form>
  );
}

function RescheduleForm({ locale, a, onDone }: { locale: Locale; a: PortalAppointment; onDone: () => void }) {
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
      <SlotPicker locale={locale} doctorId={a.doctor_id} clinicId={a.clinic_id} value={slot?.start} onChange={setSlot} />
      {error && <Alert>{error}</Alert>}
      <Button
        disabled={!slot || busy}
        onClick={async () => {
          if (!slot) return;
          setBusy(true);
          setError(null);
          try {
            await bff(`/api/portal/appointments/${a.id}/reschedule`, { json: { start: slot.start } });
            onDone();
          } catch (e) {
            setError(errorText(locale, e instanceof BffError && e.status === 409 ? new BffError('slot_unavailable', 409) : e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {slot ? `${t(locale, 'common.confirm')} · ${dateTime(slot.start, locale)}` : t(locale, 'common.confirm')}
      </Button>
    </div>
  );
}

function RateForm({ locale, a, onDone }: { locale: Locale; a: PortalAppointment; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!rating) return;
        setBusy(true);
        setError(null);
        try {
          await bff('/api/portal/reviews', { json: { appointmentId: a.id, rating, ...(comment.trim() ? { comment: comment.trim() } : {}) } });
          onDone();
        } catch (err) {
          setError(errorText(locale, err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t(locale, 'review.rating')}</legend>
        <div className="flex gap-1" dir="ltr">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer rounded has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent">
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />
              <span aria-hidden className={n <= rating ? 'text-3xl text-warning' : 'text-3xl text-border'}>
                ★
              </span>
              <span className="sr-only">{t(locale, 'review.star', { count: n })}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={`${t(locale, 'review.comment')} (${t(locale, 'site.optional')})`} htmlFor="rate-comment">
        <Textarea id="rate-comment" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" disabled={busy || !rating}>
        {t(locale, 'site.submit')}
      </Button>
    </form>
  );
}
