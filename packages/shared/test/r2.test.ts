import { describe, expect, it } from 'vitest';
import { buildEtaReceipt, etaQrUrl, etaSerialize, splitCoverage } from '../src';

describe('insurance split (FR-BIL-11)', () => {
  it('applies coverage per line, type overrides, exclusions and fixed co-pay', () => {
    const r = splitCoverage({ coveragePercent: 80, copayFixed: 2000, typeOverrides: { procedure: 50 }, excludedServiceIds: ['x'] }, [
      { serviceId: 'a', serviceType: 'consultation', total: 40000 },
      { serviceId: 'b', serviceType: 'procedure', total: 11400 },
      { serviceId: 'x', serviceType: 'consultation', total: 5000 },
    ]);
    expect(r.perLine).toEqual([32000, 5700, 0]);
    expect(r.insurer).toBe(35700);
    expect(r.patient).toBe(56400 - 35700);
  });
  it('never makes the insurer share negative', () => {
    expect(splitCoverage({ coveragePercent: 10, copayFixed: 100000 }, [{ serviceId: null, serviceType: null, total: 1000 }]).insurer).toBe(0);
  });
});

describe('ETA e-receipt helpers (FR-BIL-10)', () => {
  it('serialises canonically with upper-case quoted names and repeated array names', () => {
    expect(etaSerialize({ a: 'x', b: { c: 1 } })).toBe('"A""x""B""C""1"');
    expect(etaSerialize({ items: [{ q: 1 }, { q: 2 }] })).toBe('"ITEMS""ITEMS""Q""1""ITEMS""Q""2"');
  });
  it('builds a receipt in EGP with VAT tax items and a QR share URL', () => {
    const doc = buildEtaReceipt({
      receiptNumber: 'NC-0000001', issuedAt: new Date('2026-11-17T10:00:00.123Z'), previousUuid: null,
      seller: { rin: '123456789', companyTradeName: 'HealthFlow', branchCode: '0', activityCode: '8620', governate: 'Cairo', regionCity: 'Nasr City', street: 'x', buildingNumber: '1' },
      buyer: { type: 'P' },
      items: [{ internalCode: 'PROC-LASER', description: 'Laser', itemType: 'EGS', itemCode: 'EG-123-1', unitType: 'EA', quantity: 1, unitPrice: 100000, netSale: 100000, totalSale: 100000, total: 114000, discount: 0, vat: 14000 }],
      totals: { totalSales: 100000, totalDiscount: 0, netAmount: 100000, totalAmount: 114000, vat: 14000 },
      paymentMethod: 'C',
    });
    expect(doc.header.dateTimeIssued).toBe('2026-11-17T10:00:00Z');
    expect(doc.itemData[0]!.taxableItems[0]).toMatchObject({ taxType: 'T1', amount: 140, rate: 14 });
    expect(doc.totalAmount).toBe(1140);
    expect(etaQrUrl('abc', new Date('2026-11-17T10:00:00Z'), 114000, '123456789')).toBe('https://invoicing.eta.gov.eg/receipts/search/abc/share/2026-11-17T10:00:00Z#Total:1140.00,IssuerRIN:123456789');
  });
});
