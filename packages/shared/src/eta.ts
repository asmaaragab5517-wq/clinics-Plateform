/**
 * Egyptian Tax Authority e-receipt helpers (FR-BIL-10).
 * Canonical serialisation follows the ETA SDK algorithm: every property name is upper-cased and quoted, scalar values
 * are quoted, objects recurse, and each array element is prefixed with the array's property name.
 * The receipt UUID is the SHA-256 (hex) of the canonical form of the receipt with `header.uuid` set to "".
 * Verify against the ETA SDK test vectors during onboarding (docs/integrations/eta.md).
 */
export function etaSerialize(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value !== 'object') return JSON.stringify(String(value));
  if (Array.isArray(value)) return value.map((v) => etaSerialize(v)).join('');
  let out = '';
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const name = `"${k.toUpperCase()}"`;
    if (Array.isArray(v)) {
      out += name;
      for (const item of v) out += name + etaSerialize(item);
    } else out += name + etaSerialize(v);
  }
  return out;
}

export interface EtaReceiptInput {
  receiptNumber: string;
  issuedAt: Date;
  previousUuid: string | null;
  seller: { rin: string; companyTradeName: string; branchCode: string; activityCode: string; governate: string; regionCity: string; street: string; buildingNumber: string };
  buyer: { type: 'P' | 'F'; name?: string; id?: string; mobile?: string };
  items: { internalCode: string; description: string; itemType: 'EGS' | 'GS1'; itemCode: string; unitType: string; quantity: number; unitPrice: number; netSale: number; totalSale: number; total: number; discount: number; vat: number }[];
  totals: { totalSales: number; totalDiscount: number; netAmount: number; totalAmount: number; vat: number };
  paymentMethod: 'C' | 'V' | 'O'; // cash, visa/card, other
}

const egp = (piastres: number) => Math.round(piastres) / 100;

/** Build the ETA receipt document (amounts in EGP with 2 decimals). */
export function buildEtaReceipt(r: EtaReceiptInput) {
  return {
    header: {
      dateTimeIssued: r.issuedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      receiptNumber: r.receiptNumber,
      uuid: '',
      previousUUID: r.previousUuid ?? '',
      referenceOldUUID: '',
      currency: 'EGP',
      exchangeRate: 0,
      sOrderNameCode: '',
      orderdeliveryMode: '',
      grossWeight: 0,
      netWeight: 0,
    },
    documentType: { receiptType: 'S', typeVersion: '1.2' },
    seller: {
      rin: r.seller.rin,
      companyTradeName: r.seller.companyTradeName,
      branchCode: r.seller.branchCode,
      branchAddress: { country: 'EG', governate: r.seller.governate, regionCity: r.seller.regionCity, street: r.seller.street, buildingNumber: r.seller.buildingNumber },
      deviceSerialNumber: '',
      activityCode: r.seller.activityCode,
    },
    buyer: { type: r.buyer.type, id: r.buyer.id ?? '', name: r.buyer.name ?? '', mobileNumber: r.buyer.mobile ?? '', paymentNumber: '' },
    itemData: r.items.map((i) => ({
      internalCode: i.internalCode,
      description: i.description,
      itemType: i.itemType,
      itemCode: i.itemCode,
      unitType: i.unitType,
      quantity: i.quantity,
      unitPrice: egp(i.unitPrice),
      netSale: egp(i.netSale),
      totalSale: egp(i.totalSale),
      total: egp(i.total),
      commercialDiscountData: i.discount ? [{ amount: egp(i.discount), description: 'discount' }] : [],
      taxableItems: i.vat ? [{ taxType: 'T1', amount: egp(i.vat), subType: 'V009', rate: 14 }] : [],
    })),
    totalSales: egp(r.totals.totalSales),
    totalCommercialDiscount: egp(r.totals.totalDiscount),
    netAmount: egp(r.totals.netAmount),
    taxTotals: r.totals.vat ? [{ taxType: 'T1', amount: egp(r.totals.vat) }] : [],
    totalAmount: egp(r.totals.totalAmount),
    paymentMethod: r.paymentMethod,
  };
}

/** ETA receipt QR content: public share URL with the total and the issuer RIN. */
export function etaQrUrl(uuid: string, issuedAt: Date, totalPiastres: number, rin: string, prod = true): string {
  const host = prod ? 'invoicing.eta.gov.eg' : 'preprod.invoicing.eta.gov.eg';
  return `https://${host}/receipts/search/${uuid}/share/${issuedAt.toISOString().replace(/\.\d{3}Z$/, 'Z')}#Total:${egp(totalPiastres).toFixed(2)},IssuerRIN:${rin}`;
}
