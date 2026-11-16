import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Field, ListItem, Loading } from './ui';
import { staffApi } from '../lib/endpoints';
import { patientName, phone } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { PatientSearchRow } from '../lib/types';

/** Staff patient search by phone, National ID, MRN or name (GET /v1/patients?q=, LOC-8 normalisation server-side). */
export function PatientPicker({ onPick }: { onPick: (p: PatientSearchRow) => void }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PatientSearchRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setRows(null);
    const id = setTimeout(() => {
      setLoading(true);
      staffApi
        .searchPatients(term)
        .then((r) => {
          setRows(r);
          setError(null);
        })
        .catch(setError)
        .finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(id);
  }, [q]);
  return (
    <>
      <Field label={t('reception.patientSearch')} value={q} onChangeText={setQ} placeholder={t('reception.patientSearchHint')} autoCorrect={false} />
      {loading ? <Loading /> : null}
      <ErrorBox error={error} />
      {rows && !rows.length ? <Empty text={t('reception.noPatients')} /> : null}
      {(rows ?? []).map((p) => (
        <ListItem key={p.id} title={patientName(p, locale)} subtitle={[p.mrn, p.phone ? phone(p.phone) : null].filter(Boolean).join(' · ')} onPress={() => onPick(p)} />
      ))}
    </>
  );
}
