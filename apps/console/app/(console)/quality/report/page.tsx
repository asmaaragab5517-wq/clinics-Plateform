'use client';

import { useState } from 'react';
import { PageHeader, Tabs } from '@hf/ui';
import { Section } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { ComplaintForm, IncidentForm } from '@/components/quality';

type Tab = 'incident' | 'complaint';

/** Report a patient-safety incident (any clinical or front-desk role with quality:create), or log a patient complaint. */
export default function ReportPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('incident');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.reportIncident')} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'incident', label: t('quality.reportIncident') },
          { value: 'complaint', label: t('quality.logComplaint') },
        ]}
      />
      <Section title={tab === 'incident' ? t('quality.reportIncident') : t('quality.logComplaint')} className="max-w-3xl">
        {tab === 'incident' ? <IncidentForm /> : <ComplaintForm />}
      </Section>
    </div>
  );
}
