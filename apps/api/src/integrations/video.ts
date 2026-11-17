import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { CONFIG, type Config } from '../config';

export interface MeetingRequest {
  appointmentId: string;
  topic: string;
  start: Date;
  durationMinutes: number;
  /** Google Meet needs the doctor's OAuth access token (FR-TEL-2/3). */
  googleAccessToken?: string | null;
}
export interface Meeting {
  meetingId: string;
  hostUrl: string;
  joinUrl: string;
  passcode: string | null;
}
/** Telemedicine provider adapter (decision D8; default Zoom Server-to-Server). */
export interface VideoProvider {
  readonly name: 'zoom' | 'google_meet' | 'fake';
  createMeeting(r: MeetingRequest): Promise<Meeting>;
  deleteMeeting(meetingId: string, googleAccessToken?: string | null): Promise<void>;
}
export const VIDEO = Symbol('VIDEO');

/** Zoom Server-to-Server OAuth: account credentials grant, meetings with waiting room and no join-before-host. */
@Injectable()
export class ZoomProvider implements VideoProvider {
  readonly name = 'zoom' as const;
  private token: { value: string; exp: number } | null = null;
  private readonly log = new Logger('Zoom');
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  private async accessToken() {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.ZOOM_CLIENT_ID}:${this.cfg.ZOOM_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(this.cfg.ZOOM_ACCOUNT_ID ?? '')}`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`zoom_token_${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async createMeeting(r: MeetingRequest): Promise<Meeting> {
    const res = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.accessToken()}` },
      body: JSON.stringify({
        topic: r.topic,
        type: 2,
        start_time: r.start.toISOString(),
        duration: r.durationMinutes,
        timezone: 'Africa/Cairo',
        password: randomBytes(4).toString('hex'),
        settings: { waiting_room: true, join_before_host: false, host_video: true, participant_video: true, auto_recording: 'none', meeting_authentication: false },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      this.log.warn(`create meeting failed ${res.status}`);
      throw new Error(`zoom_create_${res.status}`);
    }
    const j = (await res.json()) as { id: number; start_url: string; join_url: string; password: string };
    return { meetingId: String(j.id), hostUrl: j.start_url, joinUrl: j.join_url, passcode: j.password };
  }

  async deleteMeeting(id: string) {
    await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${await this.accessToken()}` } });
  }
}

/** Google Meet via a Calendar event with conferenceData on the doctor's calendar (requires doctor OAuth). */
@Injectable()
export class GoogleMeetProvider implements VideoProvider {
  readonly name = 'google_meet' as const;
  async createMeeting(r: MeetingRequest): Promise<Meeting> {
    if (!r.googleAccessToken) throw new Error('google_not_connected');
    const end = new Date(r.start.getTime() + r.durationMinutes * 60000);
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${r.googleAccessToken}` },
      body: JSON.stringify({
        summary: r.topic,
        start: { dateTime: r.start.toISOString(), timeZone: 'Africa/Cairo' },
        end: { dateTime: end.toISOString(), timeZone: 'Africa/Cairo' },
        visibility: 'private',
        conferenceData: { createRequest: { requestId: r.appointmentId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      }),
    });
    if (!res.ok) throw new Error(`meet_create_${res.status}`);
    const j = (await res.json()) as { id: string; hangoutLink: string };
    return { meetingId: j.id, hostUrl: j.hangoutLink, joinUrl: j.hangoutLink, passcode: null };
  }
  async deleteMeeting(id: string, token?: string | null) {
    if (token) await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  }
}

@Injectable()
export class FakeVideoProvider implements VideoProvider {
  readonly name = 'fake' as const;
  readonly meetings = new Map<string, Meeting>();
  async createMeeting(): Promise<Meeting> {
    const id = randomUUID();
    const m = { meetingId: id, hostUrl: `https://video.example.test/host/${id}`, joinUrl: `https://video.example.test/join/${id}`, passcode: '123456' };
    this.meetings.set(id, m);
    return m;
  }
  async deleteMeeting(id: string) {
    this.meetings.delete(id);
  }
}
