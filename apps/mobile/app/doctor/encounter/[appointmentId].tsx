import { useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ageInYears, toWesternDigits } from '@hf/shared';
import { AllergyBanner } from '../../../components/AllergyBanner';
import { ActionButton, Banner, Button, Card, Chip, Empty, ErrorBox, Field, H1, ListItem, Loading, Muted, Row, Screen, Section, T, colors, s } from '../../../components/ui';
import { isApiError } from '../../../lib/api';
import { staffApi } from '../../../lib/endpoints';
import { date } from '../../../lib/format';
import { useI18n, type TKey } from '../../../lib/i18n';
import { withReauth } from '../../../lib/reauth';
import { useClinicalScreen } from '../../../lib/screenCapture';
import { useSession } from '../../../lib/session';
import { todayRange } from '../../../lib/today';
import { useAction, useQuery } from '../../../lib/useQuery';
import type { Drug, Encounter, Icd10, RxLineInput, RxWarning, Vitals } from '../../../lib/types';

const VITALS: { key: keyof Vitals; label: TKey; int: boolean }[] = [
  { key: 'systolic', label: 'vitals.systolic', int: true },
  { key: 'diastolic', label: 'vitals.diastolic', int: true },
  { key: 'heartRate', label: 'vitals.heartRate', int: true },
  { key: 'temperatureC', label: 'vitals.temperature', int: false },
  { key: 'respiratoryRate', label: 'vitals.respiratoryRate', int: true },
  { key: 'spo2', label: 'vitals.spo2', int: true },
  { key: 'weightKg', label: 'vitals.weight', int: false },
  { key: 'heightCm', label: 'vitals.height', int: false },
  { key: 'glucoseMgDl', label: 'vitals.glucose', int: false },
];

/**
 * The encounter is created at check-in and its id travels with the queue ticket / appointment row (`encounter_id`)
 * or the telemedicine start response. Without it (e.g. a deep link), the appointment's row in today's schedule is
 * looked up for its `encounter_id` (GET /v1/appointments lists it). No guessing among the patient's encounters.
 */
async function findEncounter(p: { encounterId?: string; appointmentId?: string; doctorId: string }): Promise<Encounter | null> {
  if (p.encounterId) return staffApi.encounter(p.encounterId);
  if (!p.appointmentId) return null;
  const r = todayRange();
  const row = (await staffApi.appointments({ doctorId: p.doctorId, from: r.from, to: r.to })).find((a) => a.id === p.appointmentId);
  return row?.encounter_id ? staffApi.encounter(row.encounter_id) : null;
}

const num = (v: string, int: boolean) => {
  const n = (int ? parseInt : parseFloat)(toWesternDigits(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** Patient summary + quick encounter (FR-APP-2): vitals, ICD-10 diagnoses, notes, prescription, sign-off. */
export default function EncounterScreen() {
  useClinicalScreen('encounter');
  const params = useLocalSearchParams<{ appointmentId: string; patientId?: string; encounterId?: string }>();
  const { t, locale } = useI18n();
  const { staff } = useSession();
  const me = staff!.userId;
  const enc = useQuery(`encd:${params.encounterId ?? ''}:${params.appointmentId ?? ''}`, () => findEncounter({ encounterId: params.encounterId, appointmentId: params.appointmentId, doctorId: me }));
  // The telemedicine list has no patient_id, so the patient can also come from the encounter itself.
  const patientId = params.patientId || enc.data?.patient_id;
  const patient = useQuery(patientId ? `pt:${patientId}` : null, () => staffApi.patient(patientId!));
  const history = useQuery(patientId ? `hist:${patientId}` : null, () => staffApi.history(patientId!));
  const visits = useQuery(patientId ? `enc:${patientId}` : null, () => staffApi.encounters(patientId!));

  const [vitals, setVitals] = useState<Record<string, string>>({});
  const [complaint, setComplaint] = useState('');
  const [hpi, setHpi] = useState('');
  const [exam, setExam] = useState('');
  const [notes, setNotes] = useState('');
  const [dx, setDx] = useState<{ code: string; title: string }[]>([]);
  const [dxQuery, setDxQuery] = useState('');
  const [dxResults, setDxResults] = useState<Icd10[]>([]);
  const [drugQuery, setDrugQuery] = useState('');
  const [drugResults, setDrugResults] = useState<Drug[]>([]);
  const [lines, setLines] = useState<RxLineInput[]>([]);
  const [rxNotes, setRxNotes] = useState('');
  const templates = useQuery('rxTemplates', staffApi.rxTemplates);
  const act = useAction();

  const e = enc.data;
  const signed = e?.status === 'signed';
  useEffect(() => {
    if (!e) return;
    setVitals(Object.fromEntries(Object.entries(e.vitals ?? {}).filter(([k]) => k !== 'bmi').map(([k, v]) => [k, v == null ? '' : String(v)])));
    setComplaint(e.chief_complaint ?? '');
    setHpi(e.hpi ?? '');
    setExam(e.examination ?? '');
    setNotes(e.notes ?? '');
    setDx((e.diagnoses ?? []).map((d) => ({ code: d.code, title: '' })));
  }, [e]);

  useEffect(() => {
    const q = dxQuery.trim();
    if (q.length < 2) return setDxResults([]);
    const id = setTimeout(() => void staffApi.icd10(q).then(setDxResults).catch(() => setDxResults([])), 300);
    return () => clearTimeout(id);
  }, [dxQuery]);
  useEffect(() => {
    const q = drugQuery.trim();
    if (q.length < 2) return setDrugResults([]);
    const id = setTimeout(() => void staffApi.drugs(q).then(setDrugResults).catch(() => setDrugResults([])), 300);
    return () => clearTimeout(id);
  }, [drugQuery]);

  const vitalsPayload = useMemo(() => {
    const out: Vitals = {};
    for (const v of VITALS) {
      const n = num(vitals[v.key] ?? '', v.int);
      if (n !== undefined) (out as Record<string, number>)[v.key] = n;
    }
    return out;
  }, [vitals]);

  const save = async () => {
    if (!e) return;
    await staffApi.updateEncounter(e.id, {
      vitals: Object.keys(vitalsPayload).length ? vitalsPayload : undefined,
      chiefComplaint: complaint,
      hpi,
      examination: exam,
      notes,
      diagnoses: dx.map((d, i) => ({ code: d.code, primary: i === 0 })),
    });
  };

  const reauthHint = (err: unknown) => {
    if (isApiError(err, 'reauthentication_required')) Alert.alert(t('emr.reauthTitle'), t('emr.reauthBody'));
  };

  const signOff = () =>
    Alert.alert(t('emr.signOff'), t('emr.signConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('emr.signOff'),
        onPress: () =>
          void act.run(async () => {
            try {
              await save();
              await withReauth(() => staffApi.signEncounter(e!.id), locale);
              await enc.reload();
              Alert.alert(t('emr.signed'));
            } catch (err) {
              reauthHint(err);
              throw err;
            }
          }),
      },
    ]);

  const issue = async (rxId: string, ack: boolean) => {
    await withReauth(() => staffApi.issueRx(rxId, ack), locale);
    setLines([]);
    setRxNotes('');
    await enc.reload();
    Alert.alert(t('rx.issued'));
  };

  const prescribe = () =>
    void act.run(async () => {
      if (!e) return;
      try {
        const rx = await staffApi.createRx(e.id, lines, rxNotes || undefined);
        const blocking = rx.warnings.filter((w: RxWarning) => w.kind !== 'free_text');
        if (!blocking.length) return await issue(rx.id, false);
        Alert.alert(t('rx.warningsTitle'), blocking.map((w) => `${t(`rx.warning.${w.kind}`)}: ${w.detail}`).join('\n'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('rx.acknowledgeIssue'), style: 'destructive', onPress: () => void act.run(() => issue(rx.id, true)) },
        ]);
      } catch (err) {
        reauthHint(err);
        throw err;
      }
    });

  const addDrug = (d: Drug) => {
    setLines((l) => [...l, { drugId: d.id, label: [d.trade_name_en, d.strength, d.form].filter(Boolean).join(' '), dose: '', route: 'oral', frequency: '', instructionsAr: '', instructionsEn: '' }]);
    setDrugQuery('');
  };
  const setLine = (i: number, patch: Partial<RxLineInput>) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const linesValid = lines.length > 0 && lines.every((l) => l.dose.trim() && l.frequency.trim());

  if ((patientId && patient.loading && !patient.data) || (enc.loading && !enc.data)) return <Screen><Loading /></Screen>;
  const p = patient.data;

  return (
    <Screen>
      <AllergyBanner allergies={p?.allergies ?? e?.allergies} />
      <ErrorBox error={patient.error ?? enc.error} />
      {p ? (
        <>
          <H1>{[p.first_name_ar, p.father_name_ar, p.grandfather_name_ar, p.family_name_ar].filter(Boolean).join(' ')}</H1>
          <Muted>{[`${t('patient.mrn')} ${p.mrn}`, p.date_of_birth ? t('emr.age', { years: ageInYears(p.date_of_birth.slice(0, 10)) }) : null, t(p.gender === 'male' ? 'patient.male' : 'patient.female')].filter(Boolean).join(' · ')}</Muted>
        </>
      ) : null}

      <Section title={t('emr.history')}>
        {(history.data ?? []).filter((h) => h.is_active && h.kind !== 'allergy').slice(0, 10).map((h) => (
          <T key={h.id}>{`${t(`history.${h.kind}`)}: ${h.text}`}</T>
        ))}
        {history.data && !history.data.some((h) => h.is_active && h.kind !== 'allergy') ? <Muted>{t('common.empty')}</Muted> : null}
      </Section>

      <Section title={t('emr.lastVisits')}>
        {(visits.data ?? []).filter((v) => v.status === 'signed').slice(0, 3).map((v) => (
          <Card key={v.id}>
            <T style={{ fontWeight: '600' }}>{`${date(v.signed_at ?? v.created_at)} · ${v.doctor_name}`}</T>
            <Muted>{[v.chief_complaint, v.diagnoses?.map((d) => d.code).join(', ')].filter(Boolean).join(' · ')}</Muted>
          </Card>
        ))}
        {visits.data && !visits.data.some((v) => v.status === 'signed') ? <Muted>{t('common.empty')}</Muted> : null}
      </Section>

      {!e ? <Banner kind="warn">{t('emr.noEncounter')}</Banner> : null}
      {signed ? <Banner kind="success">{`${t('emr.signed')} · ${date(e!.signed_at!)}`}</Banner> : null}

      {e && !signed ? (
        <>
          <Section title={t('emr.vitals')}>
            <View style={s.wrap}>
              {VITALS.map((v) => (
                <View key={v.key} style={{ width: '50%', paddingEnd: 8 }}>
                  <Field label={t(v.label)} value={vitals[v.key] ?? ''} onChangeText={(x) => setVitals((o) => ({ ...o, [v.key]: x }))} keyboardType="decimal-pad" ltr />
                </View>
              ))}
            </View>
          </Section>
          <Card style={{ borderColor: colors.info }}>
            <T style={{ fontWeight: '700' }}>{t('ai.scribeTitle')}</T>
            <Muted>{t('ai.scribeBody')}</Muted>
            <Button
              kind="secondary"
              title={t('ai.dictate')}
              style={{ marginTop: 8, marginBottom: 0 }}
              onPress={() =>
                void act.run(async () => {
                  await save(); // keep typed edits: an approved draft only overwrites the fields it fills
                  router.push({ pathname: '/doctor/dictation/[encounterId]', params: { encounterId: e.id } });
                })
              }
            />
          </Card>
          <Field label={t('emr.chiefComplaint')} value={complaint} onChangeText={setComplaint} multiline />
          <Field label={t('ai.field.hpi')} value={hpi} onChangeText={setHpi} multiline />
          <Field label={t('ai.field.examination')} value={exam} onChangeText={setExam} multiline />
          <Field label={t('emr.notes')} value={notes} onChangeText={setNotes} multiline />

          <Section title={t('emr.diagnoses')}>
            {dx.map((d, i) => (
              <Row key={d.code} style={{ alignItems: 'center', marginBottom: 6 }}>
                <T ltr style={{ flex: 1, fontWeight: i === 0 ? '700' : '400' }}>{`${d.code} ${d.title}`}</T>
                {i === 0 ? <Muted>{t('emr.primary')}</Muted> : null}
                <Button kind="ghost" title={t('common.remove')} onPress={() => setDx((x) => x.filter((y) => y.code !== d.code))} />
              </Row>
            ))}
            <Field label={t('emr.icdSearch')} value={dxQuery} onChangeText={setDxQuery} autoCapitalize="none" />
            {dxResults.slice(0, 8).map((r) => (
              <ListItem
                key={r.code}
                title={`${r.code} · ${locale === 'ar' && r.title_ar ? r.title_ar : r.title_en}`}
                onPress={() => {
                  if (!dx.some((d) => d.code === r.code)) setDx((x) => [...x, { code: r.code, title: locale === 'ar' && r.title_ar ? r.title_ar : r.title_en }]);
                  setDxQuery('');
                }}
              />
            ))}
          </Section>
          <ActionButton kind="secondary" title={t('common.save')} loading={act.busy} onPress={() => void act.run(async () => { await save(); await enc.reload(); })} />

          <Section title={t('rx.title')}>
            {(templates.data ?? []).length ? (
              <View style={s.wrap}>
                {(templates.data ?? []).map((tp) => (
                  <Chip key={tp.id} label={tp.name} onPress={() => setLines((l) => [...l, ...tp.lines.map((x) => ({ ...x, label: x.freeText ?? x.label ?? '' }))])} />
                ))}
              </View>
            ) : null}
            {lines.map((l, i) => (
              <Card key={i}>
                <Row style={{ alignItems: 'center' }}>
                  <T ltr style={{ flex: 1, fontWeight: '700' }}>{l.label || l.freeText || l.drugId || ''}</T>
                  <Button kind="ghost" title={t('common.remove')} onPress={() => setLines((x) => x.filter((_, j) => j !== i))} />
                </Row>
                <Field label={t('rx.dose')} value={l.dose} onChangeText={(v) => setLine(i, { dose: v })} />
                <Field label={t('rx.frequency')} value={l.frequency} onChangeText={(v) => setLine(i, { frequency: v })} />
                <Field label={t('rx.duration')} value={l.durationDays ? String(l.durationDays) : ''} onChangeText={(v) => setLine(i, { durationDays: num(v, true) })} keyboardType="number-pad" ltr />
                <Field label={t('rx.instructions')} value={locale === 'ar' ? l.instructionsAr : l.instructionsEn} onChangeText={(v) => setLine(i, locale === 'ar' ? { instructionsAr: v } : { instructionsEn: v })} />
              </Card>
            ))}
            <Field label={t('rx.drugSearch')} value={drugQuery} onChangeText={setDrugQuery} autoCapitalize="none" />
            {drugResults.slice(0, 8).map((d) => (
              <ListItem key={d.id} title={[d.trade_name_en, d.strength, d.form].filter(Boolean).join(' ')} subtitle={d.active_ingredients.join(', ')} onPress={() => addDrug(d)} />
            ))}
            {drugQuery.trim().length >= 2 ? (
              <Button kind="ghost" title={t('rx.addFreeText', { text: drugQuery.trim() })} onPress={() => { setLines((l) => [...l, { freeText: drugQuery.trim(), label: drugQuery.trim(), dose: '', route: 'oral', frequency: '', instructionsAr: '', instructionsEn: '' }]); setDrugQuery(''); }} />
            ) : null}
            {lines.length ? <Field label={t('rx.notes')} value={rxNotes} onChangeText={setRxNotes} multiline /> : null}
            {lines.length ? <ActionButton title={t('rx.issue')} disabled={!linesValid} loading={act.busy} onPress={prescribe} /> : null}
            {(e.prescriptions ?? []).map((rx) => (
              <Muted key={rx.id}>{`${t('rx.title')} · ${t(rx.status === 'issued' ? 'rx.statusIssued' : 'rx.statusDraft')}${rx.issued_at ? ` · ${date(rx.issued_at)}` : ''}`}</Muted>
            ))}
          </Section>

          <ErrorBox error={act.error} />
          <ActionButton title={t('emr.signOff')} onPress={signOff} loading={act.busy} disabled={!dx.length} />
          {!dx.length ? <Muted>{t('emr.diagnosisRequired')}</Muted> : null}
        </>
      ) : null}
      {signed ? <Empty text={t('emr.signedReadOnly')} /> : null}
      <Button kind="ghost" title={t('common.back')} onPress={() => router.back()} />
    </Screen>
  );
}
