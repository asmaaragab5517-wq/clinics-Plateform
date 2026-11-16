import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { ARABIC_WEEKDAYS, weekdayOf } from '@hf/shared';
import { Chip, Empty, ErrorBox, Loading, Muted, s } from './ui';
import { publicApi } from '../lib/endpoints';
import { plainDate, time } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useQuery } from '../lib/useQuery';
import type { Slot } from '../lib/types';

const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Free slots for the next 14 days (GET /v1/public/slots), grouped by Cairo date. */
export function SlotPicker({ doctorId, clinicId, serviceId, selected, onSelect }: { doctorId: string; clinicId?: string; serviceId?: string; selected?: Slot | null; onSelect: (s: Slot) => void }) {
  const { t, locale } = useI18n();
  const q = useQuery(`slots:${doctorId}:${clinicId ?? ''}:${serviceId ?? ''}`, () => publicApi.slots({ doctorId, clinicId, serviceId, days: 14 }));
  const days = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const sl of q.data ?? []) m.set(sl.date, [...(m.get(sl.date) ?? []), sl]);
    return [...m.entries()];
  }, [q.data]);
  const [day, setDay] = useState<string | null>(null);
  const activeDay = day ?? days[0]?.[0] ?? null;
  const dayName = (d: string) => (locale === 'ar' ? ARABIC_WEEKDAYS : EN_WEEKDAYS)[weekdayOf(d)] ?? '';

  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.reload()} />;
  if (!days.length) return <Empty text={t('booking.noSlots')} />;
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        {days.map(([d, list]) => (
          <Chip key={d} label={`${dayName(d)} ${plainDate(d).slice(0, 5)} (${list.length})`} selected={d === activeDay} onPress={() => setDay(d)} />
        ))}
      </ScrollView>
      <Muted style={{ marginBottom: 6 }}>{activeDay ? plainDate(activeDay) : ''}</Muted>
      <View style={s.wrap}>
        {(days.find(([d]) => d === activeDay)?.[1] ?? []).map((sl) => (
          <Chip key={`${sl.start}:${sl.clinicId}`} label={time(sl.start, locale)} selected={selected?.start === sl.start && selected.clinicId === sl.clinicId} onPress={() => onSelect(sl)} />
        ))}
      </View>
    </View>
  );
}
