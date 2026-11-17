/** Sidebar navigation; each item is shown only when the user holds one of its privileges (the API enforces anyway). */
export interface NavItem {
  href: string;
  label: string; // i18n key
  anyOf?: string[];
  roles?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'nav.group.front',
    items: [
      { href: '/dashboard', label: 'nav.dashboard', anyOf: ['report:view'] },
      { href: '/reception', label: 'nav.reception', anyOf: ['appointment:create', 'queue:create'] },
      { href: '/calendar', label: 'nav.calendar', anyOf: ['appointment:view'] },
      { href: '/patients', label: 'nav.patients', anyOf: ['patient:view'] },
    ],
  },
  {
    label: 'nav.group.clinical',
    items: [
      { href: '/doctor', label: 'nav.doctor', roles: ['doctor'] },
      { href: '/doctor/templates', label: 'nav.encTemplates', anyOf: ['emr:edit'], roles: ['doctor'] },
      { href: '/nurse', label: 'nav.nurse', anyOf: ['emr:create'], roles: ['nurse', 'doctor', 'clinic_manager'] },
      { href: '/quality/report', label: 'nav.reportIncident', anyOf: ['quality:create'] },
    ],
  },
  {
    label: 'nav.group.finance',
    items: [
      { href: '/cashier', label: 'nav.cashier', anyOf: ['bill:view', 'shift:view'] },
      { href: '/cashier/refunds', label: 'nav.refunds', anyOf: ['refund:view', 'refund:approve'] },
      { href: '/finance/insurance', label: 'nav.insurance', anyOf: ['bill:approve', 'settings:edit'] },
      { href: '/finance/claims', label: 'nav.claims', anyOf: ['bill:approve', 'bill:export'] },
      { href: '/finance/eta', label: 'nav.eta', anyOf: ['bill:approve', 'bill:export'] },
    ],
  },
  {
    label: 'nav.group.quality',
    items: [
      { href: '/quality/complaints', label: 'nav.complaints', anyOf: ['quality:view'] },
      { href: '/quality/incidents', label: 'nav.incidents', anyOf: ['quality:view'] },
    ],
  },
  {
    label: 'nav.group.manage',
    items: [
      { href: '/manager/schedules', label: 'nav.schedules', anyOf: ['schedule:create', 'schedule:edit'] },
      { href: '/manager/catalogue', label: 'nav.catalogue', anyOf: ['clinic:edit'] },
      { href: '/manager/staff', label: 'nav.staff', anyOf: ['staff:view'] },
      { href: '/manager/approvals', label: 'nav.approvals', anyOf: ['bill:approve'] },
      { href: '/manager/reviews', label: 'nav.reviews', anyOf: ['review:view'] },
      { href: '/manager/tasks', label: 'nav.tasks' },
      { href: '/manager/templates', label: 'nav.templates', anyOf: ['message:view'] },
      { href: '/manager/commission', label: 'nav.commission', anyOf: ['commission:edit', 'commission:approve', 'commission:create'] },
    ],
  },
  {
    label: 'nav.group.admin',
    items: [
      { href: '/admin/settings', label: 'nav.settings', anyOf: ['settings:view'] },
      { href: '/admin/privileges', label: 'nav.privileges', anyOf: ['settings:view'] },
      { href: '/admin/custom-fields', label: 'nav.customFields', anyOf: ['settings:view'] },
      { href: '/admin/entities', label: 'nav.entities', anyOf: ['settings:view'] },
      { href: '/admin/clinics', label: 'nav.clinicsAdmin', anyOf: ['clinic:create', 'clinic:edit'] },
      { href: '/admin/cms', label: 'nav.cms', anyOf: ['org:edit'] },
      { href: '/admin/imports', label: 'nav.imports', anyOf: ['import:view'] },
      { href: '/admin/privacy', label: 'nav.privacy', anyOf: ['privacy:view'] },
      { href: '/admin/audit', label: 'nav.audit', anyOf: ['audit:view'] },
      { href: '/admin/ai', label: 'nav.ai', anyOf: ['settings:view'] },
      { href: '/admin/integrations', label: 'nav.integrations', anyOf: ['integration:view'] },
      { href: '/admin/api-keys', label: 'nav.apiKeys', anyOf: ['integration:view'] },
      { href: '/admin/subscription', label: 'nav.subscription', anyOf: ['settings:view'] },
      { href: '/admin/support', label: 'nav.supportAccess', anyOf: ['settings:view'] },
    ],
  },
];

export function allowed(item: NavItem, privileges: Set<string>, roles: string[]): boolean {
  const byPriv = !item.anyOf || item.anyOf.some((p) => privileges.has(p));
  const byRole = !item.roles || item.roles.some((r) => roles.includes(r));
  if (item.anyOf && item.roles) return byPriv && byRole;
  return byPriv && byRole;
}
