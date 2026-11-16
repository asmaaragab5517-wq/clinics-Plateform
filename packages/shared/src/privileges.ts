import { PRIVILEGE_ACTIONS, PRIVILEGE_MODULES, type Privilege, type PrivilegeAction, type PrivilegeModule, type Role } from './enums';

const all = (m: PrivilegeModule, actions: readonly PrivilegeAction[] = PRIVILEGE_ACTIONS): Privilege[] =>
  actions.map((a) => `${m}:${a}` as Privilege);

const EVERYTHING: Privilege[] = PRIVILEGE_MODULES.flatMap((m) => all(m));

/** Default privilege matrix (SRS §4). Organisation owners may edit it per organisation (IAM-1). */
export const DEFAULT_PRIVILEGES: Record<Role, Privilege[]> = {
  owner: EVERYTHING,
  network_director: [
    ...PRIVILEGE_MODULES.filter((m) => m !== 'settings').flatMap((m) => all(m, ['view', 'export'])),
    ...all('staff'),
    ...all('schedule'),
    ...all('clinic', ['view', 'create', 'edit']),
    ...all('report'),
    'audit:view',
    'emr:view',
    'refund:approve',
    'bill:approve',
    'shift:approve',
  ],
  clinic_manager: [
    ...all('schedule'),
    ...all('staff', ['view', 'edit']),
    ...all('clinic', ['view', 'edit']),
    ...all('appointment'),
    ...all('queue'),
    ...all('patient', ['view', 'create', 'edit']),
    ...all('bill', ['view', 'create', 'edit', 'approve']),
    ...all('payment', ['view', 'create']),
    'refund:view',
    'refund:approve',
    ...all('shift', ['view', 'approve']),
    ...all('report', ['view', 'export']),
    ...all('review', ['view', 'approve', 'edit']),
    'message:view',
  ],
  doctor: [
    'schedule:view',
    'appointment:view',
    'appointment:create',
    'appointment:edit',
    ...all('queue', ['view', 'edit']),
    'patient:view',
    ...all('emr', ['view', 'create', 'edit', 'approve']),
    ...all('prescription', ['view', 'create', 'edit', 'approve']),
    'bill:view',
    'bill:create',
    'commission:view',
    'review:view',
  ],
  nurse: [
    'schedule:view',
    'appointment:view',
    ...all('queue', ['view', 'create', 'edit']),
    'patient:view',
    'emr:view',
    'emr:create',
  ],
  receptionist: [
    'schedule:view',
    ...all('appointment', ['view', 'create', 'edit']),
    ...all('queue', ['view', 'create', 'edit']),
    ...all('patient', ['view', 'create', 'edit']),
    ...all('bill', ['view', 'create', 'edit']),
    ...all('payment', ['view', 'create']),
    'refund:create',
    ...all('shift', ['view', 'create', 'edit']),
  ],
  accountant: [
    ...all('bill', ['view', 'approve', 'export']),
    ...all('payment', ['view', 'export']),
    ...all('refund', ['view', 'approve', 'export']),
    ...all('shift', ['view', 'approve', 'export']),
    ...all('commission'),
    ...all('report', ['view', 'export']),
    'patient:view',
  ],
  patient: [],
};

export function hasPrivilege(granted: Iterable<Privilege>, needed: Privilege): boolean {
  for (const p of granted) if (p === needed) return true;
  return false;
}

export function privilegesForRoles(roles: Role[], overrides?: Partial<Record<Role, Privilege[]>>): Set<Privilege> {
  const out = new Set<Privilege>();
  for (const r of roles) for (const p of overrides?.[r] ?? DEFAULT_PRIVILEGES[r]) out.add(p);
  return out;
}
