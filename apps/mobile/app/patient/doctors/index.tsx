import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { addDays, localDate } from '@hf/shared';
import { DoctorAvatar, doctorPhotoPath } from '../../../components/DoctorAvatar';
import { Card, Chevron, Chip, Empty, ErrorBox, Field, Loading, Muted, Row, Screen, T, colors } from '../../../components/ui';
import { publicApi } from '../../../lib/endpoints';
import { dateTime, money } from '../../../lib/format';
import { useI18n, type TKey } from '../../../lib/i18n';
import { useQuery } from '../../../lib/useQuery';

/** `availableBy` presets: days from today (Africa/Cairo). */
const AVAILABILITY: { key: TKey; days: number | null }[] = [
  { key: 'doctor.availableAny', days: null },
  { key: 'doctor.availableToday', days: 0 },
  { key: 'doctor.availableTomorrow', days: 1 },
  { key: 'doctor.availableWeek', days: 6 },
];

/**
 * Find a doctor (FR-APP-1, FR-WEB-2): name search, specialty, city and "available by" filters. Each row shows the
 * public photo, fee, rating and the next available slot from GET /v1/public/doctors.
 */
export default function FindDoctor() {
  const { t, pick, locale } = useI18n();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [specialty, setSpecialty] = useState<string | undefined>();
  const [city, setCity] = useState<string | undefined>();
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);

  const specialties = useQuery('specialties', publicApi.specialties);
  const clinics = useQuery('public:clinics', publicApi.clinics);
  const cities = useMemo(() => [...new Set((clinics.data ?? []).map((c) => c.city).filter((c): c is string => !!c))].sort(), [clinics.data]);
  const availableBy = days == null ? undefined : addDays(localDate(new Date()), days);
  const doctors = useQuery(`doctors:${debounced}:${specialty ?? ''}:${city ?? ''}:${availableBy ?? ''}`, () =>
    publicApi.doctors({ q: debounced || undefined, specialty, city, availableBy }),
  );

  return (
    <Screen>
      <Field label={t('common.search')} value={q} onChangeText={setQ} placeholder={t('doctor.searchPlaceholder')} returnKeyType="search" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
        <Chip label={t('doctor.allSpecialties')} selected={!specialty} onPress={() => setSpecialty(undefined)} />
        {(specialties.data ?? []).map((sp) => (
          <Chip key={sp.id} label={pick(sp)} selected={specialty === sp.slug} onPress={() => setSpecialty(sp.slug)} />
        ))}
      </ScrollView>
      {cities.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
          <Chip label={t('doctor.allCities')} selected={!city} onPress={() => setCity(undefined)} />
          {cities.map((c) => (
            <Chip key={c} label={c} selected={city === c} onPress={() => setCity(c)} />
          ))}
        </ScrollView>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        {AVAILABILITY.map((a) => (
          <Chip key={a.key} label={t(a.key)} selected={days === a.days} onPress={() => setDays(a.days)} />
        ))}
      </ScrollView>
      <ErrorBox error={doctors.error} onRetry={() => void doctors.reload()} />
      {doctors.loading ? <Loading /> : null}
      {doctors.data && !doctors.data.length ? <Empty text={t('doctor.none')} /> : null}
      {(doctors.data ?? []).map((d, i) => {
        const name = [d.title, pick(d)].filter(Boolean).join(' ');
        const rating = d.rating_avg != null ? Number(d.rating_avg).toFixed(1) : null;
        const sub = [d.specialties.map((x) => pick(x)).join(locale === 'ar' ? ' - ' : ', '), d.fee != null ? `${t('doctor.fee')}: ${money(d.fee, locale)}` : null, rating ? `${t('doctor.rating')}: ${rating} (${d.rating_count ?? 0})` : null]
          .filter(Boolean)
          .join(' · ');
        // The API computes next_available for the first 60 rows only (public.ts), so stay silent beyond that.
        const next = d.next_available ? `${t('doctor.nextAvailable')}: ${dateTime(d.next_available, locale)}` : i < 60 ? t('doctor.noAvailability') : null;
        return (
          <Card key={d.id} onPress={() => router.push({ pathname: '/patient/doctors/[slug]', params: { slug: d.slug } })} accessibilityLabel={[name, sub, next].filter(Boolean).join(', ')}>
            <Row style={{ alignItems: 'center' }}>
              <DoctorAvatar path={doctorPhotoPath(d)} name={pick(d)} />
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: '600' }}>{name}</T>
                {sub ? <Muted>{sub}</Muted> : null}
                {next ? <T style={{ fontSize: 14, marginTop: 2, color: d.next_available ? colors.success : colors.muted, fontWeight: '600' }}>{next}</T> : null}
              </View>
              <Chevron />
            </Row>
          </Card>
        );
      })}
      {doctors.data?.length ? <Muted style={{ textAlign: 'center' }}>{t('doctor.count', { count: doctors.data.length })}</Muted> : null}
    </Screen>
  );
}
