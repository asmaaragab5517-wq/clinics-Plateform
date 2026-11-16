'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { cx } from '@hf/ui';

type Tone = 'success' | 'danger' | 'warning' | 'info';
interface ToastItem {
  id: number;
  tone: Tone;
  text: string;
}

const Ctx = createContext<(text: string, tone?: Tone) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-4), { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'danger' ? 8000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 end-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
        {items.map((i) => (
          <div
            key={i.id}
            role={i.tone === 'danger' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto rounded-xl border p-3 text-sm shadow-lg',
              i.tone === 'success' && 'border-success/30 bg-surface text-success',
              i.tone === 'danger' && 'border-danger/30 bg-surface text-danger',
              i.tone === 'warning' && 'border-warning/30 bg-surface text-warning',
              i.tone === 'info' && 'border-accent/30 bg-surface text-accent',
            )}
          >
            {i.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
