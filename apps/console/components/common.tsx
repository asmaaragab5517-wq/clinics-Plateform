'use client';

import { useId, useState } from 'react';
import { Alert, Button, EmptyState, Field, Input, Select, Spinner, Textarea, cx } from '@hf/ui';
import { Dialog } from './dialog';
import { useI18n } from './i18n';

export function ErrorAlert({ error }: { error: unknown }) {
  const { err } = useI18n();
  if (!error) return null;
  return <Alert tone="danger">{err(error)}</Alert>;
}

export function Loading({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cx('flex items-center gap-2 p-4 text-sm text-muted', className)}>
      <Spinner label={t('common.loading')} />
      <span>{t('common.loading')}</span>
    </div>
  );
}

/** Loading / error / empty states around a data block. */
export function DataState<T>({ loading, error, data, empty, children }: { loading: boolean; error: unknown; data: T | undefined; empty?: (d: T) => boolean; children: (d: T) => React.ReactNode }) {
  const { t } = useI18n();
  if (error) return <ErrorAlert error={error} />;
  if (loading && data === undefined) return <Loading />;
  if (data === undefined) return null;
  if (empty?.(data)) return <EmptyState title={t('common.empty')} />;
  return <>{children(data)}</>;
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null };
export function TextField({ label, hint, error, id, ...p }: InputProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid}>
      <Input id={fid} aria-invalid={!!error || undefined} {...p} />
    </Field>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string | null; options: { value: string; label: string }[]; placeholder?: string };
export function SelectField({ label, hint, error, id, options, placeholder, ...p }: SelectProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid}>
      <Select id={fid} aria-invalid={!!error || undefined} {...p}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

type AreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string | null };
export function TextAreaField({ label, hint, error, id, ...p }: AreaProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid}>
      <Textarea id={fid} {...p} />
    </Field>
  );
}

export function Check({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--hf-primary))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="text-sm">
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </label>
    </div>
  );
}

/** Ask for a reason (cancellations, voids, refunds, merges). */
export function ReasonDialog({ open, title, minLength = 3, onClose, onSubmit, confirmLabel, children }: { open: boolean; title: string; minLength?: number; onClose: () => void; onSubmit: (reason: string) => Promise<void> | void; confirmLabel?: string; children?: React.ReactNode }) {
  const { t, err } = useI18n();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (reason.trim().length < minLength) {
            setError(t('form.reasonMin', { n: minLength }));
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await onSubmit(reason.trim());
            setReason('');
            onClose();
          } catch (x) {
            setError(err(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
        <TextAreaField label={t('form.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={minLength} error={error} autoFocus />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Confirm a destructive action (delete, remove). Errors from `onConfirm` stay in the dialog. */
export function ConfirmDialog({ open, title, message, confirmLabel, onClose, onConfirm, children }: { open: boolean; title: string; message: string; confirmLabel?: string; onClose: () => void; onConfirm: () => Promise<unknown> | void; children?: React.ReactNode }) {
  const { t, err } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={title}>
      <div className="flex flex-col gap-3">
        <p className="text-sm">{message}</p>
        {children}
        <InlineError text={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (x) {
                setError(err(x));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel ?? t('common.delete')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Link to a PDF/CSV/XLSX streamed through the BFF. */
export function FileLink({ href, children, variant = 'secondary' }: { href: string; children: React.ReactNode; variant?: 'secondary' | 'ghost' | 'primary' }) {
  return (
    <a
      href={`/api/v1${href}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cx(
        'inline-flex h-8 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium',
        variant === 'secondary' && 'border border-border bg-surface hover:bg-bg',
        variant === 'ghost' && 'hover:bg-bg',
        variant === 'primary' && 'bg-primary text-primary-fg hover:opacity-90',
      )}
    >
      {children}
    </a>
  );
}

export function Section({ title, actions, children, className }: { title: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-border bg-surface p-4 shadow-sm', className)} aria-label={title}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Async button that shows API errors inline via a callback. */
export function useAction() {
  const { err } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(err(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function InlineError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {text}
    </p>
  );
}

export function KeyHint({ k }: { k: string }) {
  return <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-xs text-muted">{k}</kbd>;
}
