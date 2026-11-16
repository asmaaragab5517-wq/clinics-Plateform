import { ArgumentsHost, BadRequestException, Catch, ConflictException, ExceptionFilter, ForbiddenException, HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { NotFoundError } from '@hf/db';
import { ZodError } from 'zod';

export class DomainError extends HttpException {
  constructor(code: string, status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY, details?: unknown) {
    super({ error: code, details }, status);
  }
}

export const notFound = (what = 'resource') => new NotFoundException({ error: 'not_found', details: what });
export const forbidden = (code = 'forbidden') => new ForbiddenException({ error: code });
export const conflict = (code: string) => new ConflictException({ error: code });
export const badRequest = (code: string, details?: unknown) => new BadRequestException({ error: code, details });

/** Maps database and validation errors to safe HTTP responses; never leaks SQL or PHI (SEC-11). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('HTTP');
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (e instanceof HttpException) return res.status(e.getStatus()).json(normalise(e.getResponse()));
    if (e instanceof ZodError) return res.status(400).json({ error: 'validation_failed', details: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (e instanceof NotFoundError) return res.status(404).json({ error: 'not_found' });
    const pg = e as { code?: string; constraint?: string; message?: string };
    if (pg?.code === '23P01') return res.status(409).json({ error: 'slot_unavailable' });
    if (pg?.code === '23505') return res.status(409).json({ error: 'duplicate', details: pg.constraint });
    if (pg?.code === '23503') return res.status(422).json({ error: 'invalid_reference' });
    if (pg?.code === '42501' || /row-level security/.test(pg?.message ?? '')) return res.status(403).json({ error: 'forbidden' });
    if (pg?.code === '22P02') return res.status(400).json({ error: 'invalid_input' });
    this.log.error(`Unhandled error: ${pg?.code ?? ''} ${(e as Error)?.stack ?? e}`);
    return res.status(500).json({ error: 'internal_error' });
  }
}

function normalise(body: unknown) {
  if (typeof body === 'string') return { error: body };
  const b = body as Record<string, unknown>;
  if (b.error && typeof b.error === 'string' && !b.statusCode) return b;
  return { error: String(b.message ?? b.error ?? 'error').toLowerCase().replace(/\s+/g, '_') };
}
