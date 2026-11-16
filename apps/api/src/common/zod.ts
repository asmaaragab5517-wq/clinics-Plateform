import type { ZodTypeAny, z } from 'zod';
import { badRequest } from './errors';

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw badRequest('validation_failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(v: string, name = 'id'): string {
  if (!UUID.test(v)) throw badRequest('invalid_id', name);
  return v;
}
