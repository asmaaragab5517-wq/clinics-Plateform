'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button, PageHeader } from '@hf/ui';
import { KeyHint, Section } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { PatientSearch } from '@/components/patient-search';
import { RegisterPatientDialog } from '@/components/register-patient';
import { useSession, useShortcuts } from '@/components/session';

export default function PatientsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  useShortcuts({ '/': () => ref.current?.focus(), r: () => can('patient:create') && setOpen(true) });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('nav.patients')}
        actions={
          can('patient:create') ? (
            <Button onClick={() => setOpen(true)}>
              {t('pat.register')} <KeyHint k="r" />
            </Button>
          ) : null
        }
      />
      <Section title={t('pat.find')} className="max-w-2xl">
        <PatientSearch ref={ref} onSelect={(p) => router.push(`/patients/${p.id}`)} />
      </Section>
      <RegisterPatientDialog open={open} onClose={() => setOpen(false)} onCreated={(p) => router.push(`/patients/${p.id}`)} onUseExisting={(id) => router.push(`/patients/${id}`)} />
    </div>
  );
}
