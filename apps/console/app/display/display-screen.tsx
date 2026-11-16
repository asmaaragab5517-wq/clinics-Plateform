'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTime12 } from '@hf/shared';
import { cx } from '@hf/ui';
import { useI18n } from '@/components/i18n';
import { useEventSource, useInterval } from '@/lib/hooks';
import { translate } from '@/lib/i18n';

interface DoctorState {
  doctorId: string;
  doctorName: string;
  nowServing: number | null;
  next: number[];
}

function chime(ctx: AudioContext) {
  const now = ctx.currentTime;
  for (const [i, f] of [880, 660].entries()) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, now + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.4, now + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start(now + i * 0.35);
    o.stop(now + i * 0.35 + 0.65);
  }
}

/** Ticket numbers only, never patient names. Live over SSE through the BFF; optional chime and Arabic announcement. */
export function DisplayScreen({ token }: { token: string }) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<DoctorState[] | null>(null);
  const [error, setError] = useState(false);
  const [sound, setSound] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [flash, setFlash] = useState<string | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const prev = useRef<Map<string, number | null>>(new Map());

  const apply = useCallback(
    (next: DoctorState[]) => {
      const changed = next.filter((d) => d.nowServing !== null && prev.current.has(d.doctorId) && prev.current.get(d.doctorId) !== d.nowServing);
      prev.current = new Map(next.map((d) => [d.doctorId, d.nowServing]));
      setState(next);
      if (!changed.length) return;
      setFlash(changed[0]!.doctorId);
      setTimeout(() => setFlash(null), 4000);
      if (!sound) return;
      if (audio.current) chime(audio.current);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        for (const d of changed) {
          const u = new SpeechSynthesisUtterance(translate('ar', 'disp.announce', { ticket: d.nowServing ?? '', doctor: d.doctorName }));
          u.lang = 'ar-EG';
          const voice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith('ar'));
          if (voice) u.voice = voice;
          window.speechSynthesis.speak(u);
        }
      }
    },
    [sound],
  );

  useEffect(() => {
    if (!token) return;
    fetch(`/api/display/state?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<DoctorState[]>) : Promise.reject(new Error(String(r.status)))))
      .then(apply, () => setError(true));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = useEventSource(token ? `/api/display/stream?token=${encodeURIComponent(token)}` : null, (msg) => {
    const m = msg as { type?: string; state?: DoctorState[] } | null;
    if (m?.type === 'queue' && Array.isArray(m.state)) {
      setError(false);
      apply(m.state);
    }
  });
  useInterval(() => setClock(new Date()), 15_000);

  if (!token) return <main className="flex min-h-screen items-center justify-center p-8 text-2xl">{t('disp.noToken')}</main>;

  return (
    <main className="flex min-h-screen flex-col bg-bg p-6 text-fg">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="font-display text-4xl font-bold text-primary">{t('app.name')}</h1>
        <div className="flex items-center gap-4">
          <span className="num font-display text-4xl">{formatTime12(clock, locale)}</span>
          <span className={cx('h-3 w-3 rounded-full', live ? 'bg-success' : 'bg-danger')} aria-label={live ? t('common.online') : t('shell.offline')} />
          <button
            className="rounded-xl border border-border px-3 py-2 text-sm"
            onClick={() => {
              if (!audio.current) {
                const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
                if (Ctx) audio.current = new Ctx();
              }
              void audio.current?.resume();
              setSound((s) => !s);
            }}
            aria-pressed={sound}
          >
            {sound ? t('disp.soundOn') : t('disp.soundOff')}
          </button>
          <button className="rounded-xl border border-border px-3 py-2 text-sm" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}>
            {t('disp.fullscreen')}
          </button>
        </div>
      </header>
      {error && !state && <p className="text-2xl text-danger">{t('disp.error')}</p>}
      {state && state.length === 0 && <p className="text-3xl text-muted">{t('disp.empty')}</p>}
      <div className="grid flex-1 gap-6 md:grid-cols-2 xl:grid-cols-3" aria-live="polite">
        {(state ?? []).map((d) => (
          <section key={d.doctorId} className={cx('flex flex-col rounded-3xl border-4 bg-surface p-6 shadow-lg transition', flash === d.doctorId ? 'border-primary' : 'border-border')}>
            <h2 className="mb-4 truncate font-display text-3xl font-bold">
              <bdi>{d.doctorName}</bdi>
            </h2>
            <p className="text-xl text-muted">{t('queue.nowServing')}</p>
            <p className={cx('num font-display text-[9rem] font-bold leading-none', flash === d.doctorId && 'animate-pulse text-primary')}>{d.nowServing ?? '—'}</p>
            <p className="mt-4 text-xl text-muted">{t('queue.next')}</p>
            <p className="num flex gap-6 font-display text-5xl font-bold">{d.next.length ? d.next.map((n) => <span key={n}>{n}</span>) : '—'}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
