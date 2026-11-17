import { useState } from 'react';
import { Alert, View } from 'react-native';
import { localDate, toWesternDigits } from '@hf/shared';
import { ActionButton, Banner, Button, Card, Chip, Empty, ErrorBox, Field, Loading, Muted, Row, Screen, Section, StatusBadge, T, colors, s, useErrorText } from '../../components/ui';
import { ApiError, isApiError } from '../../lib/api';
import { portalApi } from '../../lib/endpoints';
import { money, patientName, plainDate } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useAction, useQuery } from '../../lib/useQuery';
import type { PortalCoverage } from '../../lib/types';

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Most pending (unverified) submissions per patient (portal.ts `addCoverage`). */
const MAX_PENDING = 3;

/** Submitted by the patient and not verified by reception yet (older APIs omit `verified`: treated as verified). */
const isPending = (c: PortalCoverage) => c.verified === false && c.is_active;
/** Withdrawn by the patient or not accepted by reception: both leave it inactive and unverified. */
const isClosed = (c: PortalCoverage) => c.verified === false && !c.is_active;
/** Withdrawn by the patient or rejected by the clinic, when the API says which. */
const closedKey = (c: PortalCoverage) =>
  c.status === 'withdrawn' ? 'insurance.statusWithdrawn' : c.status === 'rejected' ? 'insurance.statusRejected' : 'insurance.closed';

/** YYYY-MM-DD that is a real calendar date (Arabic-Indic digits accepted). */
function ymd(v: string): string | null {
  const x = toWesternDigits(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return null;
  const d = new Date(`${x}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x ? x : null;
}

/**
 * Insurance (GET /v1/portal/coverages). Staff-recorded cover is read-only. The patient can submit a card
 * (POST /v1/portal/coverages): it shows "Awaiting verification" and is not used for billing until reception verifies
 * it, and can be withdrawn until then (POST /v1/portal/coverages/:id/withdraw).
 */
export default function Insurance() {
  const { t, locale } = useI18n();
  const q = useQuery('coverages', portalApi.coverages);
  const me = useQuery('portal:me', portalApi.me);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const errorText = useErrorText();
  const withdrawAct = useAction();
  const patients = me.data?.patients ?? [];
  const nameOf = (id: string) => {
    const p = patients.find((x) => x.id === id);
    return p && patients.length > 1 ? patientName(p, locale) : null;
  };
  const rows = q.data ?? [];

  const withdraw = (c: PortalCoverage) =>
    Alert.alert(t('insurance.withdrawTitle'), t('insurance.withdrawConfirm'), [
      { text: t('insurance.withdrawKeep'), style: 'cancel' },
      {
        text: t('insurance.withdrawYes'),
        style: 'destructive',
        onPress: () =>
          void withdrawAct.run(async () => {
            try {
              await portalApi.withdrawCoverage(c.id);
              setNotice({ kind: 'success', text: t('insurance.withdrawn') });
            } catch (e) {
              // 404 once reception has verified (or already closed) the submission.
              setNotice({ kind: 'danger', text: e instanceof ApiError && e.status === 404 ? t('insurance.withdrawTooLate') : errorText(e) });
            }
            await q.reload();
          }),
      },
    ]);

  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      <Muted style={{ marginBottom: 12 }}>{t('insurance.intro')}</Muted>
      {me.data && !patients.length ? <Banner kind="info">{t('family.addSelfFirst')}</Banner> : null}
      {notice ? <Banner kind={notice.kind}>{notice.text}</Banner> : null}
      {adding && me.data ? (
        <AddCoverage
          coverages={rows}
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            setNotice({ kind: 'success', text: t('insurance.submitted') });
            void q.reload();
          }}
        />
      ) : patients.length ? (
        <ActionButton
          title={t('insurance.add')}
          onPress={() => {
            setNotice(null);
            setAdding(true);
          }}
        />
      ) : null}

      {rows.some(isPending) ? <Banner kind="info">{t('insurance.pendingExplain')}</Banner> : null}
      {q.loading && !q.data ? <Loading /> : null}
      <ErrorBox error={q.error} onRetry={() => void q.reload()} />
      {q.data && !q.data.length ? <Empty text={t('insurance.empty')} /> : null}
      {rows.map((c) => {
        const pct = num(c.coverage_percent);
        const copay = num(c.copay_fixed);
        const payer = (locale === 'en' && c.payer_name_en) || c.payer_name_ar || c.payer_name_en || t('insurance.payer');
        const who = nameOf(c.patient_id);
        const pending = isPending(c);
        const closed = isClosed(c);
        return (
          <Card key={c.id} style={closed ? { opacity: 0.75 } : undefined}>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: '700' }}>{payer}</T>
                {c.plan_name ? <Muted>{c.plan_name}</Muted> : null}
              </View>
              {pending ? (
                <StatusBadge label={t('insurance.pending')} tone="warn" />
              ) : closed ? (
                <StatusBadge label={t(closedKey(c))} tone="info" />
              ) : (
                <StatusBadge label={t(c.is_active ? 'insurance.active' : 'insurance.inactive')} tone={c.is_active ? 'success' : 'info'} />
              )}
            </Row>
            {who ? <T style={{ marginTop: 4 }}>{who}</T> : null}
            {pending ? <T style={{ marginTop: 4, color: colors.warn }}>{t('insurance.pendingNote')}</T> : null}
            {closed ? <Muted style={{ marginTop: 4 }}>{t(`${closedKey(c)}Note`)}</Muted> : null}
            <Row style={{ marginTop: 8, alignItems: 'center' }}>
              <Muted>{`${t('insurance.memberNumber')}: `}</Muted>
              <T ltr selectable style={{ fontWeight: '700' }}>
                {c.member_number}
              </T>
            </Row>
            {pct !== null ? <T>{`${t('insurance.coverage')}: ${t('insurance.percent', { pct: Math.round(pct * 100) / 100 })}`}</T> : null}
            {copay ? <T>{`${t('insurance.copay')}: ${money(copay, locale)}`}</T> : null}
            <Muted>{c.valid_to ? t('insurance.validRange', { from: plainDate(c.valid_from), to: plainDate(c.valid_to) }) : t('insurance.validFrom', { from: plainDate(c.valid_from) })}</Muted>
            {c.source ? <Muted>{t(c.source === 'patient' ? 'insurance.addedByYou' : 'insurance.addedByClinic')}</Muted> : null}
            {pending && c.source === 'patient' ? (
              <ActionButton kind="secondary" title={t('insurance.withdraw')} loading={withdrawAct.busy} onPress={() => withdraw(c)} style={{ marginTop: 10, marginBottom: 0 }} />
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

/** Add-insurance form: family member, insurer, plan, member number and validity (POST /v1/portal/coverages). */
function AddCoverage({ coverages, onCancel, onAdded }: { coverages: PortalCoverage[]; onCancel: () => void; onAdded: () => void }) {
  const { t, locale } = useI18n();
  const me = useQuery('portal:me', portalApi.me);
  const payers = useQuery('portal:payers', portalApi.payers);
  const errorText = useErrorText();
  const act = useAction();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [payerId, setPayerId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [member, setMember] = useState('');
  const [from, setFrom] = useState(() => localDate(new Date()));
  const [to, setTo] = useState('');
  const [touched, setTouched] = useState(false);

  const patients = me.data?.patients ?? [];
  const pid = patientId ?? patients[0]?.id ?? null;
  // A 404 means the API predates self-service cover: same message as "no insurer available".
  const payersMissing = isApiError(payers.error) && payers.error.status === 404;
  const choices = (payers.data ?? []).filter((p) => p.plans.length > 0);
  const payer = choices.find((p) => p.id === payerId);
  const memberNo = member.trim();
  const fromYmd = ymd(from);
  const toYmd = to.trim() ? ymd(to) : null;
  const memberError = touched && (memberNo.length < 2 || memberNo.length > 60) ? t('insurance.error.memberNumber') : null;
  const fromError = touched && !fromYmd ? t('insurance.error.dateFormat') : null;
  const toError = to.trim() && !toYmd ? t('insurance.error.dateFormat') : toYmd && fromYmd && toYmd < fromYmd ? t('insurance.error.invalidDates') : null;
  const atLimit = coverages.filter((c) => c.patient_id === pid && isPending(c)).length >= MAX_PENDING;
  const valid = !!pid && !!planId && memberNo.length >= 2 && memberNo.length <= 60 && !!fromYmd && !toError && !atLimit;

  const message = (e: unknown): string => {
    if (isApiError(e, 'too_many_pending_coverages')) return t('insurance.error.tooManyPending', { max: MAX_PENDING });
    if (isApiError(e, 'invalid_dates')) return t('insurance.error.invalidDates');
    if (e instanceof ApiError && e.status === 404) return t('insurance.error.planUnavailable');
    if (e instanceof ApiError && e.status === 403) return t('insurance.error.patientNotOnAccount');
    if (isApiError(e, 'validation_failed') && Array.isArray(e.details)) {
      const paths = (e.details as { path?: string }[]).map((d) => d.path ?? '');
      if (paths.includes('memberNumber')) return t('insurance.error.memberNumber');
      if (paths.some((p) => p === 'validFrom' || p === 'validTo')) return t('insurance.error.dateFormat');
    }
    return errorText(e);
  };

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    void act.run(async () => {
      try {
        await portalApi.addCoverage({ patientId: pid!, planId: planId!, memberNumber: memberNo, validFrom: fromYmd!, ...(toYmd ? { validTo: toYmd } : {}) });
      } catch (e) {
        // The plan may have been retired since the list loaded.
        if (e instanceof ApiError && e.status === 404) {
          setPlanId(null);
          void payers.reload();
        }
        throw e;
      }
      onAdded();
    });
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <T style={{ fontWeight: '700', fontSize: 18 }}>{t('insurance.addTitle')}</T>
      <Muted style={{ marginBottom: 12 }}>{t('insurance.addIntro')}</Muted>
      {payers.loading && !payers.data ? <Loading /> : null}
      {payers.error && !payersMissing ? <ErrorBox error={payers.error} onRetry={() => void payers.reload()} /> : null}
      {payersMissing || (payers.data && !choices.length) ? <Banner kind="info">{t('insurance.noPayers')}</Banner> : null}
      {choices.length ? (
        <View>
          {patients.length > 1 ? (
            <Section title={t('insurance.patient')}>
              <View style={s.wrap}>
                {patients.map((p) => (
                  <Chip key={p.id} label={patientName(p, locale)} selected={pid === p.id} onPress={() => setPatientId(p.id)} />
                ))}
              </View>
            </Section>
          ) : null}
          <Section title={t('insurance.payer')}>
            <View style={s.wrap}>
              {choices.map((p) => (
                <Chip
                  key={p.id}
                  label={(locale === 'en' && p.name_en) || p.name_ar}
                  selected={payerId === p.id}
                  onPress={() => {
                    setPayerId(p.id);
                    setPlanId(p.plans.length === 1 ? p.plans[0]!.id : null);
                  }}
                />
              ))}
            </View>
            {touched && !payerId ? <T style={{ color: colors.danger }}>{t('insurance.error.choosePayer')}</T> : null}
          </Section>
          {payer ? (
            <Section title={t('insurance.plan')}>
              <View style={s.wrap}>
                {payer.plans.map((p) => (
                  <Chip key={p.id} label={p.name} selected={planId === p.id} onPress={() => setPlanId(p.id)} />
                ))}
              </View>
              {touched && !planId ? <T style={{ color: colors.danger }}>{t('insurance.error.choosePlan')}</T> : null}
            </Section>
          ) : null}
          <Field label={t('insurance.memberNumber')} value={member} onChangeText={setMember} ltr autoCapitalize="characters" autoCorrect={false} maxLength={60} placeholder={t('insurance.memberNumberHint')} error={memberError} />
          <Field label={t('insurance.validFromLabel')} value={from} onChangeText={setFrom} ltr keyboardType="numbers-and-punctuation" maxLength={10} placeholder="2026-01-31" error={fromError} />
          <Field label={t('insurance.validToLabel')} value={to} onChangeText={setTo} ltr keyboardType="numbers-and-punctuation" maxLength={10} placeholder={t('insurance.validToHint')} error={toError} />
          {atLimit ? <Banner kind="warn">{t('insurance.error.tooManyPending', { max: MAX_PENDING })}</Banner> : null}
          {act.error ? <Banner kind="danger">{message(act.error)}</Banner> : null}
          <ActionButton title={t('insurance.submit')} onPress={submit} loading={act.busy} disabled={atLimit} />
        </View>
      ) : null}
      <Button kind="ghost" title={t('common.cancel')} onPress={onCancel} disabled={act.busy} style={{ marginBottom: 0 }} />
    </Card>
  );
}
