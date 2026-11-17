import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ActionButton, Banner, Button, Chip, Empty, ErrorBox, Field, Loading, Muted, Screen, Section, s } from '../../components/ui';
import { portalApi, publicApi } from '../../lib/endpoints';
import { patientName } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useAction, useQuery } from '../../lib/useQuery';
import type { ComplaintCategory } from '../../lib/types';

const CATEGORIES: ComplaintCategory[] = ['waiting_time', 'staff_behaviour', 'clinical_care', 'billing', 'facility', 'communication', 'other'];

/**
 * Complaint form (POST /v1/portal/complaints, channel "app"). The clinic is preselected when opened from an
 * appointment. Status and the clinic's response are followed up in `complaints` (GET /v1/portal/complaints).
 */
export default function Complaint() {
  const params = useLocalSearchParams<{ clinicId?: string; patientId?: string }>();
  const { t, locale, pick } = useI18n();
  const me = useQuery('portal:me', portalApi.me);
  const clinics = useQuery('public:clinics', publicApi.clinics);
  const [patientId, setPatientId] = useState<string | null>(params.patientId ?? null);
  const [clinicId, setClinicId] = useState<string | null>(params.clinicId ?? null);
  const [category, setCategory] = useState<ComplaintCategory | null>(null);
  const [description, setDescription] = useState('');
  const [sent, setSent] = useState(false);
  const act = useAction();

  const patients = me.data?.patients ?? [];
  const pid = patientId ?? patients[0]?.id ?? null;
  const text = description.trim();
  const valid = !!pid && !!clinicId && !!category && text.length >= 5;

  if (sent)
    return (
      <Screen>
        <Banner kind="success">{t('complaint.sent')}</Banner>
        <Muted>{t('complaint.sentBody')}</Muted>
        <Button title={t('complaint.viewHistory')} onPress={() => router.replace('/patient/complaints')} style={{ marginTop: 12 }} />
        <Button kind="secondary" title={t('common.back')} onPress={() => router.back()} />
      </Screen>
    );

  return (
    <Screen>
      <Muted style={{ marginBottom: 12 }}>{t('complaint.intro')}</Muted>
      {(me.loading && !me.data) || (clinics.loading && !clinics.data) ? <Loading /> : null}
      <ErrorBox error={me.error ?? clinics.error} onRetry={() => { void me.reload(); void clinics.reload(); }} />
      {me.data && !patients.length ? <Banner kind="info">{t('family.addSelfFirst')}</Banner> : null}

      {patients.length > 1 ? (
        <Section title={t('complaint.patient')}>
          <View style={s.wrap}>
            {patients.map((p) => (
              <Chip key={p.id} label={patientName(p, locale)} selected={pid === p.id} onPress={() => setPatientId(p.id)} />
            ))}
          </View>
        </Section>
      ) : null}

      <Section title={t('complaint.clinic')}>
        {clinics.data && !clinics.data.length ? <Empty /> : null}
        <View style={s.wrap}>
          {(clinics.data ?? []).map((c) => (
            <Chip key={c.id} label={pick(c)} selected={clinicId === c.id} onPress={() => setClinicId(c.id)} />
          ))}
        </View>
      </Section>

      <Section title={t('complaint.category')}>
        <View style={s.wrap}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={t(`complaint.cat.${c}`)} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
      </Section>

      <Field
        label={t('complaint.description')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={5000}
        placeholder={t('complaint.descriptionHint')}
        error={description.length > 0 && text.length < 5 ? t('complaint.tooShort') : null}
      />
      <Muted style={{ marginBottom: 12 }}>{t('complaint.privacy')}</Muted>
      <ErrorBox error={act.error} />
      <ActionButton
        title={t('complaint.submit')}
        disabled={!valid}
        loading={act.busy}
        onPress={() =>
          void act.run(async () => {
            await portalApi.complaint({ clinicId: clinicId!, patientId: pid!, category: category!, description: text });
            setSent(true);
          })
        }
      />
    </Screen>
  );
}
