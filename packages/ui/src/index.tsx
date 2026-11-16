import { clsx } from 'clsx';
import * as React from 'react';
import { formatDate, formatMoney, formatTime12, t, toArabicIndicDigits, type AppointmentStatus, type Locale } from '@hf/shared';

export { clsx as cx };

type Div = React.HTMLAttributes<HTMLDivElement>;

export function Button({ variant = 'primary', size = 'md', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      {...p}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4',
        size === 'lg' && 'h-12 px-6 text-lg',
        variant === 'primary' && 'bg-primary text-primary-fg hover:opacity-90',
        variant === 'secondary' && 'border border-border bg-surface hover:bg-bg',
        variant === 'ghost' && 'hover:bg-bg',
        variant === 'danger' && 'bg-danger text-white hover:opacity-90',
        className,
      )}
    />
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} {...p} className={clsx('h-10 w-full rounded-xl border border-border bg-surface px-3 text-fg placeholder:text-muted', className)} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} {...p} className={clsx('h-10 w-full rounded-xl border border-border bg-surface px-3 text-fg', className)} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} dir="auto" {...p} className={clsx('min-h-24 w-full rounded-xl border border-border bg-surface p-3 text-fg', className)} />;
});

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Card({ className, ...p }: Div) {
  return <div {...p} className={clsx('rounded-xl border border-border bg-surface p-4 shadow-sm', className)} />;
}

export function PageHeader({ title, actions, subtitle }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }) {
  return (
    <span
      {...p}
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-bg text-muted',
        tone === 'primary' && 'bg-primary/10 text-primary',
        tone === 'success' && 'bg-success/10 text-success',
        tone === 'warning' && 'bg-warning/10 text-warning',
        tone === 'danger' && 'bg-danger/10 text-danger',
        className,
      )}
    />
  );
}

const STATUS_TONE: Record<AppointmentStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  requested: 'warning', booked: 'primary', confirmed: 'primary', checked_in: 'warning', in_consultation: 'warning', completed: 'success', no_show: 'danger', cancelled: 'neutral',
};

export function StatusBadge({ status, locale }: { status: AppointmentStatus; locale: Locale }) {
  return <Badge tone={STATUS_TONE[status]}>{t(locale, `status.${status}`)}</Badge>;
}

/** Isolates mixed-direction content such as names, phones and codes (LOC-2). */
export function Bdi({ children, className }: { children: React.ReactNode; className?: string }) {
  return <bdi className={className}>{children}</bdi>;
}

export function Money({ value, locale, arabicDigits }: { value: number; locale: Locale; arabicDigits?: boolean }) {
  return <span className="num">{formatMoney(value, locale, { arabicDigits })}</span>;
}

export function DateText({ value, locale, withTime, arabicDigits }: { value: string | Date; locale: Locale; withTime?: boolean; arabicDigits?: boolean }) {
  const d = typeof value === 'string' ? new Date(value) : value;
  let s = formatDate(d) + (withTime ? ` ${formatTime12(d, locale)}` : '');
  if (arabicDigits) s = toArabicIndicDigits(s);
  return <time dateTime={d.toISOString()}>{s}</time>;
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" aria-label={label} className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
  );
}

export function EmptyState({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-8 text-center text-muted">
      <p>{title}</p>
      {action}
    </div>
  );
}

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'warning' | 'success' | 'info'; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={clsx(
        'rounded-xl border p-3 text-sm',
        tone === 'danger' && 'border-danger/30 bg-danger/5 text-danger',
        tone === 'warning' && 'border-warning/30 bg-warning/5 text-warning',
        tone === 'success' && 'border-success/30 bg-success/5 text-success',
        tone === 'info' && 'border-accent/30 bg-accent/5 text-accent',
      )}
    >
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-sm text-muted">{label}</span>
      <span className="num text-start text-2xl font-bold">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </Card>
  );
}

export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table {...p} className={clsx('w-full border-collapse text-sm [&_td]:border-t [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:bg-bg [&_th]:px-3 [&_th]:py-2 [&_th]:text-start [&_th]:font-medium', className)} />
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-border">
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={clsx('-mb-px border-b-2 px-4 py-2 text-sm', value === i.value ? 'border-primary font-medium text-primary' : 'border-transparent text-muted hover:text-fg')}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** Accessible modal using the native <dialog> element. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className="w-full max-w-lg rounded-xl border border-border bg-surface p-0 text-fg backdrop:bg-black/40">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        <button aria-label="close" onClick={onClose} className="rounded-lg px-2 text-muted hover:bg-bg">
          ×
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}

/** Direction-aware chevron: mirrored automatically in RTL. */
export function ChevronNext({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={clsx('dir-icon h-4 w-4', className)} fill="currentColor">
      <path d="M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4L11.6 10 7.3 5.7a1 1 0 0 1 0-1.4Z" />
    </svg>
  );
}

export function OnlineIndicator({ online, labels }: { online: boolean; labels: { online: string; offline: string } }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs" aria-live="polite">
      <span className={clsx('h-2 w-2 rounded-full', online ? 'bg-success' : 'bg-danger')} />
      {online ? labels.online : labels.offline}
    </span>
  );
}
