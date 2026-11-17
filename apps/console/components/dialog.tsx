'use client';

import { useEffect, useRef } from 'react';
import { cx } from '@hf/ui';
import { useI18n } from './i18n';

/**
 * Console modal on the native <dialog> element. Same look as `@hf/ui` Dialog, but the close button's accessible
 * name comes from the catalogue (the shared component hard-codes an English "close").
 */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className={cx('w-full rounded-xl border border-border bg-surface p-0 text-fg backdrop:bg-black/40', wide ? 'max-w-3xl' : 'max-w-lg')}>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        <button type="button" aria-label={t('common.close')} onClick={onClose} className="rounded-lg px-2 text-muted hover:bg-bg">
          ×
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
