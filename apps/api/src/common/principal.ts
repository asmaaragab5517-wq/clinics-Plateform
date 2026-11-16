import type { TenantContext } from '@hf/db';
import type { Privilege, Role } from '@hf/shared';

export interface StaffPrincipal {
  kind: 'staff';
  orgId: string;
  userId: string;
  name: string;
  roles: Role[];
  memberships: { role: Role; clinicId: string | null }[];
  clinicIds: string[];
  network: boolean;
  privileges: Set<Privilege>;
  authTime: number | null; // seconds since epoch of last interactive authentication
}

export interface PatientPrincipal {
  kind: 'patient';
  orgId: string;
  accountId: string;
  phone: string;
  patientIds: string[];
}

export interface PublicPrincipal {
  kind: 'public';
  orgId: string;
}

export type Principal = StaffPrincipal | PatientPrincipal | PublicPrincipal;

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function tenantOf(p: Principal): TenantContext {
  switch (p.kind) {
    case 'staff':
      return { orgId: p.orgId, mode: 'staff', userId: p.userId, network: p.network, clinicIds: p.clinicIds };
    case 'patient':
      return { orgId: p.orgId, mode: 'patient', patientIds: p.patientIds };
    case 'public':
      return { orgId: p.orgId, mode: 'public' };
  }
}

export function systemTenant(orgId: string): TenantContext {
  return { orgId, mode: 'system', network: true };
}
