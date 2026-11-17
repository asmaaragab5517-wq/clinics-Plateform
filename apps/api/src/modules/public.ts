import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { STORAGE, type Storage } from '../integrations/storage';
import { z } from 'zod';
import { addDays, localDate, zDate, zonedToUtc } from '@hf/shared';
import { Auth, Public } from '../common/decorators';
import { notFound } from '../common/errors';
import type { Principal } from '../common/principal';
import { Tenancy } from '../common/services';
import { parse, uuid } from '../common/zod';
import { AvailabilityService } from './availability.service';
import { AppointmentsService } from './appointments.service';

/** Public site API (BR-12, FR-WEB-*): catalogue data only, never PHI. Cacheable. */
@Controller('v1/public')
export class PublicController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly availability: AvailabilityService,
    private readonly appointments: AppointmentsService,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  @Get('org')
  @Public()
  async org(@Auth() p: Principal) {
    return this.tenancy.run(p, async (tx) => {
      const o = await tx.one<Record<string, unknown>>(`select id, slug, name_ar, name_en, branding, settings->>'digitStyle' as digit_style from organisations where id = app_org()`);
      // Effective policy (defaults merged with the organisation's overrides).
      return { ...o, booking: await this.appointments.policy(tx) };
    });
  }

  @Get('clinics')
  @Public()
  clinics(@Auth() p: Principal, @Query('governorate') governorate?: string) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select c.id, c.slug, c.name_ar, c.name_en, c.governorate, c.city, c.address_lines, c.lat, c.lng, c.phones, c.working_hours, c.colours, c.logo_key,
                coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'name_ar', s.name_ar, 'name_en', s.name_en)) from clinic_specialties cs join specialties s on s.id = cs.specialty_id where cs.clinic_id = c.id), '[]') as specialties
         from clinics c where ($1::text is null or c.governorate = $1) order by c.name_ar`,
        [governorate ?? null],
      ),
    );
  }

  @Get('clinics/:slug')
  @Public()
  async clinic(@Auth() p: Principal, @Param('slug') slug: string) {
    const r = await this.tenancy.run(p, async (tx) => {
      const c = await tx.maybeOne<{ id: string }>(`select id, slug, name_ar, name_en, governorate, city, address_lines, lat, lng, phones, email, working_hours, colours,
        coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'name_ar', s.name_ar, 'name_en', s.name_en)) from clinic_specialties cs join specialties s on s.id = cs.specialty_id where cs.clinic_id = clinics.id), '[]') as specialties from clinics where slug = $1`, [slug.slice(0, 80)]);
      if (!c) return null;
      const doctors = await this.doctorsQuery(tx, { clinicId: c.id });
      const rating = await tx.one(`select round(avg(rating)::numeric, 2) as avg, count(*)::int as count from reviews where clinic_id = $1 and status = 'approved'`, [c.id]);
      return { ...c, doctors, rating };
    });
    if (!r) throw notFound('clinic');
    return r;
  }

  @Get('specialties')
  @Public()
  specialties(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select s.id, s.slug, s.name_ar, s.name_en, count(distinct ds.doctor_id)::int as doctors from specialties s join doctor_specialties ds on ds.specialty_id = s.id join doctor_profiles d on d.user_id = ds.doctor_id and d.is_public group by s.id order by s.name_ar`),
    );
  }

  /** FR-WEB-2 filters: specialty, governorate, clinic, gender, fee range, rating. */
  @Get('doctors')
  @Public()
  doctors(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const f = parse(
      z.object({ specialty: z.string().optional(), governorate: z.string().optional(), city: z.string().max(80).optional(), clinicId: z.string().uuid().optional(), gender: z.enum(['male', 'female']).optional(), minFee: z.coerce.number().int().optional(), maxFee: z.coerce.number().int().optional(), minRating: z.coerce.number().optional(), q: z.string().max(60).optional(), availableBy: zDate.optional() }),
      q,
    );
    return this.tenancy.run(p, async (tx) => {
      const rows = await this.doctorsQuery(tx, f);
      // FR-WEB-2 "next available": one availability pass for all listed doctors (14 days).
      const policy = await this.appointments.policy(tx);
      const today = localDate(new Date());
      // Cached by the worker for every doctor (30 days); live computation only for doctors not cached recently.
      const cached = await tx.query<{ doctor_id: string; next: Date | null; fresh: boolean }>(
        `select doctor_id, min(next_start) filter (where next_start > now()) as next, bool_and(computed_at > now() - interval '15 minutes') as fresh
         from doctor_next_slot where doctor_id = any($1::uuid[]) and ($2::uuid is null or clinic_id = $2) group by doctor_id`,
        [rows.map((r) => r.id), f.clinicId ?? null],
      );
      const next = new Map<string, string>();
      for (const c of cached) if (c.fresh && c.next) next.set(c.doctor_id, new Date(c.next).toISOString());
      const missing = rows.map((r) => r.id as string).filter((id) => !cached.some((c) => c.doctor_id === id && c.fresh));
      if (missing.length) {
        const slots = await this.availability.slots(tx, { doctorIds: missing.slice(0, 60), clinicId: f.clinicId, from: today, days: 14, channel: 'online', leadMinutes: policy.leadMinutes });
        for (const s of slots) if (s.available > 0 && !next.has(s.doctorId)) next.set(s.doctorId, s.start);
      }
      const out = rows.map(({ photo_key, ...r }) => ({ ...r, next_available: next.get(r.id as string) ?? null, photo_url: photo_key ? `/v1/public/doctors/${r.slug}/photo` : null }));
      if (!f.availableBy) return out;
      const limit = zonedToUtc(addDays(f.availableBy, 1), '00:00').toISOString();
      return out.filter((r) => r.next_available && r.next_available < limit).sort((a, b) => a.next_available!.localeCompare(b.next_available!));
    });
  }

  /** Public doctor photo (not PHI); streamed from private storage with long caching. */
  @Get('doctors/:slug/photo')
  @Public()
  async photo(@Auth() p: Principal, @Param('slug') slug: string, @Res() res: Response) {
    const d = await this.tenancy.run(p, (tx) => tx.maybeOne<{ photo_key: string | null }>('select photo_key from doctor_profiles where slug = $1 and is_public', [slug.slice(0, 80)]));
    const obj = d?.photo_key ? await this.storage.get(d.photo_key) : null;
    if (!obj) throw notFound('photo');
    res.setHeader('content-type', obj.contentType).setHeader('cache-control', 'public, max-age=86400').send(obj.body);
  }

  /** FR-WEB-3 abandoned-booking tracking: the wizard reports its furthest step per anonymous session. */
  @Post('booking-funnel')
  @Public()
  @HttpCode(204)
  async funnel(@Auth() p: Principal, @Body() body: unknown, @Req() req: Request) {
    const steps = ['doctor', 'service', 'slot', 'patient', 'payment', 'done'] as const;
    const b = parse(z.object({ sessionId: z.string().uuid(), step: z.enum(steps), doctorId: z.string().uuid().optional(), clinicId: z.string().uuid().optional(), appointmentId: z.string().uuid().optional() }), body);
    const channel = req.headers['x-client'] === 'app' ? 'app' : 'site';
    await this.tenancy.system(p.orgId, (tx) =>
      tx.query(
        `insert into booking_funnel (organisation_id, session_id, channel, step, step_index, doctor_id, clinic_id, appointment_id) values (app_org(), $1,$2,$3,$4,$5,$6,$7)
         on conflict (organisation_id, session_id) do update set
           step = case when excluded.step_index > booking_funnel.step_index then excluded.step else booking_funnel.step end,
           step_index = greatest(excluded.step_index, booking_funnel.step_index),
           doctor_id = coalesce(excluded.doctor_id, booking_funnel.doctor_id), clinic_id = coalesce(excluded.clinic_id, booking_funnel.clinic_id),
           appointment_id = coalesce(excluded.appointment_id, booking_funnel.appointment_id), updated_at = now()`,
        [b.sessionId, channel, b.step, steps.indexOf(b.step), b.doctorId ?? null, b.clinicId ?? null, b.appointmentId ?? null],
      ),
    );
  }

  private doctorsQuery(tx: import('@hf/db').Tx, f: { specialty?: string; governorate?: string; city?: string; clinicId?: string; gender?: string; minFee?: number; maxFee?: number; minRating?: number; q?: string }) {
    return tx.query(
      `select * from (
         select u.id, d.slug, u.name_ar, u.name_en, d.title, d.gender, d.languages, d.bio_ar, d.bio_en, d.photo_key, d.rating_avg, d.rating_count,
           coalesce((select jsonb_agg(jsonb_build_object('slug', s.slug, 'name_ar', s.name_ar, 'name_en', s.name_en)) from doctor_specialties ds join specialties s on s.id = ds.specialty_id where ds.doctor_id = u.id), '[]') as specialties,
           coalesce((select jsonb_agg(distinct jsonb_build_object('id', c.id, 'slug', c.slug, 'name_ar', c.name_ar, 'name_en', c.name_en, 'governorate', c.governorate, 'city', c.city)) from doctor_sessions ses join clinics c on c.id = ses.clinic_id where ses.doctor_id = u.id and ses.is_active), '[]') as clinics,
           (select min(pl.price) from price_list_items pl join services sv on sv.id = pl.service_id where sv.type = 'consultation' and (pl.doctor_id = u.id or pl.doctor_id is null)
              and pl.service_id in (select service_id from doctor_services where doctor_id = u.id) and pl.effective_from <= current_date and (pl.effective_to is null or pl.effective_to >= current_date)) as fee
         from users u join doctor_profiles d on d.user_id = u.id where d.is_public
       ) x
       where ($1::text is null or x.specialties @> jsonb_build_array(jsonb_build_object('slug', $1::text)) or exists (select 1 from jsonb_array_elements(x.specialties) e where e->>'slug' = $1))
         and ($2::text is null or exists (select 1 from jsonb_array_elements(x.clinics) e where e->>'governorate' = $2))
         and ($9::text is null or exists (select 1 from jsonb_array_elements(x.clinics) e where e->>'city' = $9))
         and ($3::text is null or exists (select 1 from jsonb_array_elements(x.clinics) e where e->>'id' = $3))
         and ($4::text is null or x.gender = $4)
         and ($5::int is null or x.fee >= $5) and ($6::int is null or x.fee <= $6)
         and ($7::numeric is null or coalesce(x.rating_avg, 0) >= $7)
         and ($8::text is null or x.name_ar ilike '%' || $8 || '%' or x.name_en ilike '%' || $8 || '%')
       order by x.rating_avg desc nulls last, x.name_ar`,
      [f.specialty ?? null, f.governorate ?? null, f.clinicId ?? null, f.gender ?? null, f.minFee ?? null, f.maxFee ?? null, f.minRating ?? null, f.q ?? null, f.city ?? null],
    );
  }

  @Get('doctors/:slug')
  @Public()
  async doctor(@Auth() p: Principal, @Param('slug') slug: string) {
    const r = await this.tenancy.run(p, async (tx) => {
      const [d] = (await this.doctorsQuery(tx, {})).filter((x) => x.slug === slug);
      if (!d) return null;
      const profile = await tx.one(`select syndicate_number, qualifications from doctor_profiles where user_id = $1`, [d.id]);
      const services = await tx.query(
        `select s.id, s.code, s.name_ar, s.name_en, s.duration_minutes, s.type,
           (select jsonb_agg(jsonb_build_object('clinicId', pl.clinic_id, 'price', pl.price)) from price_list_items pl where pl.service_id = s.id and (pl.doctor_id = $1 or pl.doctor_id is null) and pl.effective_from <= current_date and (pl.effective_to is null or pl.effective_to >= current_date)) as prices
         from doctor_services ds join services s on s.id = ds.service_id where ds.doctor_id = $1 and s.is_active order by s.type, s.code`,
        [d.id],
      );
      const reviews = await tx.query(`select rating, comment, display_name, created_at from reviews where doctor_id = $1 and status = 'approved' order by created_at desc limit 20`, [d.id]);
      const next = (await this.availability.slots(tx, { doctorIds: [d.id as string], from: localDate(new Date()), days: 14, channel: 'online', leadMinutes: (await this.appointments.policy(tx)).leadMinutes })).find((s) => s.available > 0);
      const { photo_key, ...rest } = d;
      return { ...rest, ...profile, services, reviews, nextAvailable: next?.start ?? null, next_available: next?.start ?? null, photo_url: photo_key ? `/v1/public/doctors/${d.slug}/photo` : null };
    });
    if (!r) throw notFound('doctor');
    return r;
  }

  @Get('services')
  @Public()
  services(@Auth() p: Principal, @Query('clinicId') clinicId?: string) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select s.id, s.code, s.name_ar, s.name_en, s.type, s.duration_minutes, s.vat, pl.clinic_id, pl.price from services s join price_list_items pl on pl.service_id = s.id and pl.doctor_id is null
         where s.is_active and pl.effective_from <= current_date and (pl.effective_to is null or pl.effective_to >= current_date) and ($1::uuid is null or pl.clinic_id = $1)
         order by s.type, s.name_ar`,
        [clinicId ? uuid(clinicId) : null],
      ),
    );
  }

  @Get('packages')
  @Public()
  packages(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select id, name_ar, name_en, sessions, validity_days, price from packages where is_active order by price'));
  }

  /** Slots for the booking wizard: next 14 days by default (FR-WEB-3). */
  @Get('slots')
  @Public()
  slots(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const b = parse(z.object({ doctorId: z.string().uuid(), clinicId: z.string().uuid().optional(), serviceId: z.string().uuid().optional(), from: zDate.optional(), days: z.coerce.number().int().min(1).max(14).default(14) }), q);
    return this.tenancy.run(p, async (tx) => {
      const policy = await this.appointments.policy(tx);
      const slots = await this.availability.slots(tx, { doctorIds: [b.doctorId], clinicId: b.clinicId, serviceId: b.serviceId, from: b.from ?? localDate(new Date()), days: b.days, channel: 'online', leadMinutes: policy.leadMinutes });
      return slots.filter((s) => s.available > 0).map((s) => ({ start: s.start, end: s.end, date: s.date, localStart: s.localStart, clinicId: s.clinicId }));
    });
  }

  @Get('articles')
  @Public()
  articles(@Auth() p: Principal, @Query('kind') kind?: string) {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select id, kind, slug, title_ar, title_en, left(body_ar, 300) as excerpt_ar, left(body_en, 300) as excerpt_en, published_at from articles where status = 'published' and ($1::text is null or kind = $1) order by published_at desc limit 50`, [kind ?? null]),
    );
  }

  @Get('articles/:slug')
  @Public()
  async article(@Auth() p: Principal, @Param('slug') slug: string) {
    const a = await this.tenancy.run(p, (tx) => tx.maybeOne(`select id, kind, slug, title_ar, title_en, body_ar, body_en, published_at, updated_at from articles where slug = $1 and status = 'published'`, [slug.slice(0, 120)]));
    if (!a) throw notFound('article');
    return a;
  }
}
