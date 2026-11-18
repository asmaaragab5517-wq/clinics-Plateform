import { createHmac } from 'node:crypto';

/**
 * The browser's address as our own edge recorded it (Vercel sets x-real-ip; otherwise the last x-forwarded-for hop),
 * signed with CLIENT_IP_SECRET for the API. Returns null when no secret is configured or no address is known.
 */
export function signClientIp(req: { headers: Headers }): string | null {
  const secret = process.env.CLIENT_IP_SECRET;
  if (!secret) return null;
  const ip = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',').pop()?.trim();
  if (!ip || !/^[\d.:a-fA-F]{3,45}$/.test(ip)) return null;
  const ts = Math.floor(Date.now() / 1000);
  return `${ip}|${ts}|${createHmac('sha256', secret).update(`${ip}|${ts}`).digest('hex')}`;
}
