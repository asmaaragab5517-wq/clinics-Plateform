'use client';

import { useState } from 'react';
import { Alert, Button } from '@hf/ui';
import { useI18n } from './i18n';

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
          setCopied(false);
        }
      }}
      aria-live="polite"
    >
      {copied ? t('secret.copied') : (label ?? t('secret.copy'))}
    </Button>
  );
}

/** A credential shown exactly once (webhook signing secret, API key): copy it now, it cannot be retrieved later. */
export function OneTimeSecret({ title, value, onDone, children }: { title: string; value: string; onDone: () => void; children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-warning p-3">
      <Alert tone="warning">
        <strong>{title}</strong> — {t('secret.once')}
      </Alert>
      <div className="flex flex-wrap items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 break-all rounded-lg bg-bg px-3 py-2 font-mono text-sm" aria-label={title}>
          {value}
        </code>
        <CopyButton value={value} />
      </div>
      {children}
      <Button type="button" variant="ghost" className="self-start" onClick={onDone}>
        {t('secret.stored')}
      </Button>
    </div>
  );
}
