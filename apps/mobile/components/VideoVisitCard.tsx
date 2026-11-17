import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ActionButton, Banner, Button, Card, ErrorBox, Muted, Row, StatusBadge, T, colors } from './ui';
import { isApiError } from '../lib/api';
import { portalApi } from '../lib/endpoints';
import { countdown, dateTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useAction, useQuery } from '../lib/useQuery';
import type { PortalAppointment, TelemedicineLink } from '../lib/types';

const JOINABLE = ['booked', 'confirmed', 'checked_in', 'in_consultation'];

/**
 * Video visit (FR-TEL-4): waiting-room countdown, telemedicine consent check, Join.
 * Renders nothing for in-clinic visits: the portal appointment row has no service type, so the status endpoint's
 * 400 `not_a_video_consultation` is what tells them apart (README "API gaps").
 * Join opens the provider URL in the system browser (expo-web-browser) and shows the passcode in-app.
 */
export function VideoVisitCard({ a }: { a: PortalAppointment }) {
  const { t, locale } = useI18n();
  const tele = useQuery(`tele:${a.id}:${a.status}`, () => portalApi.telemedicine(a.id));
  const isVideo = !!tele.data;
  const consents = useQuery(isVideo ? 'consents' : null, portalApi.consents);
  const [now, setNow] = useState(Date.now());
  const [link, setLink] = useState<TelemedicineLink | null>(null);
  const act = useAction();
  const reloadedAtOpen = useRef(false);

  const opens = tele.data ? new Date(tele.data.opensAt).getTime() : 0;
  const closes = tele.data ? new Date(tele.data.closesAt).getTime() : 0;
  const ended = !!tele.data && (tele.data.status === 'ended' || tele.data.status === 'cancelled' || now > closes || !['requested', ...JOINABLE].includes(a.status));

  useEffect(() => {
    if (!isVideo || ended) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isVideo, ended]);

  // Refresh the server's canJoin once the waiting room opens.
  useEffect(() => {
    if (isVideo && !reloadedAtOpen.current && now >= opens && !tele.data?.canJoin && !ended) {
      reloadedAtOpen.current = true;
      void tele.reload();
    }
  }, [isVideo, now, opens, ended, tele]);

  if (!tele.data) {
    if (tele.error && !isApiError(tele.error, 'not_a_video_consultation')) return <ErrorBox error={tele.error} onRetry={() => void tele.reload()} />;
    return null;
  }
  const d = tele.data;
  const consent = consents.data?.consents.find((c) => c.patient_id === a.patient_id && c.type === 'telemedicine');
  const consentOk = !!consent?.granted;
  const windowOpen = now >= opens && now <= closes;
  const canJoin = (d.canJoin || (windowOpen && JOINABLE.includes(a.status))) && !ended;

  const join = () =>
    void act.run(async () => {
      try {
        const l = await portalApi.joinTelemedicine(a.id);
        setLink(l);
        const open = () => void WebBrowser.openBrowserAsync(l.url, { dismissButtonStyle: 'close' }).then(() => tele.reload());
        // The browser covers the app (iOS), so show the passcode first when the provider uses one.
        if (l.passcode) Alert.alert(t('tele.passcode'), l.passcode, [{ text: t('tele.openCall'), onPress: open }]);
        else open();
      } catch (e) {
        if (isApiError(e, 'telemedicine_consent_required')) void consents.reload();
        throw e;
      }
    });

  return (
    <Card style={{ borderColor: colors.primary, borderWidth: 1 }}>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <T style={{ fontWeight: '700', flex: 1 }}>{t('tele.title')}</T>
        <StatusBadge label={t(`tele.status.${d.status}`)} tone={d.status === 'in_progress' ? 'success' : d.status === 'cancelled' ? 'danger' : 'info'} />
      </Row>
      <Muted>{t('tele.body')}</Muted>
      {ended ? (
        <Banner kind="info">{t('tele.ended')}</Banner>
      ) : now < opens ? (
        <View style={{ marginVertical: 8 }} accessibilityLiveRegion="polite">
          <Muted>{t('tele.opensIn')}</Muted>
          {opens - now > 24 * 3600_000 ? (
            <T style={{ fontSize: 18, fontWeight: '700' }}>{dateTime(d.opensAt, locale)}</T>
          ) : (
            <T ltr style={{ fontSize: 28, fontWeight: '700', textAlign: 'center' }}>{countdown(opens - now)}</T>
          )}
        </View>
      ) : (
        <Banner kind="success">{t('tele.roomOpen')}</Banner>
      )}

      {a.status === 'requested' ? <Banner kind="warn">{t('tele.payFirst')}</Banner> : null}
      {!ended && consents.data && !consentOk ? (
        <>
          <Banner kind="warn">{t('tele.consentNeeded')}</Banner>
          <Button kind="secondary" title={t('tele.openConsents')} onPress={() => router.push({ pathname: '/patient/settings', params: { focus: 'consents', patientId: a.patient_id } })} />
        </>
      ) : null}

      <ErrorBox error={act.error} />
      {!ended ? <ActionButton title={t('tele.join')} onPress={join} loading={act.busy} disabled={!canJoin || !consentOk} accessibilityHint={t('tele.joinHint')} /> : null}
      {!ended && !canJoin ? <Muted>{t('tele.joinFrom')}</Muted> : null}

      {link?.passcode ? (
        <View style={{ marginTop: 8 }}>
          <Muted>{t('tele.passcode')}</Muted>
          <T ltr selectable style={{ fontSize: 22, fontWeight: '700', letterSpacing: 2 }}>{link.passcode}</T>
        </View>
      ) : null}
      {link ? <Button kind="ghost" title={t('tele.reopen')} onPress={() => void WebBrowser.openBrowserAsync(link.url, { dismissButtonStyle: 'close' })} /> : null}
    </Card>
  );
}
