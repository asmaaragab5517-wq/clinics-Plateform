import { useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { addDays, localDate, toWesternDigits } from '@hf/shared';
import { ActionButton, Banner, Button, Card, Empty, ErrorBox, Field, ListItem, Loading, Muted, Row, Screen, Section, StatusBadge, T, colors, s } from '../../../components/ui';
import { staffApi } from '../../../lib/endpoints';
import { dateTime, plainDate } from '../../../lib/format';
import { useI18n, type TKey } from '../../../lib/i18n';
import { useClinicalScreen } from '../../../lib/screenCapture';
import { useAction, useQuery } from '../../../lib/useQuery';
import type { AiDraft, AiDraftWarning, ApproveEncounterDraft, DraftVitalKey, EncounterDraftOutput, Icd10, Vitals } from '../../../lib/types';

/** Mirrors vitalsSchema (packages/shared/src/schemas.ts) so the doctor sees range errors before approving. */
const VITALS: { key: DraftVitalKey; label: TKey; int: boolean; min: number; max: number }[] = [
  { key: 'systolic', label: 'vitals.systolic', int: true, min: 40, max: 300 },
  { key: 'diastolic', label: 'vitals.diastolic', int: true, min: 20, max: 200 },
  { key: 'heartRate', label: 'vitals.heartRate', int: true, min: 20, max: 300 },
  { key: 'temperatureC', label: 'vitals.temperature', int: false, min: 30, max: 45 },
  { key: 'respiratoryRate', label: 'vitals.respiratoryRate', int: true, min: 4, max: 80 },
  { key: 'spo2', label: 'vitals.spo2', int: true, min: 50, max: 100 },
  { key: 'weightKg', label: 'vitals.weight', int: false, min: 0.3, max: 400 },
  { key: 'heightCm', label: 'vitals.height', int: false, min: 20, max: 250 },
];

const isEncounterDraft = (d: AiDraft): d is AiDraft & { output: EncounterDraftOutput } => d.kind === 'encounter_note' && typeof (d.output as EncounterDraftOutput).chiefComplaint === 'string';

const parseNum = (v: string) => {
  const x = toWesternDigits(v).trim().replace(',', '.');
  if (!x) return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * AI draft review (ai.ts): every field is editable, warnings and missing information are listed, and nothing reaches
 * the record until the doctor taps Approve. Approve sends only the doctor's final, non-empty values
 * (POST /v1/ai/drafts/:id/approve); Reject discards the draft. Drafts expire after 24 h on the server.
 */
export default function DraftReview() {
  useClinicalScreen('ai-draft');
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const q = useQuery(id ? `draft:${id}` : null, () => staffApi.aiDraft(id!));
  const act = useAction();

  const [cc, setCc] = useState('');
  const [hpi, setHpi] = useState('');
  const [exam, setExam] = useState('');
  const [notes, setNotes] = useState('');
  const [vitals, setVitals] = useState<Record<string, string>>({});
  const [dx, setDx] = useState<{ code: string; title: string }[]>([]);
  const [followUp, setFollowUp] = useState('');
  const [dxQuery, setDxQuery] = useState('');
  const [dxResults, setDxResults] = useState<Icd10[]>([]);

  const d = q.data;
  const draft = d && isEncounterDraft(d) ? d.output : null;
  useEffect(() => {
    if (!draft) return;
    setCc(draft.chiefComplaint ?? '');
    setHpi(draft.hpi ?? '');
    setExam(draft.examination ?? '');
    setNotes(draft.notes ?? '');
    setVitals(Object.fromEntries(VITALS.map((v) => [v.key, draft.vitals?.[v.key] == null ? '' : String(draft.vitals[v.key])])));
    setDx((draft.diagnoses ?? []).filter((x) => x.code).map((x) => ({ code: x.code, title: x.title })));
    setFollowUp(draft.followUpInDays == null ? '' : String(draft.followUpInDays));
  }, [d?.id]); // initialise once per draft so the doctor's edits survive reloads

  useEffect(() => {
    const term = dxQuery.trim();
    if (term.length < 2) return setDxResults([]);
    const h = setTimeout(() => void staffApi.icd10(term).then(setDxResults).catch(() => setDxResults([])), 300);
    return () => clearTimeout(h);
  }, [dxQuery]);

  const vitalErrors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const v of VITALS) {
      const n = parseNum(vitals[v.key] ?? '');
      if (n === undefined) continue;
      if (Number.isNaN(n) || n < v.min || n > v.max || (v.int && !Number.isInteger(n))) out[v.key] = t('ai.rangeError', { min: v.min, max: v.max });
    }
    return out;
  }, [vitals, t]);
  const fuDays = parseNum(followUp);
  const followUpError = fuDays !== undefined && (Number.isNaN(fuDays) || !Number.isInteger(fuDays) || fuDays < 1 || fuDays > 730) ? t('ai.followUpError') : null;

  if (q.loading && !d) return <Screen><Loading /></Screen>;
  if (!d) return <Screen><ErrorBox error={q.error} onRetry={() => void q.reload()} />{!q.error ? <Empty text={t('common.notFound')} /> : null}</Screen>;

  const pending = d.status === 'pending';
  const warnings = (d.warnings ?? []).filter((w) => w.field !== 'missing');
  const missing = draft?.missingInformation?.length ? draft.missingInformation : (d.warnings ?? []).filter((w) => w.field === 'missing').map((w) => w.issue);
  const vitalLabel = (field: string) => {
    const key = field.replace(/^vitals\./, '');
    const v = VITALS.find((x) => x.key === key);
    return v ? t(v.label) : key;
  };
  const warningText = (w: AiDraftWarning) => {
    if (w.issue === 'unknown_or_unmapped_icd10') {
      const v = (w.value ?? {}) as { code?: string; title?: string };
      return t('ai.warn.icd', { value: [v.code || '—', v.title].filter(Boolean).join(' ') });
    }
    if (w.issue === 'out_of_range') return t('ai.warn.range', { field: vitalLabel(w.field), value: w.value == null ? '—' : String(w.value) });
    return `${w.field}: ${w.issue}`;
  };

  const valid = !Object.keys(vitalErrors).length && !followUpError;

  /** Only fields the doctor left non-empty are sent: the API keeps existing values for omitted fields. */
  const body = (): ApproveEncounterDraft => {
    const b: ApproveEncounterDraft = {};
    if (cc.trim()) b.chiefComplaint = cc.trim();
    if (hpi.trim()) b.hpi = hpi.trim();
    if (exam.trim()) b.examination = exam.trim();
    if (notes.trim()) b.notes = notes.trim();
    const vv: Vitals = {};
    for (const v of VITALS) {
      const n = parseNum(vitals[v.key] ?? '');
      if (n !== undefined && !Number.isNaN(n)) (vv as Record<string, number>)[v.key] = n;
    }
    if (Object.keys(vv).length) b.vitals = vv;
    if (dx.length) b.diagnosisCodes = dx.map((x) => x.code);
    if (fuDays !== undefined && !Number.isNaN(fuDays)) b.followUpDate = addDays(localDate(new Date()), fuDays);
    return b;
  };

  const approve = () =>
    Alert.alert(t('ai.approveTitle'), t('ai.approveBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('ai.approve'),
        onPress: () =>
          void act.run(async () => {
            await staffApi.approveDraft(d.id, body());
            Alert.alert(t('ai.approved'));
            router.back();
          }),
      },
    ]);

  const reject = () =>
    Alert.alert(t('ai.rejectTitle'), t('ai.rejectBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('ai.reject'),
        style: 'destructive',
        onPress: () =>
          void act.run(async () => {
            await staffApi.rejectDraft(d.id);
            router.back();
          }),
      },
    ]);

  const empty = t('ai.notDictated');
  return (
    <Screen>
      <View style={{ borderStartWidth: 4, borderStartColor: colors.warn, paddingStart: 10, marginBottom: 12 }} accessibilityRole="alert">
        <Row style={{ alignItems: 'center', marginBottom: 4 }}>
          <T style={{ fontWeight: '700', fontSize: 18, flex: 1 }}>{t('ai.draftBadgeTitle')}</T>
          <StatusBadge label={t(`ai.status.${d.status}`)} tone={d.status === 'approved' ? 'success' : d.status === 'pending' ? 'warn' : 'danger'} />
        </Row>
        <T style={{ color: colors.warn }}>{t('ai.reviewRequired')}</T>
        <Muted ltr>{[d.served_model ?? d.model, d.prompt_version, d.created_at ? dateTime(d.created_at, locale) : null].filter(Boolean).join(' · ')}</Muted>
      </View>

      {!pending ? <Banner kind={d.status === 'approved' ? 'success' : 'warn'}>{t(`ai.statusBody.${d.status}`)}</Banner> : null}
      {!draft ? <Banner kind="info">{t('ai.unsupportedKind')}</Banner> : null}

      {draft ? (
        <>
          {warnings.length ? (
            <Section title={t('ai.warnings')}>
              {warnings.map((w, i) => (
                <Banner key={i} kind="warn">{warningText(w)}</Banner>
              ))}
            </Section>
          ) : null}
          {missing.length ? (
            <Section title={t('ai.missing')}>
              <Card style={{ backgroundColor: colors.infoBg }}>
                {missing.map((m, i) => (
                  <T key={i} style={{ color: colors.info }}>{`• ${m}`}</T>
                ))}
              </Card>
            </Section>
          ) : null}

          <Field label={t('emr.chiefComplaint')} value={cc} onChangeText={setCc} multiline editable={pending} placeholder={empty} />
          <Field label={t('ai.field.hpi')} value={hpi} onChangeText={setHpi} multiline editable={pending} placeholder={empty} />
          <Field label={t('ai.field.examination')} value={exam} onChangeText={setExam} multiline editable={pending} placeholder={empty} />
          <Field label={t('emr.notes')} value={notes} onChangeText={setNotes} multiline editable={pending} placeholder={empty} />

          <Section title={t('emr.vitals')}>
            <View style={s.wrap}>
              {VITALS.map((v) => (
                <View key={v.key} style={{ width: '50%', paddingEnd: 8 }}>
                  <Field label={t(v.label)} value={vitals[v.key] ?? ''} onChangeText={(x) => setVitals((o) => ({ ...o, [v.key]: x }))} keyboardType="decimal-pad" ltr editable={pending} error={vitalErrors[v.key]} />
                </View>
              ))}
            </View>
          </Section>

          <Section title={t('emr.diagnoses')}>
            {dx.map((x, i) => (
              <Row key={x.code} style={{ alignItems: 'center', marginBottom: 6 }}>
                <T ltr style={{ flex: 1, fontWeight: i === 0 ? '700' : '400' }}>{`${x.code} ${x.title}`}</T>
                {i === 0 ? <Muted>{t('emr.primary')}</Muted> : null}
                {pending ? <Button kind="ghost" title={t('common.remove')} onPress={() => setDx((all) => all.filter((y) => y.code !== x.code))} /> : null}
              </Row>
            ))}
            {!dx.length ? <Muted>{t('ai.noDiagnoses')}</Muted> : null}
            {pending ? (
              <>
                <Field label={t('emr.icdSearch')} value={dxQuery} onChangeText={setDxQuery} autoCapitalize="none" />
                {dxResults.slice(0, 8).map((r) => (
                  <ListItem
                    key={r.code}
                    title={`${r.code} · ${locale === 'ar' && r.title_ar ? r.title_ar : r.title_en}`}
                    onPress={() => {
                      if (!dx.some((y) => y.code === r.code)) setDx((all) => [...all, { code: r.code, title: locale === 'ar' && r.title_ar ? r.title_ar : r.title_en }]);
                      setDxQuery('');
                    }}
                  />
                ))}
              </>
            ) : null}
          </Section>

          <Field
            label={t('ai.followUpDays')}
            value={followUp}
            onChangeText={setFollowUp}
            keyboardType="number-pad"
            ltr
            editable={pending}
            placeholder={empty}
            error={followUpError}
          />
          {fuDays !== undefined && !followUpError ? <Muted style={{ marginBottom: 12 }}>{`${t('visits.followUp')}: ${plainDate(addDays(localDate(new Date()), fuDays))}`}</Muted> : null}
        </>
      ) : null}

      <ErrorBox error={act.error} />
      {pending && draft ? (
        <>
          <Muted style={{ marginBottom: 8 }}>{t('ai.approveNote')}</Muted>
          <ActionButton title={t('ai.approve')} onPress={approve} loading={act.busy} disabled={!valid} />
        </>
      ) : null}
      {pending ? <ActionButton kind="danger" title={t('ai.reject')} onPress={reject} loading={act.busy} /> : null}
      <Button kind="ghost" title={t('common.back')} onPress={() => router.back()} />
    </Screen>
  );
}
