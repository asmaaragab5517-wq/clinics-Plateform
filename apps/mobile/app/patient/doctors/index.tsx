import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Chip, Empty, ErrorBox, Field, ListItem, Loading, Muted, Screen } from '../../../components/ui';
import { publicApi } from '../../../lib/endpoints';
import { money } from '../../../lib/format';
import { useI18n } from '../../../lib/i18n';
import { useQuery } from '../../../lib/useQuery';

/** Find a doctor (FR-APP-1): name search + specialty filter; shows fee and rating. */
export default function FindDoctor() {
  const { t, pick, locale } = useI18n();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [specialty, setSpecialty] = useState<string | undefined>();
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);

  const specialties = useQuery('specialties', publicApi.specialties);
  const doctors = useQuery(`doctors:${debounced}:${specialty ?? ''}`, () => publicApi.doctors({ q: debounced || undefined, specialty }));

  return (
    <Screen>
      <Field label={t('common.search')} value={q} onChangeText={setQ} placeholder={t('doctor.searchPlaceholder')} returnKeyType="search" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        <Chip label={t('doctor.allSpecialties')} selected={!specialty} onPress={() => setSpecialty(undefined)} />
        {(specialties.data ?? []).map((sp) => (
          <Chip key={sp.id} label={pick(sp)} selected={specialty === sp.slug} onPress={() => setSpecialty(sp.slug)} />
        ))}
      </ScrollView>
      <ErrorBox error={doctors.error} onRetry={() => void doctors.reload()} />
      {doctors.loading ? <Loading /> : null}
      {doctors.data && !doctors.data.length ? <Empty text={t('doctor.none')} /> : null}
      {(doctors.data ?? []).map((d) => {
        const rating = d.rating_avg != null ? Number(d.rating_avg).toFixed(1) : null;
        const sub = [d.specialties.map((x) => pick(x)).join(locale === 'ar' ? ' - ' : ', '), d.fee != null ? `${t('doctor.fee')}: ${money(d.fee, locale)}` : null, rating ? `${t('doctor.rating')}: ${rating} (${d.rating_count ?? 0})` : null]
          .filter(Boolean)
          .join(' · ');
        return <ListItem key={d.id} title={[d.title, pick(d)].filter(Boolean).join(' ')} subtitle={sub} onPress={() => router.push({ pathname: '/patient/doctors/[slug]', params: { slug: d.slug } })} />;
      })}
      {doctors.data?.length ? <Muted style={{ textAlign: 'center' }}>{t('doctor.count', { count: doctors.data.length })}</Muted> : null}
    </Screen>
  );
}
