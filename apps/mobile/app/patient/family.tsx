import { useState } from 'react';
import { Switch, View } from 'react-native';
import { toWesternDigits } from '@hf/shared';
import { ActionButton, Banner, Button, Card, Chip, ErrorBox, Field, Loading, Muted, Row, Screen, Section, T, s } from '../../components/ui';
import { authApi, portalApi } from '../../lib/endpoints';
import { patientName, plainDate } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useAction, useQuery } from '../../lib/useQuery';

const RELATIONS = ['self', 'child', 'spouse', 'parent', 'sibling', 'other'] as const;
type Relation = (typeof RELATIONS)[number];

/** Profile and family members (FR-APP-1, FR-PAT-4). Minors are linked to the account holder as guardian by the API. */
export default function Family() {
  const { t, locale } = useI18n();
  const me = useQuery('portal:me', portalApi.me);
  const [adding, setAdding] = useState(false);
  const [first, setFirst] = useState('');
  const [father, setFather] = useState('');
  const [grand, setGrand] = useState('');
  const [family, setFamily] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [relation, setRelation] = useState<Relation | null>(null);
  const [consent, setConsent] = useState(false);
  const [messaging, setMessaging] = useState(true);
  const act = useAction();
  const link = useAction();
  const [linkSent, setLinkSent] = useState(false);
  const [linkCode, setLinkCode] = useState('');
  const [linked, setLinked] = useState<number | null>(null);

  const patients = me.data?.patients ?? [];
  const hasSelf = patients.some((p) => p.relation === 'self');
  const dobNorm = toWesternDigits(dob).trim();
  const dobOk = /^\d{4}-\d{2}-\d{2}$/.test(dobNorm) && !Number.isNaN(Date.parse(dobNorm));
  const valid = first.trim() && family.trim() && dobOk && gender && relation && consent;

  const submit = () =>
    void act.run(async () => {
      if (!me.data || !gender || !relation) return;
      await portalApi.addPatient({
        patient: {
          nameAr: { first: first.trim(), father: father.trim(), grandfather: grand.trim(), family: family.trim() },
          nameEn: nameEn.trim() || undefined,
          dateOfBirth: dobNorm,
          gender,
          phones: [{ number: me.data.account.phone, primary: true }],
        },
        relation,
        consentHealthData: true,
        consentMessaging: messaging,
      });
      setAdding(false);
      setFirst(''); setFather(''); setGrand(''); setFamily(''); setNameEn(''); setDob(''); setGender(null); setRelation(null); setConsent(false);
      await me.reload();
    });

  return (
    <Screen>
      {me.loading && !me.data ? <Loading /> : null}
      <ErrorBox error={me.error} onRetry={() => void me.reload()} />
      {!hasSelf && me.data ? <Banner kind="info">{t('family.addSelfFirst')}</Banner> : null}
      {patients.map((p) => (
        <Card key={p.id}>
          <T style={{ fontWeight: '700' }}>{patientName(p, locale)}</T>
          <Muted>{`${t(`family.relation.${p.relation}`)} · ${t('patient.dob')}: ${plainDate(p.date_of_birth)}`}</Muted>
          <Muted ltr>{`${t('patient.mrn')}: ${p.mrn}`}</Muted>
        </Card>
      ))}

      <Section title={t('family.linkTitle')}>
        <Muted style={{ marginBottom: 8 }}>{t('family.linkBody')}</Muted>
        {linked != null ? <Banner kind="success">{t('family.linked', { count: linked })}</Banner> : null}
        <ErrorBox error={link.error} />
        {!linkSent ? (
          <ActionButton kind="secondary" title={t('family.linkSend')} loading={link.busy} disabled={!me.data} onPress={() => void link.run(async () => { await authApi.requestOtp(me.data!.account.phone, 'link_family'); setLinkSent(true); })} />
        ) : (
          <>
            <Field label={t('auth.code')} value={linkCode} onChangeText={(v) => setLinkCode(toWesternDigits(v).replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} ltr />
            <ActionButton
              title={t('auth.verify')}
              disabled={linkCode.length !== 6}
              loading={link.busy}
              onPress={() => void link.run(async () => { const r = await portalApi.confirmLinks(linkCode); setLinked(r.linked.length); setLinkSent(false); setLinkCode(''); await me.reload(); })}
            />
          </>
        )}
      </Section>

      {!adding ? (
        <Button title={t('family.add')} onPress={() => { setAdding(true); if (!hasSelf) setRelation('self'); }} disabled={patients.length >= 10} />
      ) : (
        <Section title={t('family.add')}>
          <View style={s.wrap}>
            {RELATIONS.filter((r) => r !== 'self' || !hasSelf).map((r) => (
              <Chip key={r} label={t(`family.relation.${r}`)} selected={relation === r} onPress={() => setRelation(r)} />
            ))}
          </View>
          <Field label={t('family.firstName')} value={first} onChangeText={setFirst} />
          <Field label={t('family.fatherName')} value={father} onChangeText={setFather} />
          <Field label={t('family.grandfatherName')} value={grand} onChangeText={setGrand} />
          <Field label={t('family.familyName')} value={family} onChangeText={setFamily} />
          <Field label={t('family.nameEn')} value={nameEn} onChangeText={setNameEn} autoCapitalize="words" ltr />
          <Field label={t('family.dobLabel')} value={dob} onChangeText={setDob} keyboardType="numbers-and-punctuation" ltr error={dob && !dobOk ? t('family.dobInvalid') : null} />
          <View style={s.wrap}>
            <Chip label={t('patient.male')} selected={gender === 'male'} onPress={() => setGender('male')} />
            <Chip label={t('patient.female')} selected={gender === 'female'} onPress={() => setGender('female')} />
          </View>
          <Row style={{ alignItems: 'center', marginVertical: 8 }}>
            <Switch value={consent} onValueChange={setConsent} accessibilityLabel={t('privacy.consent')} />
            <T style={{ flex: 1, marginStart: 8 }}>{t('privacy.consent')}</T>
          </Row>
          <Row style={{ alignItems: 'center', marginBottom: 12 }}>
            <Switch value={messaging} onValueChange={setMessaging} accessibilityLabel={t('family.consentMessaging')} />
            <T style={{ flex: 1, marginStart: 8 }}>{t('family.consentMessaging')}</T>
          </Row>
          <ErrorBox error={act.error} />
          <ActionButton title={t('common.save')} onPress={submit} disabled={!valid} loading={act.busy} />
          <Button kind="ghost" title={t('common.cancel')} onPress={() => setAdding(false)} />
        </Section>
      )}
    </Screen>
  );
}
