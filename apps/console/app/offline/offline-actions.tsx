'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Button } from '@hf/ui';
import { useI18n } from '@/components/i18n';
import { useOnline } from '@/lib/hooks';
import { getServerSnapshot, getSnapshot, subscribe } from '@/lib/offline';

export function OfflineActions() {
  const { t } = useI18n();
  const online = useOnline();
  const queue = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Back online: reload the page that failed; the console shell then replays the offline queue.
  useEffect(() => {
    if (online && window.location.pathname !== '/offline') window.location.reload();
  }, [online]);
  return (
    <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
      <h1 className="font-display text-xl font-bold">{t('pwa.offlineTitle')}</h1>
      <p className="text-sm text-muted">{t('pwa.offlineBody')}</p>
      {queue.pending.length > 0 && <p className="rounded-full bg-warning/10 px-3 py-1 text-sm text-warning">{t('offline.pending', { n: queue.pending.length })}</p>}
      <p className="text-xs text-muted" role="status">
        {online ? t('common.online') : t('shell.offline')}
      </p>
      <Button onClick={() => (window.location.pathname === '/offline' ? window.location.assign('/') : window.location.reload())}>{t('common.retry')}</Button>
    </div>
  );
}
