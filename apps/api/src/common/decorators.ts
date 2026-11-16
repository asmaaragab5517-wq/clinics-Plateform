import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Privilege } from '@hf/shared';
import type { Principal, RequestMeta } from './principal';

export const ACCESS_KEY = 'hf:access';
export const PRIVILEGES_KEY = 'hf:privileges';
export type AccessKind = 'public' | 'patient' | 'staff' | 'webhook' | 'display';

/** Anonymous access within an organisation resolved from the X-Org header (public site). */
export const Public = () => SetMetadata(ACCESS_KEY, 'public');
/** Requires a patient access token. */
export const PatientAuth = () => SetMetadata(ACCESS_KEY, 'patient');
/** Requires a staff token holding all listed privileges. */
export const Staff = (...privileges: Privilege[]) => (target: object, key?: string | symbol, desc?: PropertyDescriptor) => {
  SetMetadata(ACCESS_KEY, 'staff')(target, key as string, desc as PropertyDescriptor);
  SetMetadata(PRIVILEGES_KEY, privileges)(target, key as string, desc as PropertyDescriptor);
};
/** Unauthenticated: provider webhooks and signed links. The handler MUST verify a signature or expose nothing sensitive. */
export const Webhook = () => SetMetadata(ACCESS_KEY, 'webhook');
/** Waiting-room display token (ticket numbers only). */
export const DisplayAuth = () => SetMetadata(ACCESS_KEY, 'display');

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => ctx.switchToHttp().getRequest().principal);
export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest();
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
});
