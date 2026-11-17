import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { CheckInResult } from '../../components/CheckInResult';
import { Banner, Button, ErrorBox, Loading, Muted, Screen } from '../../components/ui';
import { parseBookingQr, resolveRef } from '../../lib/checkin';
import { staffApi } from '../../lib/endpoints';
import { useI18n } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { useAction } from '../../lib/useQuery';

/** QR check-in (FR-APP-3): scan the booking QR (appointment id, or booking ref resolved with GET /v1/appointments?ref=) and check the patient in. */
export default function Scan() {
  const { t } = useI18n();
  const { clinicId } = useSession();
  const [perm, requestPerm] = useCameraPermissions();
  const [ticket, setTicket] = useState<number | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const handling = useRef(false);
  const act = useAction();

  const onScan = (r: BarcodeScanningResult) => {
    if (handling.current || ticket !== undefined) return;
    handling.current = true;
    setNotice(null);
    void act
      .run(async () => {
        const parsed = parseBookingQr(r.data);
        if (!parsed) return setNotice(t('reception.qrUnknown'));
        let id = parsed.appointmentId ?? null;
        if (!id && parsed.ref) {
          const hit = await resolveRef(clinicId!, parsed.ref);
          if (hit && 'otherClinic' in hit) return setNotice(t('reception.qrOtherClinic'));
          id = hit?.id ?? null;
        }
        if (!id) return setNotice(t('reception.qrNotToday'));
        const res = await staffApi.checkIn(id);
        setTicket(res.ticket?.ticket_number ?? null);
      })
      .finally(() => {
        setTimeout(() => (handling.current = false), 1500);
      });
  };

  if (!perm) return <Screen><Loading /></Screen>;
  if (!perm.granted)
    return (
      <Screen>
        <Banner kind="info">{t('reception.cameraNeeded')}</Banner>
        <Button title={t('reception.allowCamera')} onPress={() => void requestPerm()} />
      </Screen>
    );

  return (
    <Screen scroll={false}>
      {ticket === undefined ? (
        <View style={styles.camera}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} accessibilityLabel={t('reception.scan')} />
        </View>
      ) : (
        <CheckInResult ticket={ticket} />
      )}
      {act.busy ? <Loading /> : null}
      {notice ? <Banner kind="warn">{notice}</Banner> : null}
      <ErrorBox error={act.error} />
      {ticket !== undefined ? <Button title={t('reception.scanNext')} onPress={() => { setTicket(undefined); act.setError(null); }} /> : <Muted style={{ textAlign: 'center' }}>{t('reception.scanHint')}</Muted>}
    </Screen>
  );
}

const styles = StyleSheet.create({ camera: { height: 360, borderRadius: 16, overflow: 'hidden', marginBottom: 12, backgroundColor: '#000' } });
