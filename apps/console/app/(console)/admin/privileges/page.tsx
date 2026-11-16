'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, PageHeader, Tabs } from '@hf/ui';
import { DataState, Section, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { del, put } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Matrix {
  defaults: Record<string, string[]>;
  overrides: Record<string, string[]>;
  modules: string[];
  actions: string[];
}

const EDITABLE = ['network_director', 'clinic_manager', 'doctor', 'nurse', 'receptionist', 'accountant'];

/** IAM-1: privilege matrix per role (module × action), editable by the Owner, audited, resettable. */
export default function PrivilegesPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<Matrix>('/org/privileges');
  const [role, setRole] = useState('receptionist');
  const [set, setSet] = useState<Set<string>>(new Set());
  const a = useAction();
  useEffect(() => {
    if (q.data) setSet(new Set(q.data.overrides?.[role] ?? q.data.defaults[role] ?? []));
  }, [q.data, role]);
  const ro = !can('settings:edit');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.privileges')} subtitle={t('priv.hint')} />
      <Tabs<string> value={role} onChange={setRole} items={EDITABLE.map((r) => ({ value: r, label: t(`role.${r}`) }))} />
      <DataState loading={q.loading} error={q.error} data={q.data}>
        {(m) => {
          const overridden = !!m.overrides?.[role];
          const defaults = new Set(m.defaults[role] ?? []);
          return (
            <Section
              title={t(`role.${role}`)}
              actions={
                !ro && (
                  <>
                    {overridden && <span className="text-xs text-warning">{t('priv.customised')}</span>}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        if (!window.confirm(t('priv.confirmReset'))) return;
                        const r = await a.run(() => del(`/org/privileges/${role}`));
                        if (r) {
                          toast(t('priv.resetDone'));
                          q.reload();
                        }
                      }}
                    >
                      {t('priv.reset')}
                    </Button>
                    <Button
                      size="sm"
                      onClick={async () => {
                        const r = await a.run(() => put(`/org/privileges/${role}`, { privileges: [...set].sort() }));
                        if (r) {
                          toast(t('common.saved'));
                          q.reload();
                        }
                      }}
                    >
                      {t('common.save')}
                    </Button>
                  </>
                )
              }
            >
              {a.error && <Alert tone="danger">{a.error}</Alert>}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="p-1 text-start">{t('priv.module')}</th>
                      {m.actions.map((ac) => (
                        <th key={ac} className="p-1 text-center">
                          {t(`priv.action.${ac}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.modules.map((mod) => (
                      <tr key={mod} className="border-t border-border">
                        <th scope="row" className="p-1 text-start font-normal">
                          {t(`priv.mod.${mod}`)}
                        </th>
                        {m.actions.map((ac) => {
                          const k = `${mod}:${ac}`;
                          const on = set.has(k);
                          const changed = on !== defaults.has(k);
                          return (
                            <td key={ac} className={`p-1 text-center ${changed ? 'bg-warning/10' : ''}`}>
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={on}
                                disabled={ro}
                                aria-label={`${t(`priv.mod.${mod}`)} — ${t(`priv.action.${ac}`)}`}
                                onChange={(e) => {
                                  const n = new Set(set);
                                  if (e.target.checked) n.add(k);
                                  else n.delete(k);
                                  setSet(n);
                                }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted">{t('priv.legend')}</p>
            </Section>
          );
        }}
      </DataState>
    </div>
  );
}
