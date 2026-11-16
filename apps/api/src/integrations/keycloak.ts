import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CONFIG, type Config } from '../config';

/** Keycloak admin operations for staff provisioning (FR-STF-1, FR-STF-4). */
export interface IdentityAdmin {
  createUser(u: { email?: string; phone?: string; firstName: string; orgId: string }): Promise<string>;
  disableUser(sub: string): Promise<void>;
}
export const IDENTITY_ADMIN = Symbol('IDENTITY_ADMIN');

@Injectable()
export class KeycloakAdmin implements IdentityAdmin {
  private readonly log = new Logger('Keycloak');
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  private get base() {
    const issuer = this.cfg.KEYCLOAK_ISSUER!; // https://kc/realms/healthflow
    return issuer.replace('/realms/', '/admin/realms/');
  }

  private async token(): Promise<string> {
    const res = await fetch(`${this.cfg.KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? '', client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET ?? '' }),
    });
    if (!res.ok) throw new Error(`keycloak_token_${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  async createUser(u: Parameters<IdentityAdmin['createUser']>[0]): Promise<string> {
    const t = await this.token();
    const res = await fetch(`${this.base}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify({
        username: u.email ?? u.phone, email: u.email, firstName: u.firstName, enabled: true,
        attributes: { org: [u.orgId], phone: u.phone ? [u.phone] : [] },
        requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP', 'VERIFY_EMAIL'],
      }),
    });
    if (res.status !== 201) throw new Error(`keycloak_create_${res.status}`);
    const sub = res.headers.get('location')!.split('/').pop()!;
    await fetch(`${this.base}/users/${sub}/execute-actions-email`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify(['UPDATE_PASSWORD', 'CONFIGURE_TOTP']) });
    return sub;
  }

  async disableUser(sub: string) {
    const t = await this.token();
    await fetch(`${this.base}/users/${sub}`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ enabled: false }) });
    await fetch(`${this.base}/users/${sub}/logout`, { method: 'POST', headers: { authorization: `Bearer ${t}` } });
  }
}

@Injectable()
export class FakeIdentityAdmin implements IdentityAdmin {
  readonly disabled = new Set<string>();
  async createUser() {
    return `dev-${randomUUID()}`;
  }
  async disableUser(sub: string) {
    this.disabled.add(sub);
  }
}
