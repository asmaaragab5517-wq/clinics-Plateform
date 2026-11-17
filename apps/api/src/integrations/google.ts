import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config';

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
  scope?: string;
}
export interface CalendarEvent {
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
}

/** Google OAuth (authorization code) and Calendar events API. */
export interface GoogleClient {
  authUrl(state: string, scopes: string[]): string;
  exchange(code: string): Promise<GoogleTokens & { email?: string }>;
  refresh(t: GoogleTokens): Promise<GoogleTokens>;
  upsertEvent(t: GoogleTokens, eventId: string | null, e: CalendarEvent): Promise<string>;
  deleteEvent(t: GoogleTokens, eventId: string): Promise<void>;
}
export const GOOGLE = Symbol('GOOGLE');
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

@Injectable()
export class HttpGoogleClient implements GoogleClient {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}
  private get redirect() {
    return `${this.cfg.API_PUBLIC_URL}/v1/integrations/google/callback`;
  }
  authUrl(state: string, scopes: string[]) {
    const q = new URLSearchParams({ client_id: this.cfg.GOOGLE_CLIENT_ID ?? '', redirect_uri: this.redirect, response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', scope: ['openid', 'email', ...scopes].join(' '), state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  private async token(params: Record<string, string>) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg.GOOGLE_CLIENT_ID ?? '', client_secret: this.cfg.GOOGLE_CLIENT_SECRET ?? '', ...params }),
    });
    if (!res.ok) throw new Error(`google_token_${res.status}`);
    return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string };
  }
  async exchange(code: string) {
    const j = await this.token({ grant_type: 'authorization_code', code, redirect_uri: this.redirect });
    let email: string | undefined;
    if (j.id_token) email = JSON.parse(Buffer.from(j.id_token.split('.')[1] ?? '', 'base64url').toString()).email;
    return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000, scope: j.scope, email };
  }
  async refresh(t: GoogleTokens) {
    if (t.expires_at > Date.now() + 60_000) return t;
    const j = await this.token({ grant_type: 'refresh_token', refresh_token: t.refresh_token ?? '' });
    return { ...t, access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 };
  }
  async upsertEvent(t: GoogleTokens, eventId: string | null, e: CalendarEvent) {
    const body = JSON.stringify({
      summary: e.summary, description: e.description, location: e.location, visibility: 'private',
      start: { dateTime: e.start.toISOString(), timeZone: 'Africa/Cairo' }, end: { dateTime: e.end.toISOString(), timeZone: 'Africa/Cairo' },
      extendedProperties: { private: { source: 'healthflow' } },
    });
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;
    const res = await fetch(url, { method: eventId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.access_token}` }, body });
    if (!res.ok) throw new Error(`gcal_${res.status}`);
    return ((await res.json()) as { id: string }).id;
  }
  async deleteEvent(t: GoogleTokens, eventId: string) {
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${t.access_token}` } });
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`gcal_delete_${res.status}`);
  }
}

@Injectable()
export class FakeGoogleClient implements GoogleClient {
  readonly events = new Map<string, CalendarEvent>();
  authUrl(state: string) {
    return `https://accounts.example.test/auth?state=${encodeURIComponent(state)}`;
  }
  async exchange(code: string) {
    return { access_token: `at-${code}`, refresh_token: `rt-${code}`, expires_at: Date.now() + 3600_000, email: 'doctor@example.test' };
  }
  async refresh(t: GoogleTokens) {
    return t;
  }
  async upsertEvent(_t: GoogleTokens, eventId: string | null, e: CalendarEvent) {
    const id = eventId ?? `ev-${this.events.size + 1}-${Date.now()}`;
    this.events.set(id, e);
    return id;
  }
  async deleteEvent(_t: GoogleTokens, id: string) {
    this.events.delete(id);
  }
}
