'use client';

import { useState } from 'react';
import { Alert, Bdi, Button, PageHeader } from '@hf/ui';
import { Loading, Section, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { QueueBoard } from '@/components/queue-board';
import { VitalsFields, vitalsPayload } from '@/components/vitals';
import { useToast } from '@/components/toast';
import { get, post } from '@/lib/api';
import { findOpenEncounter } from '@/lib/encounters';
import type { QueueTicket } from '@/lib/types';

/** Nurse: vitals and triage for checked-in patients (SRS §4). */
export default function NursePage() {
  const { t } = useI18n();
  const toast = useToast();
  const [ticket, setTicket] = useState<QueueTicket | null>(null);
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [vitals, setVitals] = useState<Record<string, string>>({});
  const [allergies, setAllergies] = useState<string[]>([]);
  const load = useAction();
  const save = useAction();

  async function pick(tk: QueueTicket) {
    setTicket(tk);
    setEncounterId(null);
    setVitals({});
    await load.run(async () => {
      const e = await findOpenEncounter(tk.patient_id, tk.doctor_id);
      if (!e) throw new Error('no_encounter');
      const full = await get<{ vitals: Record<string, number>; allergies: { text: string }[] }>(`/encounters/${e.id}`);
      setEncounterId(e.id);
      setVitals(Object.fromEntries(Object.entries(full.vitals ?? {}).filter(([k]) => k !== 'bmi').map(([k, v]) => [k, String(v)])));
      setAllergies(full.allergies.map((a) => a.text));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nurse.title')} subtitle={t('nurse.hint')} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title={t('rec.queue')}>
          <QueueBoard onSelectTicket={(tk) => void pick(tk)} compact />
        </Section>
        <Section title={t('emr.vitals')}>
          {!ticket ? (
            <p className="text-sm text-muted">{t('nurse.pick')}</p>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!encounterId) return;
                const r = await save.run(() => post(`/encounters/${encounterId}/vitals`, vitalsPayload(vitals)));
                if (r) toast(t('nurse.saved', { n: ticket.ticket_number }));
              }}
            >
              <p className="text-sm">
                <span className="num font-bold">{ticket.ticket_number}</span> · <Bdi>{ticket.patient_name ?? ''}</Bdi> · <Bdi className="text-muted">{ticket.doctor_name}</Bdi>
              </p>
              {allergies.length > 0 && (
                <div role="alert" className="rounded-xl border-2 border-danger bg-danger/10 p-2 text-sm text-danger">
                  {t('patient.allergies')}: {allergies.join(' · ')}
                </div>
              )}
              {load.busy && <Loading />}
              {load.error && <Alert tone="danger">{t('doc.noEncounter')}</Alert>}
              {encounterId && (
                <>
                  <VitalsFields value={vitals} onChange={setVitals} />
                  {save.error && <Alert tone="danger">{save.error}</Alert>}
                  <Button type="submit" disabled={save.busy} className="self-start">
                    {t('nurse.saveVitals')}
                  </Button>
                </>
              )}
            </form>
          )}
        </Section>
      </div>
    </div>
  );
}
