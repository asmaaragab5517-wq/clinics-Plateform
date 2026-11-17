import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NETWORK_ROLES, hasPrivilege, privilegesForRoles, type Privilege, type Role } from '@hf/shared';
import type { Request } from 'express';
import { CONFIG, type Config } from '../config';
import { ACCESS_KEY, PRIVILEGES_KEY, type AccessKind } from './decorators';
import { forbidden } from './errors';
import type { Principal } from './principal';
import { Tenancy } from './services';
import { TokenService } from './tokens';
import { RateLimiter } from './rate-limit';
import { UnauthorizedException } from '@nestjs/common';

const unauthorized = () => new UnauthorizedException({ error: 'unauthorized' });

/**
 * Global guard: deny by default (SEC-1). Every route must declare its access kind; routes without one are refused.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private orgCache = new Map<string, { id: string; at: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly tenancy: Tenancy,
    @Inject(CONFIG) private readonly cfg: Config,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride<AccessKind | undefined>(ACCESS_KEY, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    if (!access) throw forbidden('route_has_no_access_policy');
    if (access === 'webhook') return true;
    const bearer = this.bearer(req);

    if (access === 'display') {
      const d = bearer ? await this.tokens.verifyDisplay(bearer) : null;
      if (!d) throw unauthorized();
      req.principal = { kind: 'public', orgId: d.orgId };
      (req as unknown as { displayClinicId: string }).displayClinicId = d.clinicId;
      return true;
    }

    if (access === 'public') {
      // SEC-5: per-IP limit on anonymous traffic (search, booking wizard, OTP endpoints add their own stricter limits).
      await this.limiter.hit(`pub:${req.ip ?? 'unknown'}`, this.cfg.RATE_LIMIT_PUBLIC_PER_MIN, 60);
      // A signed-in patient may call public routes; otherwise resolve organisation from header/default.
      const patient = bearer ? await this.patient(bearer) : null;
      req.principal = patient ?? { kind: 'public', orgId: await this.resolveOrg(req) };
      return true;
    }

    if (access === 'patient') {
      const p = bearer ? await this.patient(bearer) : null;
      if (!p) throw unauthorized();
      await this.limiter.hit(`pat:${(p as { accountId: string }).accountId}`, this.cfg.RATE_LIMIT_PATIENT_PER_MIN, 60);
      req.principal = p;
      return true;
    }

    // staff
    if (!bearer) throw unauthorized();
    const claims = await this.tokens.verifyStaff(bearer);
    if (!claims?.sub) throw unauthorized();
    const ident = (await this.tenancy.db.raw<{
      user_id: string; organisation_id: string; status: string; name_ar: string; memberships: { role: Role; clinicId: string | null }[]; privilege_overrides: Partial<Record<Role, Privilege[]>>;
    }>('select * from staff_identity($1)', [claims.sub]))[0];
    if (!ident || ident.status !== 'active') throw unauthorized();
    const roles = [...new Set(ident.memberships.map((m) => m.role))];
    const privileges = privilegesForRoles(roles, ident.privilege_overrides ?? {});
    const needed = this.reflector.getAllAndOverride<Privilege[] | undefined>(PRIVILEGES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    for (const p of needed) if (!hasPrivilege(privileges, p)) throw forbidden('missing_privilege');
    req.principal = {
      kind: 'staff',
      orgId: ident.organisation_id,
      userId: ident.user_id,
      name: ident.name_ar,
      roles,
      memberships: ident.memberships,
      clinicIds: [...new Set(ident.memberships.map((m) => m.clinicId).filter((c): c is string => !!c))],
      network: roles.some((r) => NETWORK_ROLES.includes(r)),
      privileges,
      authTime: typeof claims.auth_time === 'number' ? claims.auth_time : null,
    };
    return true;
  }

  private bearer(req: Request): string | null {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : null;
  }

  private async patient(token: string): Promise<Principal | null> {
    const t = await this.tokens.verifyPatient(token);
    if (!t) return null;
    const rows = await this.tenancy.system(t.orgId, (tx) =>
      tx.query<{ patient_id: string; status: string }>(
        `select l.patient_id, a.status from patient_accounts a left join patient_links l on l.account_id = a.id and l.confirmed_at is not null
         left join patients p on p.id = l.patient_id and p.merged_into_id is null and p.deleted_at is null
         where a.id = $1`,
        [t.accountId],
      ),
    );
    if (!rows.length || rows[0]!.status !== 'active') return null;
    return { kind: 'patient', orgId: t.orgId, accountId: t.accountId, phone: t.phone, patientIds: rows.map((r) => r.patient_id).filter(Boolean) };
  }

  private async resolveOrg(req: Request): Promise<string> {
    const key = String(req.headers['x-org'] ?? this.cfg.DEFAULT_ORG_SLUG).slice(0, 100);
    const cached = this.orgCache.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.id;
    const row = (await this.tenancy.db.raw<{ id: string }>('select id from resolve_org($1)', [key]))[0];
    if (!row) throw forbidden('unknown_organisation');
    this.orgCache.set(key, { id: row.id, at: Date.now() });
    return row.id;
  }
}

/** Guards for principal kinds inside handlers. */
export function asStaff(p: Principal) {
  if (p.kind !== 'staff') throw forbidden();
  return p;
}
export function asPatient(p: Principal) {
  if (p.kind !== 'patient') throw forbidden();
  return p;
}
