import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { ActionButton, Banner, Chip, ErrorBox, Field, Muted, Screen, s } from '../../../components/ui';
import { portalApi } from '../../../lib/endpoints';
import { useI18n } from '../../../lib/i18n';
import { useAction } from '../../../lib/useQuery';

/** FR-REV-1: one rating per completed appointment. */
export default function Review() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const act = useAction();
  if (sent)
    return (
      <Screen>
        <Banner kind="success">{t('review.thanks')}</Banner>
        <ActionButton title={t('nav.home')} onPress={() => router.replace('/patient')} />
      </Screen>
    );
  return (
    <Screen>
      <Muted style={{ marginBottom: 8 }}>{t('review.prompt')}</Muted>
      <View style={s.wrap}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Chip key={n} label={`${n} ★`} selected={rating === n} onPress={() => setRating(n)} />
        ))}
      </View>
      <Field label={t('review.comment')} value={comment} onChangeText={setComment} multiline maxLength={2000} />
      <ErrorBox error={act.error} />
      <ActionButton title={t('review.submit')} disabled={!rating || !id} loading={act.busy} onPress={() => void act.run(async () => { await portalApi.review(id!, rating, comment.trim()); setSent(true); })} />
    </Screen>
  );
}
