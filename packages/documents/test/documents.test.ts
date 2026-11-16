import { afterAll, describe, expect, it } from 'vitest';
import { closeRenderer, icsEvent, invoiceHtml, prescriptionHtml, qrDataUrl, renderPdf } from '../src';

const clinic = { nameAr: 'عيادة مدينة نصر', nameEn: 'Nasr City Clinic', address: 'القاهرة', phones: ['+201000001000'] };

afterAll(closeRenderer);

describe('documents', () => {
  it('renders an escaped bilingual prescription to PDF', async () => {
    const html = prescriptionHtml({
      clinic,
      doctor: { nameAr: 'أحمد سامي', nameEn: 'Ahmed Samy', title: 'consultant', specialtyAr: 'باطنة', specialtyEn: 'Internal Medicine', syndicateNumber: '100200' },
      patient: { name: '<script>x</script>', ageYears: 34, mrn: 'HF-000001' },
      issuedAt: new Date('2026-11-16T10:00:00Z'),
      lines: [{ drug: 'Panadol 500 mg', dose: '1 tab', route: 'oral', frequency: 'bid', durationDays: 5, instructionsAr: 'قرص مرتين يوميًا بعد الأكل', instructionsEn: '1 tablet twice daily after meals' }],
      qrDataUrl: await qrDataUrl('https://example.test/verify/rx/abc'),
      verifyUrl: 'example.test/verify/rx/abc',
    });
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('<script>x');
    const pdf = await renderPdf(html, { size: 'A5' });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  }, 60000);

  it('invoice includes VAT and tax registration', () => {
    const html = invoiceHtml({
      kind: 'invoice', locale: 'ar', clinic, legalEntity: { nameAr: 'شركة', nameEn: 'Co', taxRegistrationNumber: '123-456-789' }, number: 'NC-INV-1', issuedAt: new Date(), patient: { name: 'منى', mrn: 'HF-1' },
      lines: [{ description: 'ليزر', qty: 1, unitPrice: 100000, discount: 0, vat: 14000, total: 114000 }],
      totals: { subtotal: 100000, discount: 0, vat: 14000, total: 114000, paid: 0, balance: 114000 },
    });
    expect(html).toContain('123-456-789');
    expect(html).toContain('1,140.00 ج.م');
  });

  it('creates an ics event', () => {
    const ics = icsEvent({ uid: 'a@hf', start: new Date('2026-11-20T15:00:00Z'), end: new Date('2026-11-20T15:20:00Z'), summary: 'موعد, د. أحمد', location: 'Nasr City' });
    expect(ics).toContain('DTSTART:20261120T150000Z');
    expect(ics).toContain('موعد\\, د. أحمد');
  });
});
