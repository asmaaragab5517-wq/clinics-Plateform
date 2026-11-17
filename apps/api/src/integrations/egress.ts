import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** SSRF guard for admin-configured outbound URLs: https only, public addresses only, no credentials or odd ports. */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('invalid_url');
  }
  if (u.protocol !== 'https:') throw new Error('https_required');
  if (u.username || u.password) throw new Error('credentials_in_url');
  if (u.port && u.port !== '443') throw new Error('port_not_allowed');
  const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('unresolvable_host');
  for (const { address } of addrs) if (isPrivate(address)) throw new Error('private_address');
  return u;
}

export function isPrivate(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && isPrivate(v.slice(7));
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
