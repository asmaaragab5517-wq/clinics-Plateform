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
  /** Set when a platform admin acts through an owner-approved, read-only support window (BR-20). */
  support?: { adminId: string; accessId: string; endsAt: string } | null;
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

export interface PlatformPrincipal {
  kind: 'platform';
  orgId: string; // nil UUID: platform principals never run under a tenant context
  adminId: string;
  email: string;
}

export interface ApiKeyPrincipal {
  kind: 'apikey';
  orgId: string;
  keyId: string;
  scopes: string[];
}

export type Principal = StaffPrincipal | PatientPrincipal | PublicPrincipal | PlatformPrincipal | ApiKeyPrincipal;

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
    case 'apikey':
      return { orgId: p.orgId, mode: 'staff', network: true };
    case 'platform':
      throw new Error('platform principals have no tenant context');
  }
}

export function systemTenant(orgId: string): TenantContext {
  return { orgId, mode: 'system', network: true };
}
