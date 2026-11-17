'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Bdi, Button, Spinner } from '@hf/ui';
import { BffError, bff, errorText } from '@/lib/bff';
import { dateTime } from '@/lib/format';
import { has, t, tDyn, type Locale } from '@/lib/i18n';
import type { ConsentState, ConsentVersion, PortalAppointment, TelemedicineJoin, TelemedicineStatus } from '@/lib/types';
import { useBffData, useNow } from './hooks';

const JOINABLE = ['booked', 'confirmed', 'checked_in', 'in_consultation'];

/** Only https meeting links (or http on localhost in development) are opened. */
function safeMeetingUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "2 days 03:04:05" style countdown; days only when more than 24 hours remain. */
function countdown(ms: number, locale: Locale): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hms = [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
  return d > 0 ? `${t(locale, 'video.days', { count: d })} ${hms}` : hms;
}

/**
 * FR-TEL-4 video visit card. Renders nothing for in-clinic appointments (the API answers 400 not_a_video_consultation),
 * because the appointment list does not say which appointments are video consultations.
 */
export function VideoVisit({ locale, a }: { locale: Locale; a: PortalAppointment }) {
  const st = useBffData<TelemedicineStatus>(`/api/portal/appointments/${encodeURIComponent(a.id)}/telemedicine`, locale);
  if (!st.data) {
    if (st.error instanceof BffError && st.error.status >= 500) return <Alert tone="warning">{errorText(locale, st.error)}</Alert>;
    return null;
  }
  return <VideoVisitCard locale={locale} a={a} status={st.data} reload={st.reload} />;
}

function VideoVisitCard({ locale, a, status, reload }: { locale: Locale; a: PortalAppointment; status: TelemedicineStatus; reload: () => Promise<void> }) {
  const now = useNow();
  const consents = useBffData<{ versions: ConsentVersion[]; consents: ConsentState[] }>('/api/portal/consents', locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentRequired, setConsentRequired] = useState(false);
  const [joined, setJoined] = useState<(TelemedicineJoin & { safeUrl: string | null }) | null>(null);

  const opens = new Date(status.opensAt).getTime();
  const closes = new Date(status.closesAt).getTime();
  const before = now < opens;
  const after = now > closes;
  const joinable = JOINABLE.includes(a.status) && status.status !== 'ended' && status.status !== 'cancelled';
  const open = !before && !after && joinable;

  // Re-check with the API the moment the waiting room opens (canJoin is the server's view of the same window).
  const wasBefore = useRef(before);
  useEffect(() => {
    if (wasBefore.current && !before) void reload();
    wasBefore.current = before;
  }, [before, reload]);

  const latest = consents.data?.consents.find((c) => c.patient_id === a.patient_id && c.type === 'telemedicine');
  const consentMissing = consentRequired || (!!consents.data && !latest?.granted);
  const consentHref = `/${locale}/portal/privacy?patient=${encodeURIComponent(a.patient_id)}#consent-telemedicine`;

  async function join() {
    setBusy(true);
    setError(null);
    // Open the tab synchronously so popup blockers allow it, then point it at the meeting.
    const w = window.open('', '_blank');
    try {
      const r = await bff<TelemedicineJoin>(`/api/portal/appointments/${encodeURIComponent(a.id)}/telemedicine/join`, { method: 'POST', json: {} });
      const url = safeMeetingUrl(r.url);
      setJoined({ ...r, safeUrl: url });
      if (url && w) {
        w.opener = null;
        w.location.href = url;
      } else w?.close();
      void reload();
    } catch (e) {
      w?.close();
      if (e instanceof BffError && e.code === 'telemedicine_consent_required') {
        setConsentRequired(true);
        void consents.reload();
      } else {
        if (e instanceof BffError && e.code === 'waiting_room_not_open') void reload();
        setError(errorText(locale, e));
      }
    } finally {
      setBusy(false);
    }
  }

  const provider = joined?.provider && has(`video.provider.${joined.provider}`) ? tDyn(locale, `video.provider.${joined.provider}`) : null;

  return (
    <section aria-label={t(locale, 'video.title')} className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-bold">
          <Badge tone="primary">{t(locale, 'booking.videoBadge')}</Badge>
          {t(locale, 'video.title')}
        </span>
        <span className="text-xs text-muted">
          {t(locale, 'video.opensAt')} <span className="num">{dateTime(status.opensAt, locale)}</span>
        </span>
      </div>

      {consents.loading && !consents.data ? <Spinner label={t(locale, 'common.loading')} /> : null}

      {consentMissing && (
        <Alert tone="warning">
          <span className="block">{t(locale, 'video.consentNeeded')}</span>
          <Link href={consentHref} className="link font-bold">
            {t(locale, 'video.reviewConsent')}
          </Link>
        </Alert>
      )}

      {!joinable ? (
        <p className="text-sm text-muted">{t(locale, status.status === 'ended' ? 'video.ended' : 'video.notJoinable')}</p>
      ) : before ? (
        <p className="text-sm">
          {t(locale, 'video.opensIn')}{' '}
          <span className="num font-bold" role="timer" aria-live="off">
            {countdown(opens - now, locale)}
          </span>
          <span className="block text-xs text-muted">{t(locale, 'video.opensNote')}</span>
        </p>
      ) : after ? (
        <p className="text-sm text-muted">{t(locale, 'video.closed')}</p>
      ) : (
        <p className="text-sm font-medium" aria-live="polite">
          {t(locale, 'video.openNow')}
        </p>
      )}

      {error && <Alert>{error}</Alert>}

      {joined && (
        <div className="flex flex-col gap-1 rounded-lg bg-surface p-3 text-sm" aria-live="polite">
          {joined.safeUrl ? (
            <a href={joined.safeUrl} target="_blank" rel="noopener noreferrer" className="link font-bold">
              {t(locale, 'video.openAgain')}
              <span className="sr-only"> ({t(locale, 'video.newTab')})</span>
            </a>
          ) : (
            <span className="text-danger">{t(locale, 'video.badLink')}</span>
          )}
          {joined.passcode && (
            <span>
              {t(locale, 'video.passcode')}: <Bdi className="num text-lg font-bold tracking-widest">{joined.passcode}</Bdi>
            </span>
          )}
          {provider && <span className="text-xs text-muted">{t(locale, 'video.provider', { provider })}</span>}
        </div>
      )}

      {joinable && !after && (
        <div>
          <Button type="button" size="sm" onClick={() => void join()} disabled={!open || busy || consentMissing}>
            {busy ? t(locale, 'video.joining') : t(locale, 'video.join')}
            <span className="sr-only"> ({t(locale, 'video.newTab')})</span>
          </Button>
        </div>
      )}
    </section>
  );
}
