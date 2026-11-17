'use client';

import { useState } from 'react';
import { ROLES } from '@hf/shared';
import { Alert, Badge, Bdi, Button, DateText, PageHeader, Select, Table } from '@hf/ui';
import { Dialog } from '@/components/dialog';
import { Check, DataState, Section, SelectField, TextAreaField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post, put, upload } from '@/lib/api';
import { useServices } from '@/lib/data';
import { useApi } from '@/lib/hooks';
import { biName } from '@/lib/format';
import type { DoctorRow, StaffRow } from '@/lib/types';

const STAFF_ROLES = ROLES.filter((r) => r !== 'patient');
const ORG_ROLES = ['owner', 'network_director', 'accountant'];

/** FR-STF-1..4: invite, roles and clinic memberships, deactivation, doctor profile and private signature/stamp. */
export default function StaffPage() {
  const { t, locale } = useI18n();
  const { can, me } = useSession();
  const staff = useApi<StaffRow[]>('/staff');
  const doctors = useApi<DoctorRow[]>('/doctors');
  const [invite, setInvite] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [profile, setProfile] = useState<StaffRow | null>(null);
  const a = useAction();
  const clinicName = (id: string | null) => (id ? biName(me.clinics.find((c) => c.id === id), locale) : t('staff.orgWide'));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.staff')} actions={can('staff:create') ? <Button onClick={() => setInvite(true)}>{t('staff.invite')}</Button> : null} />
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      <Section title={t('nav.staff')}>
        <DataState loading={staff.loading} error={staff.error} data={staff.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('staff.name')}</th>
                  <th>{t('staff.contact')}</th>
                  <th>{t('staff.roles')}</th>
                  <th>{t('staff.mfa')}</th>
                  <th>{t('staff.lastLogin')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Bdi>{biName(u, locale)}</Bdi>
                    </td>
                    <td className="text-xs">
                      <Bdi className="block">{u.email}</Bdi>
                      <Bdi className="num block">{u.phone}</Bdi>
                    </td>
                    <td className="text-xs">
                      {u.memberships.map((m, i) => (
                        <span key={i} className="block">
                          {t(`role.${m.role}`)} · {clinicName(m.clinicId)}
                        </span>
                      ))}
                    </td>
                    <td>{u.mfa_enrolled ? <Badge tone="success">{t('common.yes')}</Badge> : <Badge tone="warning">{t('common.no')}</Badge>}</td>
                    <td>{u.last_login_at ? <DateText value={u.last_login_at} locale={locale} withTime /> : '—'}</td>
                    <td>
                      <Badge tone={u.status === 'active' ? 'success' : 'neutral'}>{t(`staff.status.${u.status}`)}</Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {can('staff:edit') && u.status === 'active' && (
                          <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                            {t('staff.memberships')}
                          </Button>
                        )}
                        {can('staff:edit') && u.memberships.some((m) => m.role === 'doctor') && (
                          <Button size="sm" variant="ghost" onClick={() => setProfile(u)}>
                            {t('staff.doctorProfile')}
                          </Button>
                        )}
                        {can('staff:delete') && u.status === 'active' && u.id !== me.userId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              if (!window.confirm(t('staff.confirmDeactivate'))) return;
                              const r = await a.run(() => post(`/staff/${u.id}/deactivate`));
                              if (r) staff.reload();
                            }}
                          >
                            {t('staff.deactivate')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      <InviteDialog open={invite} onClose={() => setInvite(false)} onDone={staff.reload} />
      <MembershipsDialog user={editing} onClose={() => setEditing(null)} onDone={staff.reload} />
      <DoctorProfileDialog user={profile} doctor={doctors.data?.find((d) => d.id === profile?.id) ?? null} onClose={() => setProfile(null)} onDone={doctors.reload} />
    </div>
  );
}

function InviteDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const toast = useToast();
  const [f, setF] = useState({ email: '', phone: '', ar: '', en: '', roles: ['receptionist'] as string[], clinicIds: [] as string[] });
  const a = useAction();
  const isOwner = me.roles.includes('owner');
  return (
    <Dialog open={open} onClose={onClose} title={t('staff.invite')}>
      <form
        className="flex max-h-[75vh] flex-col gap-3 overflow-y-auto"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await a.run(() => post('/staff/invite', { email: f.email || undefined, phone: f.phone || undefined, name: { ar: f.ar, en: f.en }, roles: f.roles, clinicIds: f.clinicIds }));
          if (r) {
            toast(t('staff.invited'));
            onDone();
            onClose();
          }
        }}
      >
        <TextField label={t('cat.nameAr')} value={f.ar} onChange={(e) => setF({ ...f, ar: e.target.value })} required dir="rtl" />
        <TextField label={t('cat.nameEn')} value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} dir="ltr" />
        <TextField label={t('pat.email')} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} dir="ltr" />
        <TextField label={t('pat.phone')} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} dir="ltr" />
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('staff.roles')}</legend>
          <div className="grid grid-cols-2 gap-1">
            {STAFF_ROLES.filter((r) => isOwner || !['owner', 'network_director'].includes(r)).map((r) => (
              <Check key={r} label={t(`role.${r}`)} checked={f.roles.includes(r)} onChange={(c) => setF({ ...f, roles: c ? [...f.roles, r] : f.roles.filter((x) => x !== r) })} />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('staff.clinics')}</legend>
          <div className="flex flex-col gap-1">
            {me.clinics.map((c) => (
              <Check key={c.id} label={biName(c, locale)} checked={f.clinicIds.includes(c.id)} onChange={(v) => setF({ ...f, clinicIds: v ? [...f.clinicIds, c.id] : f.clinicIds.filter((x) => x !== c.id) })} />
            ))}
          </div>
        </fieldset>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy || !f.roles.length}>
          {t('staff.sendInvite')}
        </Button>
      </form>
    </Dialog>
  );
}

function MembershipsDialog({ user, onClose, onDone }: { user: StaffRow | null; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const [rows, setRows] = useState<{ role: string; clinicId: string | null }[]>([]);
  const [lastId, setLastId] = useState('');
  if (user && user.id !== lastId) {
    setLastId(user.id);
    setRows(user.memberships.map((m) => ({ ...m })));
  }
  const a = useAction();
  return (
    <Dialog open={!!user} onClose={onClose} title={t('staff.memberships')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!user) return;
          const r = await a.run(() => put(`/staff/${user.id}/memberships`, { memberships: rows.map((m) => ({ role: m.role, clinicId: ORG_ROLES.includes(m.role) ? null : m.clinicId })) }));
          if (r) {
            onDone();
            onClose();
          }
        }}
      >
        {rows.map((m, i) => (
          <div key={i} className="flex gap-2">
            <Select value={m.role} aria-label={t('staff.roles')} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </Select>
            <Select value={m.clinicId ?? ''} aria-label={t('shell.clinic')} disabled={ORG_ROLES.includes(m.role)} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, clinicId: e.target.value || null } : x)))}>
              <option value="">{t('staff.orgWide')}</option>
              {me.clinics.map((c) => (
                <option key={c.id} value={c.id}>
                  {biName(c, locale)}
                </option>
              ))}
            </Select>
            <Button type="button" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              {t('common.remove')}
            </Button>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => setRows([...rows, { role: 'receptionist', clinicId: me.clinics[0]?.id ?? null }])}>
          {t('common.add')}
        </Button>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy || !rows.length}>
          {t('common.save')}
        </Button>
      </form>
    </Dialog>
  );
}

function DoctorProfileDialog({ user, doctor, onClose, onDone }: { user: StaffRow | null; doctor: DoctorRow | null; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const specialties = useApi<{ id: string; name_ar: string; name_en: string }[]>(user ? '/specialties' : null);
  const { active: services } = useServices();
  const [f, setF] = useState({ title: 'dr', slug: '', syndicateNumber: '', specialtyIds: [] as string[], gender: '', languages: 'ar', bioAr: '', bioEn: '', isPublic: true, serviceIds: [] as string[] });
  const [lastId, setLastId] = useState('');
  if (user && user.id !== lastId) {
    setLastId(user.id);
    setF({ title: doctor?.title ?? 'dr', slug: doctor?.slug ?? '', syndicateNumber: doctor?.syndicate_number ?? '', specialtyIds: doctor?.specialty_ids ?? [], gender: '', languages: 'ar', bioAr: '', bioEn: '', isPublic: doctor?.is_public ?? true, serviceIds: doctor?.service_ids ?? [] });
  }
  const a = useAction();
  async function uploadImage(kind: 'signature' | 'stamp' | 'photo', file: File | undefined) {
    if (!file || !user) return;
    const fd = new FormData();
    fd.set('file', file);
    const r = await a.run(() => upload(`/doctors/${user.id}/images/${kind}`, fd));
    if (r) toast(t('staff.imageUploaded'));
  }
  return (
    <Dialog open={!!user} onClose={onClose} title={t('staff.doctorProfile')}>
      <form
        className="flex max-h-[75vh] flex-col gap-3 overflow-y-auto"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!user) return;
          const r = await a.run(async () => {
            await put(`/doctors/${user.id}/profile`, {
              title: f.title,
              slug: f.slug,
              syndicateNumber: f.syndicateNumber,
              specialtyIds: f.specialtyIds,
              gender: f.gender || undefined,
              languages: f.languages.split(',').map((x) => x.trim()).filter(Boolean),
              bio: f.bioAr ? { ar: f.bioAr, en: f.bioEn } : undefined,
              isPublic: f.isPublic,
            });
            return put(`/doctors/${user.id}/services`, { serviceIds: f.serviceIds });
          });
          if (r) {
            toast(t('common.saved'));
            onDone();
          }
        }}
      >
        {user && <Bdi className="font-medium">{biName(user, locale)}</Bdi>}
        <div className="grid grid-cols-2 gap-2">
          <SelectField label={t('staff.title')} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} options={['prof', 'dr', 'consultant', 'specialist'].map((x) => ({ value: x, label: t(`doctorTitle.${x}`) }))} />
          <TextField label={t('staff.syndicate')} value={f.syndicateNumber} onChange={(e) => setF({ ...f, syndicateNumber: e.target.value })} pattern="\d{3,10}" required dir="ltr" />
          <TextField label={t('staff.slug')} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} pattern="[a-z0-9-]{2,80}" required dir="ltr" />
          <SelectField label={t('patient.gender')} value={f.gender} placeholder={t('form.none')} onChange={(e) => setF({ ...f, gender: e.target.value })} options={[{ value: 'male', label: t('patient.male') }, { value: 'female', label: t('patient.female') }]} />
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('staff.specialties')}</legend>
          <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto">
            {(specialties.data ?? []).map((s) => (
              <Check key={s.id} label={biName(s, locale)} checked={f.specialtyIds.includes(s.id)} onChange={(c) => setF({ ...f, specialtyIds: c ? [...f.specialtyIds, s.id] : f.specialtyIds.filter((x) => x !== s.id) })} />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('staff.services')}</legend>
          <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto">
            {services.map((s) => (
              <Check key={s.id} label={biName(s, locale)} checked={f.serviceIds.includes(s.id)} onChange={(c) => setF({ ...f, serviceIds: c ? [...f.serviceIds, s.id] : f.serviceIds.filter((x) => x !== s.id) })} />
            ))}
          </div>
        </fieldset>
        <TextField label={t('staff.languages')} value={f.languages} onChange={(e) => setF({ ...f, languages: e.target.value })} dir="ltr" hint={t('staff.languagesHint')} />
        <TextAreaField label={t('staff.bioAr')} value={f.bioAr} onChange={(e) => setF({ ...f, bioAr: e.target.value })} dir="rtl" />
        <TextAreaField label={t('staff.bioEn')} value={f.bioEn} onChange={(e) => setF({ ...f, bioEn: e.target.value })} dir="ltr" />
        <Check label={t('staff.public')} checked={f.isPublic} onChange={(v) => setF({ ...f, isPublic: v })} />
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-border p-2">
          {(['signature', 'stamp', 'photo'] as const).map((k) => (
            <TextField key={k} label={t(`staff.image.${k}`)} type="file" accept="image/png,image/jpeg" onChange={(e) => void uploadImage(k, e.target.files?.[0])} />
          ))}
          <p className="col-span-3 text-xs text-muted">{t('staff.imagesHint')}</p>
        </div>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <Button type="submit" disabled={a.busy || !f.specialtyIds.length}>
          {t('common.save')}
        </Button>
      </form>
    </Dialog>
  );
}
